import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { openChannelState } from "../src/engine/state.js";
import { runChannelCycle, screenCandidate } from "../src/engine/scheduler.js";
import { approveReviewedPlan, ingestPixabayLeads, makePlanTemplate, planningSummary, readPlanningInbox, rejectPlanningSource, reviewedPlanningSeeds } from "../src/engine/planning-inbox.js";
import { PIXABAY_SEARCH_CACHE_MS, PIXABAY_MAX_RECENT_QUERIES, canonicalPixabayLead, pixabayLeadFromVideo, pixabayLeadKey, searchPixabayForReview } from "../src/discovery/sources/pixabay-planning.js";

const KEY = "mock_pixabay_key_never_real_123";
const now = new Date("2026-11-01T12:00:00.000Z");
function rawVideo(id = 42, overrides = {}) {
  return {
    id, type: "film", duration: 20, pageURL: `https://pixabay.com/videos/kitten-playing-${id}/`,
    tags: "kitten, playing, cat", user: "ExampleCreator", user_id: 17,
    videos: { large: { url: `https://cdn.pixabay.com/video/2024/01/01/${id}-123_large.mp4`, width: 1920, height: 1080, size: 12345 } },
    ...overrides
  };
}
function asset(id = 42) {
  const video = rawVideo(id);
  return { id, mediaType: video.type, durationSeconds: video.duration, sourceUrl: video.pageURL,
    attribution: { creator: video.user }, tags: video.tags, file: video.videos.large };
}
function response(videos = [rawVideo()]) {
  return new Response(JSON.stringify({ totalHits: videos.length, hits: videos }), { status: 200, headers: { "content-type": "application/json" } });
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "pixabay-planning-"));
  const state = await openChannelState(root, "Primeplug");
  return { root, state, cleanup: () => rm(root, { recursive: true, force: true }) };
}
function digest(path) { return readFile(path).then((data) => createHash("sha256").update(data).digest("hex")); }

test("one operator query uses the official API and persists only unverified, key-free leads", async () => {
  const t = await setup();
  try {
    let calls = 0;
    const found = await searchPixabayForReview(t.state, "funny cats", { apiKey: KEY, now, fetchImpl: async (value, options) => {
      calls++;
      const url = new URL(value);
      assert.equal(url.origin + url.pathname, "https://pixabay.com/api/videos/");
      assert.equal(url.searchParams.get("key"), KEY);
      assert.equal(url.searchParams.get("q"), "funny cats");
      assert.equal(url.searchParams.get("video_type"), "film");
      assert.equal(url.searchParams.get("safesearch"), "true");
      assert.equal(url.searchParams.get("per_page"), "12");
      assert.equal(options.redirect, "error");
      return response();
    } });
    assert.equal(calls, 1); assert.equal(found.cached, false); assert.equal(found.leads.length, 1);
    const lead = found.leads[0];
    assert.equal(lead.provider, "pixabay"); assert.equal(lead.providerAssetId, "42");
    assert.equal(lead.license.rightsStatus, "unverified");
    assert.equal(lead.rightsVerification.status, "evidence_recorded_not_independently_verified");
    assert.equal(lead.needsProductionPlan, true); assert.equal(lead.needsRightsReview, true);
    assert.equal(screenCandidate(lead).eligible, false);
    const cache = await readFile(t.state.path("pixabay-search-cache.json"), "utf8");
    assert.ok(!cache.includes(KEY)); assert.ok(!JSON.stringify(found).includes(KEY));
    assert.equal(JSON.parse(cache).entries[0].status, "ok");
    const intake = await ingestPixabayLeads(t.state, found.leads, { now });
    assert.equal(intake.added, 1); assert.equal(intake.productionEligible, false);
    const record = (await readPlanningInbox(t.state)).records[0];
    assert.equal(record.status, "awaiting_review"); assert.match(record.productionBlock, /not yet enabled/);
    assert.equal((await reviewedPlanningSeeds(t.state)).seeds.length, 0);
    const summary = await planningSummary(t.state);
    assert.equal(summary.pixabayLeadsBlocked, 1); assert.equal(summary.pending[0].productionBlocked, true);
    let checks = 0;
    await assert.rejects(approveReviewedPlan(t.state, record.key, makePlanTemplate(record), {}, {
      checkedSourceSha256: "a".repeat(64), verifyRights: async () => { checks++; return { status: "rights_verified_with_evidence" }; }
    }), /Pixabay leads remain held/);
    assert.equal(checks, 0, "even an injected verifier cannot promote an unsupported provider");
    assert.equal((await t.state.getQueue()).jobs.length, 0);
  } finally { await t.cleanup(); }
});

