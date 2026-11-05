import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadChannels } from "../src/config/channels.js";
import { loadNicheRegistry, resolveChannelNiche } from "../src/engine/niches.js";
import { screenCandidate } from "../src/engine/scheduler.js";

test("Primeplug is the only active channel and loads the funny real-world niche", async () => {
  const channels = await loadChannels("config/channels.json");
  const registry = await loadNicheRegistry("config/niches.json");
  const active = channels.filter((c) => c.operation?.enabled === true && c.operation?.paused !== true);
  assert.equal(active.length, 1);
  assert.equal(active[0].id, "Primeplug");
  assert.equal(active[0].youtubeChannelId, "UCB7EhjM0bj2wtIBy_A_kkkg");
  assert.equal(active[0].operation.publishingMode, "private_only");
  const niche = resolveChannelNiche(active[0], registry);
  assert.equal(niche.id, "funny-moments");
  assert.match(niche.label, /Funny, Surprising/);
  for (const other of channels.filter((c) => c.id !== "Primeplug")) {
    assert.equal(other.operation.enabled, false);
    assert.equal(other.operation.paused, true);
    assert.equal(other.operation.publishingMode, "disabled");
  }
});

test("Primeplug seed candidates are rights-licensed, HTTPS and pass screening", async () => {
  const seeds = JSON.parse(await readFile("config/primeplug-candidates.json", "utf8"));
  assert.ok(seeds.length >= 3);
  for (const seed of seeds) {
    assert.ok(seed.sourceUrl.startsWith("https://upload.wikimedia.org/"), seed.id);
    const raw = { sourceUrl: seed.sourceUrl, creator: seed.creator, rightsEvidenceUrl: seed.rightsEvidenceUrl, license: seed.license };
    // A recorded claim alone is never sufficient: without independent
    // verification in the cycle, screening must reject.
    assert.equal(screenCandidate(raw).eligible, false, `${seed.id} must not pass on claim alone`);
    const verified = { ...raw, rightsVerification: { status: "rights_verified_with_evidence", observedLicence: seed.license.type, attributionRequired: true } };
    const screen = screenCandidate(verified);
    assert.equal(screen.eligible, true, `${seed.id}: ${screen.reasons.join("; ")}`);
  }
  // Research references must never pass.
  assert.equal(screenCandidate({ sourceUrl: "https://www.youtube.com/watch?v=x", creator: "someone", researchOnly: true }).eligible, false);
});

test("scheduler: production-disabled (deferred) jobs stay queued and burn no attempts", async () => {
  const { runChannelCycle } = await import("../src/engine/scheduler.js");
  const { openChannelState } = await import("../src/engine/state.js");
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "pp-defer-"));
  const state = await openChannelState(root, "Primeplug");
  const channel = { id: "Primeplug", niche: "funny-moments", operation: { enabled: true, paused: false, maxCandidatesPerDay: 4 } };
  const candidate = { id: "c1", title: "t", sourceUrl: "https://upload.wikimedia.org/x.webm", creator: "c", rightsEvidenceUrl: "https://commons.wikimedia.org/x", license: { rightsStatus: "licensed", attributionRequirement: "Credit: c, CC BY 4.0" }, rightsVerification: { status: "rights_verified_with_evidence", observedLicence: "CC BY 4.0", attributionRequired: true } };
  const run1 = await runChannelCycle({ channel, niche: { id: "funny-moments" }, state, candidateProvider: async () => [candidate], produceJob: async () => ({ deferred: true, produced: false, reason: "Production disabled for this run" }) });
  assert.equal(run1.deferred, 1);
  let q = await state.getQueue();
  assert.equal(q.jobs[0].status, "queued");
  assert.equal(q.jobs[0].attempts, 0);
  const run2 = await runChannelCycle({ channel, niche: { id: "funny-moments" }, state, candidateProvider: async () => [], produceJob: async () => ({ produced: true, outcome: "completed" }) });
  assert.equal(run2.completed, 1);
  q = await state.getQueue();
  assert.equal(q.jobs[0].status, "completed");
});
