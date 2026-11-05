import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadNicheRegistry, resolveChannelNiche, buildDiscoveryConfig } from "../src/engine/niches.js";
import { openChannelState, sourceFingerprint } from "../src/engine/state.js";
import { runDailyOperations, runChannelCycle, screenCandidate } from "../src/engine/scheduler.js";
import { decidePublish } from "../src/engine/publisher-guard.js";
import { analyzeChannelFeedback } from "../src/engine/feedback.js";
import { assessMonetizationReadiness } from "../src/engine/monetization-readiness.js";
import { validateChannels } from "../src/config/channels.js";

const registry = new Map([
  ["space", { id: "space", discovery: { searchQueries: ["nasa"] }, editorial: { minEditorialScore: 5.5 } }],
  ["funny", { id: "funny", discovery: { searchQueries: ["funny"] }, editorial: { minEditorialScore: 5.5 } }]
]);
const mkChannel = (id, niche, extra = {}) => validateChannels({ channels: [{ id, name: id, niche, youtubeChannelId: `UC-${id}`, operation: { enabled: true, productionEnabled: true, publishingMode: "private_only", maxCandidatesPerDay: 5 }, ...extra }] })[0];
const goodCandidate = (n) => ({ id: `c${n}`, title: `Video ${n}`, sourceUrl: `https://upload.wikimedia.org/v${n}.webm`, creator: "NASA", rightsEvidenceUrl: "https://commons.wikimedia.org/wiki/File:V", license: { rightsStatus: "public_domain" } });

test("channels resolve different niches independently; new niches need config only", () => {
  const a = resolveChannelNiche(mkChannel("a", "space"), registry);
  const b = resolveChannelNiche(mkChannel("b", "funny"), registry);
  assert.equal(a.discovery.searchQueries[0], "nasa");
  assert.equal(b.discovery.searchQueries[0], "funny");
  assert.throws(() => resolveChannelNiche(mkChannel("c", "cooking"), registry), /unknown niche/);
  registry.set("cooking", { id: "cooking", discovery: { searchQueries: ["cooking"] } });
  assert.equal(resolveChannelNiche(mkChannel("c", "cooking"), registry).id, "cooking");
});

test("real config files load: 4 channels, distinct niches, only Primeplug connected", async () => {
  const niches = await loadNicheRegistry(new URL("../config/niches.json", import.meta.url).pathname);
  const channels = validateChannels(JSON.parse(await readFile(new URL("../config/channels.json", import.meta.url), "utf8")));
  assert.equal(channels.length, 4);
  // Primeplug-only phase: Primeplug now owns the funny-moments niche; the paused
  // funny placeholder may share the niche id but is disabled and cannot operate.
  assert.equal(channels.find((c) => c.id === "Primeplug").niche, "funny-moments");
  for (const c of channels) assert.ok(niches.has(c.niche), c.niche);
  const connected = channels.filter((c) => c.status === "connected");
  assert.equal(connected.length, 1);
  assert.equal(connected[0].youtubeChannelId, "UCB7EhjM0bj2wtIBy_A_kkkg");
  assert.equal(connected[0].operation.publishingMode, "private_only");
});