test("a staged Pixabay lead cannot render even if passed to the ordinary scheduler", async () => {
  const t = await setup();
  try {
    const lead = pixabayLeadFromVideo(asset(), { now }); let calls = 0;
    const report = await runChannelCycle({ channel: { id: "Primeplug", niche: "funny", operation: { enabled: true, maxCandidatesPerDay: 4 } },
      niche: { id: "funny" }, state: t.state, candidateProvider: async () => [lead], produceJob: async () => { calls++; return { produced: true }; } });
    assert.equal(calls, 0); assert.equal(report.attempted, 0); assert.equal(report.produced, 0);
    assert.equal(report.rejected.length, 1); assert.equal((await t.state.getQueue()).jobs.length, 0);
    assert.equal((await t.state.getPublished()).videos.length, 0);
  } finally { await t.cleanup(); }
});

test("repeat searches use the 24-hour cache even when a key is absent; the first new request is after expiry", async () => {
  const t = await setup();
  try {
    let calls = 0; const fetchImpl = async () => { calls++; return response(); };
    const first = await searchPixabayForReview(t.state, "Funny  Cats", { apiKey: KEY, now, fetchImpl });
    const cached = await searchPixabayForReview(t.state, "funny cats", { apiKey: "", now: new Date(now.getTime() + PIXABAY_SEARCH_CACHE_MS - 1), fetchImpl });
    assert.equal(calls, 1); assert.equal(first.cached, false); assert.equal(cached.cached, true);
    assert.deepEqual(cached.leads, first.leads);
    const after = await searchPixabayForReview(t.state, "funny cats", { apiKey: KEY, now: new Date(now.getTime() + PIXABAY_SEARCH_CACHE_MS), fetchImpl });
    assert.equal(calls, 2); assert.equal(after.cached, false);
    assert.equal(JSON.parse(await readFile(t.state.path("pixabay-search-cache.json"), "utf8")).entries.length, 1);
  } finally { await t.cleanup(); }
});

test("the 24-hour cache window starts after the response, not before a slow request", async () => {
  const t = await setup();
  try {
    let current = new Date(now), calls = 0;
    const clock = () => current;
    const fetchImpl = async () => { calls++; current = new Date(now.getTime() + 10000); return response(); };
    const first = await searchPixabayForReview(t.state, "cats", { apiKey: KEY, now: clock, fetchImpl });
    assert.equal(first.fetchedAt, new Date(now.getTime() + 10000).toISOString());
    current = new Date(now.getTime() + PIXABAY_SEARCH_CACHE_MS);
    const cached = await searchPixabayForReview(t.state, "cats", { apiKey: KEY, now: clock, fetchImpl });
    assert.equal(cached.cached, true); assert.equal(calls, 1);
    current = new Date(Date.parse(first.fetchedAt) + PIXABAY_SEARCH_CACHE_MS);
    const next = await searchPixabayForReview(t.state, "cats", { apiKey: KEY, now: clock, fetchImpl: async () => { calls++; return response(); } });
    assert.equal(next.cached, false); assert.equal(calls, 2);
  } finally { await t.cleanup(); }
});

test("a clock rollback after the provider responds leaves a non-expiring pending reservation", async () => {
  const t = await setup();
  try {
    let current = new Date(now), calls = 0;
    const fetchImpl = async () => { calls++; current = new Date(now.getTime() - 1000); return response(); };
    await assert.rejects(searchPixabayForReview(t.state, "cats", { apiKey: KEY, now: () => current, fetchImpl }), /clock moved backwards/);
    assert.equal(JSON.parse(await readFile(t.state.path("pixabay-search-cache.json"), "utf8")).entries[0].status, "pending");
    current = new Date(now.getTime() + 3 * PIXABAY_SEARCH_CACHE_MS);
    await assert.rejects(searchPixabayForReview(t.state, "cats", { apiKey: KEY, now: () => current, fetchImpl }), /still pending/);
    assert.equal(calls, 1);
  } finally { await t.cleanup(); }
});

test("an interrupted pending reservation is never automatically evicted or retried", async () => {
  const t = await setup();
  try {
    let calls = 0; const fetchImpl = async () => { calls++; return response(); };
    await searchPixabayForReview(t.state, "cats", { apiKey: KEY, now, fetchImpl });
    const path = t.state.path("pixabay-search-cache.json");
    const cache = JSON.parse(await readFile(path, "utf8"));
    cache.entries[0].status = "pending"; cache.entries[0].leads = [];
    await writeFile(path, JSON.stringify(cache));
    const later = new Date(now.getTime() + 3 * PIXABAY_SEARCH_CACHE_MS);
    await assert.rejects(searchPixabayForReview(t.state, "cats", { apiKey: KEY, now: later, fetchImpl }), /still pending/);
    assert.equal(calls, 1);
    await searchPixabayForReview(t.state, "dogs", { apiKey: KEY, now: later, fetchImpl });
    assert.equal(calls, 2);
    assert.ok(JSON.parse(await readFile(path, "utf8")).entries.some((entry) => entry.status === "pending"));
  } finally { await t.cleanup(); }
});

test("only a small bounded number of distinct operator searches can be made per 24 hours", async () => {
  const t = await setup();
  try {
    let calls = 0; const fetchImpl = async () => { calls++; return response(); };
    for (let i = 0; i < PIXABAY_MAX_RECENT_QUERIES; i++) {
      await searchPixabayForReview(t.state, `animal query ${i}`, { apiKey: KEY, now, fetchImpl });
    }
    await assert.rejects(searchPixabayForReview(t.state, "another animal", { apiKey: KEY, now, fetchImpl }), /cache is full of recent queries/);
    assert.equal(calls, PIXABAY_MAX_RECENT_QUERIES);
    const cached = await searchPixabayForReview(t.state, "animal query 0", { apiKey: KEY, now, fetchImpl });
    assert.equal(cached.cached, true); assert.equal(calls, PIXABAY_MAX_RECENT_QUERIES);
    await searchPixabayForReview(t.state, "another animal", { apiKey: KEY, now: new Date(now.getTime() + PIXABAY_SEARCH_CACHE_MS), fetchImpl });
    assert.equal(calls, PIXABAY_MAX_RECENT_QUERIES + 1);
  } finally { await t.cleanup(); }
});

test("one malformed hit does not prevent other safely parsed Pixabay leads", async () => {
  const t = await setup();
  try {
    const invalid = rawVideo(41);
    invalid.videos.large.url = "not a URL";
    const found = await searchPixabayForReview(t.state, "cats", { apiKey: KEY, now, fetchImpl: async () => response([invalid, rawVideo(42)]) });
    assert.equal(found.leads.length, 1);
    assert.equal(found.leads[0].providerAssetId, "42");
  } finally { await t.cleanup(); }
});

test("Pixabay id dedupes variant URLs and never undoes a rejection", async () => {
  const t = await setup();
  try {
    const first = pixabayLeadFromVideo(asset(), { now });
    const other = asset(); other.file = { ...other.file, url: other.file.url.replace("large", "medium"), width: 1280, height: 720 };
    const alternate = pixabayLeadFromVideo(other, { now });
    assert.equal(pixabayLeadKey(first.providerAssetId), pixabayLeadKey(alternate.providerAssetId));
    const intake = await ingestPixabayLeads(t.state, [first, alternate], { now });
    assert.equal(intake.added, 1); assert.equal(intake.ignored, 1);
    const r = (await readPlanningInbox(t.state)).records[0];
    await rejectPlanningSource(t.state, r.key, { reviewedBy: "Test editor", reason: "An actual reviewer found this clip unsuitable." });
    assert.equal((await ingestPixabayLeads(t.state, [alternate], { now })).added, 0);
    assert.equal((await readPlanningInbox(t.state)).records[0].status, "rejected");
  } finally { await t.cleanup(); }
});