test("scheduler: channels isolated — one failing channel does not stop others; duplicates and rights rejects recorded", async () => {
  const root = await mkdtemp(join(tmpdir(), "os-"));
  const channels = [mkChannel("good", "space"), mkChannel("bad", "funny"), mkChannel("off", "funny")];
  channels[2] = validateChannels({ channels: [{ id: "off", name: "off", niche: "funny", operation: { enabled: false } }] })[0];
  const summary = await runDailyOperations({
    channels, nicheRegistry: registry, openState: (id) => openChannelState(root, id),
    candidateProvider: async (channel) => {
      if (channel.id === "bad") throw new Error("discovery exploded");
      return [goodCandidate(1), goodCandidate(1), { title: "No rights", sourceUrl: "https://x.example/v.mp4", creator: "Someone" }, { title: "Research", sourceUrl: "https://youtube.com/watch?v=1", creator: "YT", researchOnly: true }];
    },
    produceJob: async () => ({ produced: true })
  });
  const byId = Object.fromEntries(summary.runs.map((r) => [r.channelId, r]));
  assert.equal(byId.good.status, "ok");
  assert.equal(byId.good.completed, 1);
  assert.equal(byId.good.duplicates, 1);
  assert.ok(byId.good.rejected.length >= 2);
  assert.equal(byId.bad.status, "error");
  assert.equal(byId.off.status, "disabled");

  // Second run: everything is a duplicate, nothing re-queued (restart recovery / dedupe).
  const again = await runDailyOperations({ channels: [channels[0]], nicheRegistry: registry, openState: (id) => openChannelState(root, id), candidateProvider: async () => [goodCandidate(1)], produceJob: async () => ({ produced: true }) });
  assert.equal(again.runs[0].duplicates, 1);
  assert.equal(again.runs[0].enqueued, 0);
});

test("scheduler: failed production retries across cycles, then completes; paused channel is skipped", async () => {
  const root = await mkdtemp(join(tmpdir(), "os-retry-"));
  const channel = mkChannel("retry", "space");
  let calls = 0;
  const produceJob = async () => { calls += 1; if (calls < 3) throw new Error("temporary render failure"); return { produced: true }; };
  const provider = async () => [goodCandidate(9)];
  const r1 = await runDailyOperations({ channels: [channel], nicheRegistry: registry, openState: (id) => openChannelState(root, id), candidateProvider: provider, produceJob });
  assert.equal(r1.runs[0].completed, 0);
  await runDailyOperations({ channels: [channel], nicheRegistry: registry, openState: (id) => openChannelState(root, id), candidateProvider: async () => [], produceJob });
  const r3 = await runDailyOperations({ channels: [channel], nicheRegistry: registry, openState: (id) => openChannelState(root, id), candidateProvider: async () => [], produceJob });
  assert.equal(r3.runs[0].completed, 1);
  assert.equal(calls, 3);
  const state = await openChannelState(root, "retry");
  await state.setPaused(true);
  const paused = await runChannelCycle({ channel, niche: registry.get("space"), state, candidateProvider: provider, produceJob });
  assert.equal(paused.status, "paused");
});

test("rights screening rejects research-only and unlicensed candidates", () => {
  assert.equal(screenCandidate(goodCandidate(1)).eligible, true);
  assert.equal(screenCandidate({ sourceUrl: "https://x/v.mp4", creator: "A" }).eligible, false);
  assert.equal(screenCandidate({ ...goodCandidate(2), researchOnly: true }).eligible, false);
  assert.equal(screenCandidate({ ...goodCandidate(3), sourceUrl: "http://insecure/v.mp4" }).eligible, false);
});

test("publisher guard: identity mismatch, missing approval, duplicates and public mode all block; dry-run never uploads", async () => {
  const root = await mkdtemp(join(tmpdir(), "os-pub-"));
  const channel = mkChannel("Primeplug", "space");
  const state = await openChannelState(root, "Primeplug");
  const video = { fingerprint: "fp1", privacyStatus: "private", approvedByHuman: true };
  const mismatch = await decidePublish({ channel, video, state, verifyChannelIdentity: async () => ({ channelId: "UC-WRONG", title: "Wrong" }) });
  assert.equal(mismatch.allowed, false);
  assert.match(mismatch.reasons.join(" "), /identity mismatch/);
  const noApproval = await decidePublish({ channel, video: { ...video, approvedByHuman: false }, state, verifyChannelIdentity: async () => ({ channelId: "UC-Primeplug", title: "Primeplug" }) });
  assert.equal(noApproval.allowed, false);
  const ok = await decidePublish({ channel, video, state, verifyChannelIdentity: async () => ({ channelId: "UC-Primeplug", title: "Primeplug" }) });
  assert.equal(ok.allowed, true);
  assert.equal(ok.mode, "dry_run");
  await state.recordPublished({ fingerprint: "fp1", videoId: "v1" });
  const dup = await decidePublish({ channel, video, state, verifyChannelIdentity: async () => ({ channelId: "UC-Primeplug", title: "Primeplug" }) });
  assert.match(dup.reasons.join(" "), /Duplicate upload prevented/);
  const pub = await decidePublish({ channel, video: { ...video, privacyStatus: "public" }, state, env: {}, verifyChannelIdentity: async () => ({ channelId: "UC-Primeplug", title: "T" }) });
  assert.equal(pub.allowed, false);
});