test("the cache fails closed on corrupt state, future clocks, and concurrent search locks", async () => {
  const t = await setup();
  try {
    let calls = 0; const fetchImpl = async () => { calls++; return response(); };
    await writeFile(t.state.path("pixabay-search-cache.json"), "broken");
    await assert.rejects(searchPixabayForReview(t.state, "cats", { apiKey: KEY, now, fetchImpl }), /invalid JSON/);
    assert.equal(calls, 0);
    await rm(t.state.path("pixabay-search-cache.json"));
    await searchPixabayForReview(t.state, "cats", { apiKey: KEY, now, fetchImpl });
    await assert.rejects(searchPixabayForReview(t.state, "cats", { apiKey: KEY, now: new Date(now.getTime() - 1000), fetchImpl }), /future/);
    assert.equal(calls, 1);
    await writeFile(t.state.path(".pixabay-search.lock"), "other writer", { flag: "wx" });
    await assert.rejects(searchPixabayForReview(t.state, "dogs", { apiKey: KEY, now, fetchImpl }), /locked/);
    assert.equal(calls, 1);
  } finally { await t.cleanup(); }
});

test("failed provider calls never echo the key and are not reissued during the cache window", async () => {
  const t = await setup();
  try {
    let calls = 0, reservedStatus = null;
    const fetchImpl = async (url) => {
      calls++;
      reservedStatus = JSON.parse(await readFile(t.state.path("pixabay-search-cache.json"), "utf8")).entries[0].status;
      throw new Error(`bad request ${url}`);
    };
    await assert.rejects(searchPixabayForReview(t.state, "cats", { apiKey: KEY, now, fetchImpl }), (error) => {
      assert.ok(!error.message.includes(KEY)); assert.match(error.message, /search failed/); return true;
    });
    const cacheText = await readFile(t.state.path("pixabay-search-cache.json"), "utf8");
    assert.equal(reservedStatus, "pending", "the cache slot must be durable before the network call");
    assert.ok(!cacheText.includes(KEY)); assert.equal(JSON.parse(cacheText).entries[0].status, "failed");
    await assert.rejects(searchPixabayForReview(t.state, "cats", { apiKey: KEY, now: new Date(now.getTime() + 1000), fetchImpl }), /will not be repeated/);
    assert.equal(calls, 1);
  } finally { await t.cleanup(); }
});

test("provider metadata echoing a key is never saved as a search result", async () => {
  const t = await setup();
  try {
    const reflected = rawVideo(42, { tags: `kitten, ${KEY}, cat` });
    const found = await searchPixabayForReview(t.state, "cats", { apiKey: KEY, now, fetchImpl: async () => response([reflected, rawVideo(43)]) });
    assert.deepEqual(found.leads.map((lead) => lead.providerAssetId), ["43"]);
    const cache = await readFile(t.state.path("pixabay-search-cache.json"), "utf8");
    assert.ok(!cache.includes(KEY)); assert.ok(!JSON.stringify(found).includes(KEY));
  } finally { await t.cleanup(); }
});

test("unsafe hosts, IDs, query strings, animations, AI labels and low-quality files remain excluded", () => {
  const variants = [];
  const a = asset(); a.sourceUrl = "https://evil.example/videos/kitten-playing-42/"; variants.push(a);
  const b = asset(); b.file = { ...b.file, url: "https://cdn.pixabay.com.attacker.example/video/42-1_large.mp4" }; variants.push(b);
  const c = asset(); c.sourceUrl = "https://pixabay.com/videos/kitten-playing-43/"; variants.push(c);
  const d = asset(); d.file = { ...d.file, url: d.file.url + "?key=secret" }; variants.push(d);
  const e = asset(); e.mediaType = "animation"; variants.push(e);
  const f = asset(); f.tags = "kitten, AI generated, animated"; variants.push(f);
  const g = asset(); g.file = { ...g.file, height: 480 }; variants.push(g);
  const h = asset(); h.durationSeconds = 8; variants.push(h);
  const i = asset(); i.file = { ...i.file, url: "https://cdn.pixabay.com/video/2024/01/01/43-123_large.mp4" }; variants.push(i);
  for (const value of variants) assert.equal(pixabayLeadFromVideo(value, { now }), null);
  assert.ok(pixabayLeadFromVideo(asset(), { now }));
});

test("forged or extra fields cannot turn a lead into cleared rights or write extra data to the inbox", async () => {
  const t = await setup();
  try {
    const original = pixabayLeadFromVideo(asset(), { now });
    const forged = structuredClone(original); forged.license.rightsStatus = "licensed"; forged.rightsVerification.status = "rights_verified_with_evidence";
    assert.equal((await ingestPixabayLeads(t.state, [forged], { now })).added, 0);
    const extra = { ...original, irrelevantSecret: "should-not-be-saved", seed: { unreviewed: true } };
    assert.equal((await ingestPixabayLeads(t.state, [extra], { now })).added, 1);
    const saved = (await readPlanningInbox(t.state)).records[0].candidate;
    assert.deepEqual(saved, canonicalPixabayLead(original));
    assert.ok(!JSON.stringify(saved).includes("should-not-be-saved"));
  } finally { await t.cleanup(); }
});

test("even a forged, rehashed Pixabay 'review' cannot enter the reviewed production manifest", async () => {
  const t = await setup();
  try {
    await ingestPixabayLeads(t.state, [pixabayLeadFromVideo(asset(), { now })], { now });
    const inbox = await readPlanningInbox(t.state), record = inbox.records[0], c = record.candidate;
    c.license = { type: "CC BY 4.0", rightsStatus: "licensed", basis: "forged", attributionRequirement: "ExampleCreator, CC BY 4.0 https://creativecommons.org/licenses/by/4.0; edited" };
    c.rightsVerification = { status: "rights_verified_with_evidence", artist: c.creator, licenceUrl: "https://creativecommons.org/licenses/by/4.0" };
    record.status = "reviewed";
    record.seed = { id: c.id, sourceUrl: c.sourceUrl, creator: c.creator, rightsEvidenceUrl: c.rightsEvidenceUrl, license: structuredClone(c.license) };
    record.review = { sourceSha256: "a".repeat(64) };
    const stable = (v) => Array.isArray(v) ? v.map(stable) : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, stable(v[key])])) : v;
    record.reviewDigest = createHash("sha256").update(JSON.stringify(stable({ seed: record.seed, review: record.review, candidate: c }))).digest("hex");
    await writeFile(t.state.path("planning-inbox.json"), JSON.stringify(inbox));
    const loaded = await reviewedPlanningSeeds(t.state);
    assert.equal(loaded.seeds.length, 0); assert.equal(loaded.invalid.length, 1);
    assert.ok(loaded.invalid[0].reasons.some((reason) => /Commons video/.test(reason)));
  } finally { await t.cleanup(); }
});

test("mocked manual search reaches the real daily report but cannot queue or produce", async () => {
  const t = await setup();
  try {
    // The test's cwd has no reviewed-bootstrap file. This is an isolated
    // empty channel, not a decision about any of the user's saved plans.
    const mock = join(t.root, "mock-fetch.mjs"), networkGuard = join(t.root, "network-guard.mjs");
    const fetchLog = join(t.root, "unexpected-fetch.txt");
    const untrustedTags = rawVideo(42, { tags: "kitten, [link](https://untrusted.example), cat" });
    await writeFile(mock, `globalThis.fetch = async (value) => { if (new URL(value).origin !== 'https://pixabay.com') throw new Error('unexpected network'); return new Response(${JSON.stringify(JSON.stringify({ totalHits: 1, hits: [untrustedTags] }))}, {status: 200, headers: {'content-type':'application/json'}}); };\n`);
    await writeFile(networkGuard, `import {appendFileSync} from 'node:fs'; globalThis.fetch = async () => { appendFileSync(${JSON.stringify(fetchLog)}, 'unexpected fetch\\n'); throw new Error('network disabled in isolated test'); };\n`);
    const emptyManifest = join(t.root, "seeds.json");
    const channels = join(t.root, "channels.json");
    await writeFile(emptyManifest, "[]\n");
    await writeFile(channels, JSON.stringify({ channels: [{ id: "Primeplug", niche: "funny-moments", seedCandidateManifest: emptyManifest,
      operation: { enabled: true, paused: false, maxCandidatesPerDay: 4, productionEnabled: true, publishingMode: "disabled" } }] }));
    const published = t.state.path("published.json"), uploads = t.state.path("upload-attempts.json");
    await writeFile(published, '{"version":1,"videos":[]}\n');
    await writeFile(uploads, '{"version":1,"attempts":[]}\n');
    const before = [await digest(published), await digest(uploads)];
    const commonEnv = { ...process.env, STATE_DIR: t.root, PIXABAY_API_KEY: KEY, YOUTUBE_DATA_API_KEY: "", GEMINI_API_KEY: "", ENABLE_GEMINI_TTS: "false",
      YOUTUBE_ALLOW_PUBLIC_PUBLISH: "false", COMMONS_DISCOVERY: "off", CHANNEL_PROFILES_PATH: channels, NICHES_PATH: resolve("config/niches.json") };
    const search = spawnSync(process.execPath, ["--import", mock, resolve("scripts/planning-inbox.mjs"), "search-pixabay", "funny cats"],
      { cwd: t.root, env: commonEnv, encoding: "utf8", timeout: 30000 });
    assert.equal(search.status, 0, search.stderr);
    assert.equal(JSON.parse(search.stdout).added, 1);
    for (const enabled of [false, true]) {
      const reportDir = join(t.root, enabled ? "enabled-report" : "disabled-report");
      const stepSummary = join(t.root, enabled ? "enabled-summary.md" : "disabled-summary.md");
      const daily = spawnSync(process.execPath, ["--import", networkGuard, resolve("scripts/run-daily-operations.mjs")],
        { cwd: t.root, env: { ...commonEnv, DAILY_PRODUCTION_ENABLED: String(enabled), DAILY_REPORT_DIR: reportDir, GITHUB_STEP_SUMMARY: stepSummary }, encoding: "utf8", timeout: 30000 });
      assert.equal(daily.status, 0, daily.stderr);
      assert.ok(!daily.stdout.includes(KEY) && !daily.stderr.includes(KEY));
      const summary = JSON.parse(await readFile(join(reportDir, "summary.json"), "utf8"));
      assert.equal(summary.planning.Primeplug.pixabayLeadsBlocked, 1);
      assert.equal(summary.planning.Primeplug.pending[0].rightsStatus, "unverified");
      assert.equal(summary.planning.Primeplug.pending[0].productionBlocked, true);
      assert.equal(summary.runs[0].enqueued, 0); assert.equal(summary.runs[0].attempted, 0); assert.equal(summary.runs[0].produced, 0);
      const markdown = await readFile(stepSummary, "utf8");
      assert.match(markdown, /Pixabay leads blocked/);
      assert.ok(markdown.includes("\\[link\\]\\(https://untrusted.example\\)"), "untrusted result tags must not render as Markdown links");
      assert.deepEqual([await digest(published), await digest(uploads)], before);
    }
    await assert.rejects(readFile(fetchLog), { code: "ENOENT" }, "the daily runner must not trigger a new API call");
    assert.equal((await t.state.getQueue()).jobs.length, 0);
  } finally { await t.cleanup(); }
});