test("analytics feedback uses only measured data and flags declining topics", () => {
  const empty = analyzeChannelFeedback({ analytics: null, published: [] });
  assert.equal(empty.status, "insufficient_data");
  const feedback = analyzeChannelFeedback({
    analytics: { topVideos: [
      { videoId: "1", title: "Mars landing explained", views: 5000, engagedViews: 4000, estimatedMinutesWatched: 900, subscribersGained: 40, averageViewPercentage: 62 },
      { videoId: "2", title: "Mars rover update", views: 3000, engagedViews: 2000, estimatedMinutesWatched: 500, subscribersGained: 20, averageViewPercentage: 55 },
      { videoId: "3", title: "Cooking tips one", views: 100, engagedViews: 20, estimatedMinutesWatched: 5, subscribersGained: 0, averageViewPercentage: 12 },
      { videoId: "4", title: "Cooking tips two", views: 90, engagedViews: 18, estimatedMinutesWatched: 4, subscribersGained: 0, averageViewPercentage: 10 }
    ] },
    published: []
  });
  assert.equal(feedback.status, "ok");
  assert.ok(feedback.topicPerformance.length >= 2);
  assert.ok(feedback.recommendations.some((r) => /retention|retire|hook/i.test(r)));
});

test("monetization readiness tracks thresholds and flags reused/repetitive risks without promising acceptance", () => {
  const ready = assessMonetizationReadiness({ metrics: { subscribers: 1200, validPublicWatchHours: 4500 }, productionHistory: [{ title: "A", originalContribution: true, rightsVerificationStatus: "verified" }] });
  assert.equal(ready.fullEligibleByNumbers, true);
  assert.match(ready.note, /does not guarantee/);
  const risky = assessMonetizationReadiness({ metrics: { subscribers: 10 }, productionHistory: [{ title: "Same", originalContribution: false }, { title: "Same", originalContribution: false }] });
  assert.ok(risky.risks.some((r) => r.type === "reused_content_risk"));
  assert.ok(risky.risks.some((r) => r.type === "repetitive_content_risk"));
  assert.equal(risky.progress.subscribers.fullPct, 1);
});

test("state is per-channel isolated and survives reload (cloud restart recovery)", async () => {
  const root = await mkdtemp(join(tmpdir(), "os-state-"));
  const a = await openChannelState(root, "chan-a");
  await a.recordSource(goodCandidate(1), "eligible");
  await a.enqueue({ fingerprint: sourceFingerprint(goodCandidate(1).sourceUrl), type: "produce", candidate: goodCandidate(1) });
  const b = await openChannelState(root, "chan-b");
  assert.equal(await b.hasUsedSource(goodCandidate(1).sourceUrl), false);
  const aReloaded = await openChannelState(root, "chan-a");
  assert.equal(await aReloaded.hasUsedSource(goodCandidate(1).sourceUrl), true);
  assert.equal((await aReloaded.getQueue()).jobs.length, 1);
  const dup = await aReloaded.enqueue({ fingerprint: sourceFingerprint(goodCandidate(1).sourceUrl), type: "produce", candidate: goodCandidate(1) });
  assert.equal(dup.enqueued, false);
});