test("planning inbox search CLI is offline-mockable, never imports cat bootstrap, and changes no publication ledgers", async () => {
  const t = await setup();
  try {
    const published = t.state.path("published.json"), uploads = t.state.path("upload-attempts.json");
    await writeFile(published, '{"version":1,"videos":[]}\n');
    await writeFile(uploads, '{"version":1,"attempts":[]}\n');
    const before = [await digest(published), await digest(uploads)];
    const mock = join(t.root, "mock-pixabay-fetch.mjs");
    await writeFile(mock, `globalThis.fetch = async (value) => { const u = new URL(value); if (u.origin !== 'https://pixabay.com') throw new Error('unexpected network'); return new Response(${JSON.stringify(JSON.stringify({ totalHits: 1, hits: [rawVideo()] }))}, {status: 200, headers: {'content-type':'application/json'}}); };\n`);
    const env = { ...process.env, STATE_DIR: t.root, PIXABAY_API_KEY: KEY };
    const child = spawnSync(process.execPath, ["--import", mock, "scripts/planning-inbox.mjs", "search-pixabay", "funny cats"], { env, encoding: "utf8", timeout: 30000 });
    assert.equal(child.status, 0, child.stderr);
    assert.ok(!child.stdout.includes(KEY)); assert.ok(!child.stderr.includes(KEY));
    const result = JSON.parse(child.stdout); assert.equal(result.status, "unverified_leads_only"); assert.equal(result.added, 1); assert.equal(result.productionEligible, false);
    const inbox = await readPlanningInbox(t.state);
    assert.equal(inbox.records.length, 1); assert.equal(inbox.records[0].candidate.provider, "pixabay");
    assert.equal((await t.state.getQueue()).jobs.length, 0);
    assert.deepEqual([await digest(published), await digest(uploads)], before);
    const files = [await readFile(t.state.path("pixabay-search-cache.json"), "utf8"), await readFile(t.state.path("planning-inbox.json"), "utf8")];
    assert.ok(files.every((text) => !text.includes(KEY)));
  } finally { await t.cleanup(); }
});
