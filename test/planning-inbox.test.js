import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { openChannelState } from "../src/engine/state.js";
import { runChannelCycle } from "../src/engine/scheduler.js";
import { validateCurrentProductionAttempt } from "../src/engine/attempt-gate.js";
import { approveReviewedPlan, hashSourceFile, ingestPlanningCandidates, makePlanTemplate, materializeReviewedBootstrap, planningSummary, readPlanningInbox, recoverPreviouslyAwaitingCandidates, rejectPlanningSource, reviewedPlanningSeeds, validateReviewedRecord } from "../src/engine/planning-inbox.js";
import { mergeReviewedProductionSeeds } from "../src/engine/production-seeds.js";

const sha = "a".repeat(64);
const licenceUrl = "https://creativecommons.org/licenses/by/4.0";
function verified(overrides = {}) { return { status: "rights_verified_with_evidence", attributionRequired: true, artist: "Jane Creator", licenceUrl, shareAlike: false, observedLicence: "CC BY 4.0", ...overrides }; }
function candidate(name = "clip", overrides = {}) {
  return { id: `commons-${name}`, title: `A source ${name}`, creator: "Jane Creator", sourceUrl: `https://upload.wikimedia.org/wikipedia/commons/1/11/${name}.webm?utm_source=commons`, rightsEvidenceUrl: `https://commons.wikimedia.org/wiki/File:${name}.webm`, license: { type: "CC BY 4.0", rightsStatus: "licensed", basis: "Exact licence on file page", attributionRequirement: `Jane Creator, CC BY 4.0 ${licenceUrl}` }, rightsVerification: verified(), sourceWidth: 1280, sourceHeight: 720, sourceMime: "video/webm", discoveredVia: "wikimedia_commons_api", needsProductionPlan: true, ...overrides };
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "planning-inbox-"));
  const state = await openChannelState(root, "Primeplug");
  return { root, state, cleanup: () => rm(root, { recursive: true, force: true }) };
}
async function prepared(state, source = candidate()) {
  assert.equal((await ingestPlanningCandidates(state, [source])).added, 1);
  const record = (await readPlanningInbox(state)).records.at(-1);
  const draft = {
    ...makePlanTemplate(record),
    window: { startSeconds: 1, seconds: 15, minimumStorySeconds: 10 },
    postingTitle: "A puppy's rolling moment", hookText: "A puppy rolls across the floor.",
    narrationScript: "A puppy rolls across the floor. It stretches out its legs and turns toward the camera for a moment. Then the puppy rolls back and settles down again.",
    visualSubject: "puppy", storyBeats: { hook: "The puppy rolls.", development: "The puppy stretches and turns.", payoff: "The puppy rolls back." },
    visualHookReview: { status: "editorial_reviewed", sourceUrl: record.candidate.sourceUrl, sourceSha256: sha, windowStartSeconds: 1, firstActionSourceSeconds: 1.2, reviewedThroughSourceSeconds: 2.8, onScreenText: "A puppy rolls", visualAction: "The puppy visibly rolls across the floor.", reviewMethod: "Human playback review of the complete opening.", reviewedBy: "Test editor" }
  };
  const review = { decision: "reviewed_against_source", reviewedBy: "Test editor", method: "Watched the entire synthetic source and continuously reviewed the selected window.", humanReviewer: true, entireSourceWatched: true, continuousWindowPlayback: true, coverageStartSeconds: 1, coverageEndSeconds: 16, claimsChecked: true, rightsChecked: true, openingChecked: true, claimNotes: "Each narration claim was compared with the complete synthetic source window.", rightsNotes: "The file page, creator and exact CC licence were inspected.", attributionText: `Jane Creator, source via Wikimedia Commons, CC BY 4.0 ${licenceUrl}; edited with narration and captions.` };
  return { record, draft, review };
}
async function promote(state, p, options = {}) { return approveReviewedPlan(state, p.record.key, p.draft, p.review, { checkedSourceSha256: sha, verifyRights: async () => verified(), ...options }); }

test("inbox persists screened footage, rejects unverified/research/low-quality data, dedupes variants and excludes seed/queue", async () => {
  const t = await setup();
  try {
    const invalid = candidate("invalid", { rightsVerification: { status: "permission_unclear" } });
    const research = candidate("research", { researchOnly: true });
    const low = candidate("low", { sourceHeight: 480 });
    const fakeHost = candidate("bad", { sourceUrl: "https://example.com/not-wikimedia.webm" });
    const seed = candidate("seed"), queued = candidate("queued");
    await t.state.enqueue({ fingerprint: "queued", type: "produce", candidate: queued });
    const result = await ingestPlanningCandidates(t.state, [candidate(), candidate("clip"), invalid, research, low, fakeHost, seed, queued], { existingSeedSources: [seed.sourceUrl] });
    assert.equal(result.added, 1);
    const db = await readPlanningInbox(t.state);
    assert.equal(db.records.length, 1); assert.equal(db.records[0].status, "awaiting_review");
    assert.equal(db.records[0].candidate.sourceUrl.endsWith("?utm_source=commons"), false);
    assert.equal((await reviewedPlanningSeeds(t.state)).seeds.length, 0);
    assert.equal((await ingestPlanningCandidates(t.state, [candidate()])).added, 0);
  } finally { await t.cleanup(); }
});

test("a template, model output, missing review, or wrong source bytes can never promote a plan", async () => {
  const t = await setup();
  try {
    const p = await prepared(t.state);
    await assert.rejects(promote(t.state, { ...p, draft: makePlanTemplate(p.record) }), /Plan cannot be promoted/);
    await assert.rejects(promote(t.state, { ...p, review: { ...p.review, claimsChecked: false } }), /explicit review/);
    await assert.rejects(promote(t.state, p, { checkedSourceSha256: "b".repeat(64) }), /SHA-256/);
    await assert.rejects(promote(t.state, { ...p, draft: { ...p.draft, sourceUrl: "https://upload.wikimedia.org/other.webm" } }), /identity/);
    await assert.rejects(promote(t.state, { ...p, review: { ...p.review, coverageEndSeconds: 4 } }), /cover the complete planned source window/);
    await assert.rejects(promote(t.state, { ...p, review: { ...p.review, coverageEndSeconds: 15.9 } }), /cover the complete planned source window/);
    for (const field of ["humanReviewer", "entireSourceWatched", "continuousWindowPlayback"]) {
      await assert.rejects(promote(t.state, { ...p, review: { ...p.review, [field]: false } }), /human reviewer/);
      const missing = { ...p.review }; delete missing[field];
      await assert.rejects(promote(t.state, { ...p, review: missing }), /human reviewer/);
    }
    assert.equal((await readPlanningInbox(t.state)).records[0].status, "awaiting_review");
  } finally { await t.cleanup(); }
});

test("review hashing binds a regular file and rejects symlinks, empty files and named pipes", async () => {
  const t = await setup();
  try {
    const file = join(t.root, "source.webm"), link = join(t.root, "link.webm"), empty = join(t.root, "empty.webm"), fifo = join(t.root, "pipe.webm");
    const bytes = Buffer.from("synthetic reviewed footage");
    await writeFile(file, bytes); await writeFile(empty, ""); await symlink(file, link);
    assert.equal(await hashSourceFile(file), createHash("sha256").update(bytes).digest("hex"));
    await assert.rejects(hashSourceFile(link));
    await assert.rejects(hashSourceFile(empty), /non-empty regular file/);
    await assert.rejects(hashSourceFile(t.root), /non-empty regular file/);
    if (spawnSync("mkfifo", [fifo]).status === 0) await assert.rejects(hashSourceFile(fifo), /non-empty regular file/);
  } finally { await t.cleanup(); }
});

test("promotion demands a fresh exact-licence, creator, attribution and source review", async () => {
  const t = await setup();
  try {
    const p = await prepared(t.state);
    await assert.rejects(promote(t.state, p, { verifyRights: async () => ({ status: "reuse_prohibited" }) }), /Fresh rights check failed/);
    await assert.rejects(promote(t.state, p, { verifyRights: async () => verified({ artist: "Someone Else" }) }), /Creator metadata is missing or changed/);
    await assert.rejects(promote(t.state, p, { verifyRights: async () => verified({ artist: null }) }), /Creator metadata is missing or changed/);
    await assert.rejects(promote(t.state, p, { verifyRights: async () => verified({ licenceUrl: "https://creativecommons.org/licenses/by/3.0" }) }), /Licence details changed/);
    await assert.rejects(promote(t.state, { ...p, review: { ...p.review, attributionText: "Creator" } }), /Attribution must/);
    assert.equal((await readPlanningInbox(t.state)).records[0].status, "awaiting_review");
  } finally { await t.cleanup(); }
});

test("source audio remains muted even if a proposed draft requests mixing", async () => {
  const t = await setup();
  try {
    const p = await prepared(t.state);
    p.draft.sourceAudio = { enabled: true, license: "unknown" }; p.draft.muteOriginalAudio = false;
    const record = await promote(t.state, p);
    assert.equal(record.seed.muteOriginalAudio, true);
    assert.equal(record.seed.sourceAudio, undefined);
    assert.equal(validateReviewedRecord(record).valid, true);
  } finally { await t.cleanup(); }
});

test("reviewed plan is source-hash bound; changing script, window, licence or review blocks it", async () => {
  const t = await setup();
  try {
    const p = await prepared(t.state), record = await promote(t.state, p);
    assert.equal(validateReviewedRecord(record).valid, true);
    const revision = makePlanTemplate(record);
    assert.equal(revision.visualHookReview.status, "review_required");
    assert.equal(revision.visualHookReview.sourceSha256, "");
    await assert.rejects(approveReviewedPlan(t.state, record.key, revision, p.review, { checkedSourceSha256: sha, verifyRights: async () => verified() }), /Plan cannot be promoted/);
    for (const change of [
      (r) => { r.seed.narrationScript += " A fabricated detail."; },
      (r) => { r.seed.window.startSeconds = 2; },
      (r) => { r.seed.license.type = "CC BY-SA 4.0"; },
      (r) => { r.review.claimsChecked = false; },
      (r) => { r.candidate.sourceUrl = "https://upload.wikimedia.org/wikipedia/commons/1/11/other.webm"; },
      (r) => { r.candidate.rightsVerification.artist = "Changed creator"; },
      (r) => { r.candidate.sourceMime = "image/jpeg"; },
      (r) => { r.seed.visualHookReview.sourceSha256 = "b".repeat(64); }
    ]) { const changed = structuredClone(record); change(changed); assert.equal(validateReviewedRecord(changed).valid, false); }
    assert.equal((await reviewedPlanningSeeds(t.state)).seeds.length, 1);
  } finally { await t.cleanup(); }
});

test("ShareAlike footage cannot be approved without an explicit compatible-use review", async () => {
  const t = await setup();
  try {
    const saUrl = "https://creativecommons.org/licenses/by-sa/4.0";
    const src = candidate("sa", { license: { type: "CC BY-SA 4.0", rightsStatus: "licensed", basis: "Exact licence on page", attributionRequirement: `Jane Creator CC BY-SA 4.0 ${saUrl}` }, rightsVerification: verified({ shareAlike: true, licenceUrl: saUrl, observedLicence: "CC BY-SA 4.0" }) });
    const p = await prepared(t.state, src);
    p.review.attributionText = `Jane Creator, CC BY-SA 4.0 ${saUrl}; edited with narration.`;
    await assert.rejects(promote(t.state, p, { verifyRights: async () => verified({ shareAlike: true, licenceUrl: saUrl, observedLicence: "CC BY-SA 4.0" }) }), /ShareAlike/);
    p.review.shareAlikeAcknowledged = true;
    await assert.rejects(promote(t.state, p, { verifyRights: async () => verified({ shareAlike: true, licenceUrl: saUrl, observedLicence: "CC BY-SA 4.0" }) }), /ShareAlike/);
    p.review.attributionText += " This adaptation is licensed under the same CC BY-SA 4.0 licence.";
    const r = await promote(t.state, p, { verifyRights: async () => verified({ shareAlike: true, licenceUrl: saUrl, observedLicence: "CC BY-SA 4.0" }) });
    assert.equal(r.status, "reviewed");
  } finally { await t.cleanup(); }
});

test("an explicitly reviewed test fixture reaches the queue and still requires a fresh rights check at attempt time", async () => {
  const t = await setup();
  try {
    const p = await prepared(t.state);
    await t.state.recordSource(p.record.candidate, "awaiting_plan");
    const record = await promote(t.state, p), seed = record.seed;
    const canonical = { id: seed.id, title: seed.label, sourceUrl: seed.sourceUrl, creator: seed.creator, rightsEvidenceUrl: seed.rightsEvidenceUrl, license: seed.license, rightsVerification: verified(), seedManifestEntry: seed };
    let attempted = 0, rightsChecks = 0;
    const result = await runChannelCycle({ channel: { id: "Primeplug", operation: { enabled: true, paused: false, maxCandidatesPerDay: 4 } }, niche: { id: "funny" }, state: t.state,
      candidateProvider: async () => [canonical],
      produceJob: async (job) => {
        const gate = await validateCurrentProductionAttempt({ job, candidates: [{ ...canonical, reviewedPlanning: true }], verifyRights: async () => { rightsChecks++; return verified(); } });
        assert.equal(gate.allowed, true); attempted++; return { produced: true, outcome: "mock_production_only" };
      }
    });
    assert.equal(result.enqueued, 1); assert.equal(result.produced, 1); assert.equal(attempted, 1); assert.equal(rightsChecks, 1);
    assert.equal((await t.state.getPublished()).videos.length, 0, "production cannot approve or publish a video");
    assert.equal((await planningSummary(t.state)).reviewedAvailable, 0);
  } finally { await t.cleanup(); }
});

test("revoked or tampered plans disappear even if an older bootstrap is present", async () => {
  const t = await setup();
  try {
    const p = await prepared(t.state), approved = await promote(t.state, p);
    const bootstrap = join(t.root, "bootstrap.json"); await writeFile(bootstrap, JSON.stringify({ version: 1, records: [approved] }));
    assert.equal((await reviewedPlanningSeeds(t.state, { bootstrapPath: bootstrap })).seeds.length, 1);
    await rejectPlanningSource(t.state, p.record.key, { reviewedBy: "Test editor", reason: "A fresh editorial review found the source unsuitable." });
    assert.equal((await reviewedPlanningSeeds(t.state, { bootstrapPath: bootstrap })).seeds.length, 0);
    await writeFile(t.state.path("planning-inbox.json"), "not-json");
    await assert.rejects(reviewedPlanningSeeds(t.state, { bootstrapPath: bootstrap }), /invalid JSON/);
  } finally { await t.cleanup(); }
});

test("older awaiting-plan sources are refetched from exact Commons pages, not trusted from stale metadata", async () => {
  const t = await setup();
  try {
    const c = candidate("old"); await t.state.recordSource(c, "awaiting_plan");
    let calls = 0;
    const payload = { query: { pages: { "123": { title: "File:old.webm", imageinfo: [{ url: c.sourceUrl, descriptionurl: c.rightsEvidenceUrl, width: 1280, height: 720, mime: "video/webm", extmetadata: { LicenseShortName: { value: "CC BY 4.0" }, LicenseUrl: { value: licenceUrl }, UsageTerms: { value: "Creative Commons Attribution 4.0" }, Artist: { value: "Jane Creator" } } }] } } } };
    const result = await recoverPreviouslyAwaitingCandidates(t.state, { fetchImpl: async (url) => { calls++; assert.match(url, /File%3Aold\.webm/); return { ok: true, json: async () => payload }; } });
    assert.equal(calls, 1); assert.equal(result.items.length, 1);
    payload.query.pages["123"].imageinfo[0].url = candidate("other").sourceUrl;
    assert.equal((await recoverPreviouslyAwaitingCandidates(t.state, { fetchImpl: async () => ({ ok: true, json: async () => payload }) })).items.length, 0);
    const failure = await recoverPreviouslyAwaitingCandidates(t.state, { fetchImpl: async () => ({ ok: false, status: 429 }) });
    assert.equal(failure.items.length, 0); assert.match(failure.errors[0], /429/);
    assert.equal((await ingestPlanningCandidates(t.state, result.items)).added, 1);
    const alreadySaved = await recoverPreviouslyAwaitingCandidates(t.state, { fetchImpl: async () => { throw new Error("must not re-fetch saved items"); } });
    assert.equal(alreadySaved.checked, 0);
  } finally { await t.cleanup(); }
});

test("bootstrap is materialized per-channel, can be revoked, and a stale queue item cannot pass a fresh manifest gate", async () => {
  const t = await setup();
  try {
    const p = await prepared(t.state), approved = await promote(t.state, p);
    const bootstrap = join(t.root, "reviewed-bootstrap.json");
    await writeFile(bootstrap, JSON.stringify({ version: 1, records: [approved] }));
    const fresh = await openChannelState(join(t.root, "fresh"), "Primeplug");
    const first = await mergeReviewedProductionSeeds({ channel: { id: "Primeplug" }, configured: [], state: fresh, bootstrapPath: bootstrap });
    assert.equal(first.materialized, 1);
    assert.equal(first.seeds.length, 1);
    assert.equal((await readPlanningInbox(fresh)).records[0].status, "reviewed");
    const other = await openChannelState(t.root, "Other");
    const untouched = await mergeReviewedProductionSeeds({ channel: { id: "Other" }, configured: [], state: other, bootstrapPath: bootstrap });
    assert.equal(untouched.seeds.length, 0);
    assert.equal((await readPlanningInbox(other)).records.length, 0);
    await assert.rejects(mergeReviewedProductionSeeds({ channel: { id: "Primeplug" }, configured: [], state: other, bootstrapPath: bootstrap }), /does not match/);
    const job = { candidate: { id: approved.seed.id, sourceUrl: approved.seed.sourceUrl } };
    await rejectPlanningSource(fresh, approved.key, { reviewedBy: "Test editor", reason: "A later reviewer found this source unsuitable for the edit." });
    const after = await mergeReviewedProductionSeeds({ channel: { id: "Primeplug" }, configured: [], state: fresh, bootstrapPath: bootstrap });
    assert.equal(after.materialized, 0);
    assert.equal(after.seeds.length, 0, "older bootstrap cannot undo a state revocation");
    let rightsCalled = false;
    const gate = await validateCurrentProductionAttempt({ job, candidates: after.seeds.map((seed) => ({ ...seed, seedManifestEntry: seed })), verifyRights: async () => { rightsCalled = true; return verified(); } });
    assert.equal(gate.allowed, false);
    assert.equal(gate.outcome, "held_candidate_identity");
    assert.equal(rightsCalled, false);
  } finally { await t.cleanup(); }
});

test("fresh attempt holds an inbox plan if the creator, licence URL or ShareAlike notice changed", async () => {
  const t = await setup();
  try {
    const p = await prepared(t.state), approved = await promote(t.state, p), seed = approved.seed;
    const canonical = { id: seed.id, sourceUrl: seed.sourceUrl, creator: seed.creator, rightsEvidenceUrl: seed.rightsEvidenceUrl, license: seed.license, reviewedPlanning: true, seedManifestEntry: seed };
    const job = { candidate: { id: seed.id, sourceUrl: seed.sourceUrl } };
    const check = (rv) => validateCurrentProductionAttempt({ job, candidates: [canonical], verifyRights: async () => rv });
    assert.equal((await check(verified())).allowed, true);
    for (const rv of [verified({ artist: "Another creator" }), verified({ artist: null }), verified({ licenceUrl: "https://creativecommons.org/licenses/by/3.0" }), verified({ shareAlike: true })]) {
      const result = await check(rv);
      assert.equal(result.allowed, false);
      assert.equal(result.outcome, "held_fresh_rights_check");
    }
  } finally { await t.cleanup(); }
});

test("duplicate bootstrap identities fail closed and a concurrent inbox writer cannot overwrite state", async () => {
  const t = await setup();
  try {
    const p = await prepared(t.state), approved = await promote(t.state, p);
    const fresh = await openChannelState(join(t.root, "fresh"), "Primeplug");
    const bootstrap = join(t.root, "duplicate-bootstrap.json");
    await writeFile(bootstrap, JSON.stringify({ version: 1, records: [approved, approved] }));
    const materialized = await materializeReviewedBootstrap(fresh, { bootstrapPath: bootstrap });
    assert.equal(materialized.added, 0);
    assert.equal(materialized.invalid.length, 2);
    assert.equal((await reviewedPlanningSeeds(fresh, { bootstrapPath: bootstrap })).seeds.length, 0);
    const lock = fresh.path(".planning-inbox.lock");
    await writeFile(lock, "another writer", { flag: "wx" });
    await assert.rejects(ingestPlanningCandidates(fresh, [candidate("concurrent")]), /locked by another writer/);
    assert.equal((await readPlanningInbox(fresh)).records.length, 0);
    await rm(lock);
    assert.equal((await ingestPlanningCandidates(fresh, [candidate("concurrent")])).added, 1);
  } finally { await t.cleanup(); }
});

async function runDailyIsolated(root, reportName) {
  const profiles = JSON.parse(await readFile("config/channels.json", "utf8"));
  const channel = profiles.channels.find((c) => c.id === "Primeplug");
  const manifest = join(root, "empty-seeds.json");
  const profilesPath = join(root, "channels.json");
  const reportDir = join(root, reportName);
  await writeFile(manifest, "[]\n");
  channel.seedCandidateManifest = manifest;
  await writeFile(profilesPath, JSON.stringify({ version: 1, channels: [channel] }));
  const env = { ...process.env, STATE_DIR: root, CHANNEL_PROFILES_PATH: profilesPath, DAILY_REPORT_DIR: reportDir,
    DAILY_PRODUCTION_ENABLED: "true", COMMONS_DISCOVERY: "off", GITHUB_ACTIONS: "false", ENABLE_GEMINI_TTS: "false" };
  delete env.YOUTUBE_DATA_API_KEY;
  delete env.GEMINI_API_KEY;
  const child = spawnSync(process.execPath, ["scripts/run-daily-operations.mjs"], { env, encoding: "utf8", timeout: 30000 });
  assert.equal(child.status, 0, child.stderr || child.error?.message || child.stdout);
  return JSON.parse(await readFile(join(reportDir, "summary.json"), "utf8"));
}

async function enqueueBootstrapJob(state) {
  const bootstrap = JSON.parse(await readFile("config/primeplug-reviewed-backlog.json", "utf8"));
  const record = bootstrap.records[0], seed = record.seed;
  await state.enqueue({ fingerprint: "planning-test", type: "produce", channelId: "Primeplug",
    candidate: { id: seed.id, sourceUrl: seed.sourceUrl, seedManifestEntry: seed, reviewedPlanning: true } });
  return bootstrap.records;
}

test("legacy sampled-frame examples cannot be materialized as human-reviewed plans even through the bootstrap helper", async () => {
  const t = await setup();
  try {
    const path = "config/primeplug-reviewed-backlog.json";
    const catalog = JSON.parse(await readFile(path, "utf8"));
    assert.equal(catalog.records.length, 2);
    for (const record of catalog.records) {
      const check = validateReviewedRecord(record);
      assert.equal(check.valid, false);
      assert.ok(check.reasons.some((reason) => /human reviewer/.test(reason)));
      const fresh = makePlanTemplate(record);
      assert.match(fresh.instructions, /none of its plan was inherited/);
      assert.equal(fresh.narrationScript, ""); assert.equal(fresh.window.startSeconds, null);
      assert.equal(fresh.visualHookReview.sourceSha256, "");
    }
    const tampered = structuredClone(catalog.records[0]);
    tampered.candidate.sourceUrl = "https://upload.wikimedia.org/wikipedia/commons/a/ab/different.webm";
    assert.throws(() => makePlanTemplate(tampered), /source identity is invalid/);
    const result = await materializeReviewedBootstrap(t.state, { bootstrapPath: path });
    assert.equal(result.added, 0); assert.equal(result.invalid.length, 2);
    assert.equal((await reviewedPlanningSeeds(t.state, { bootstrapPath: path })).seeds.length, 0);
    assert.equal((await readPlanningInbox(t.state)).records.length, 0);
    assert.equal((await t.state.getQueue()).jobs.length, 0);
  } finally { await t.cleanup(); }
});

test("an older invalid review can be replaced by a wholly fresh synthetic human-attested plan", async () => {
  const t = await setup();
  try {
    const p = await prepared(t.state), prior = await promote(t.state, p);
    const legacy = structuredClone(prior);
    delete legacy.review.humanReviewer; delete legacy.review.entireSourceWatched; delete legacy.review.continuousWindowPlayback;
    await writeFile(t.state.path("planning-inbox.json"), JSON.stringify({ version: 1, records: [legacy] }));
    assert.equal((await reviewedPlanningSeeds(t.state)).seeds.length, 0);
    const blank = makePlanTemplate(legacy);
    assert.equal(blank.narrationScript, ""); assert.equal(blank.visualHookReview.status, "review_required");
    // These are fictional local test attestations and a mocked rights response,
    // not a real person, footage review, or live licence check.
    const freshDraft = { ...p.draft, candidateId: blank.candidateId, sourceUrl: blank.sourceUrl };
    const updated = await promote(t.state, { ...p, draft: freshDraft });
    assert.equal(updated.status, "reviewed"); assert.equal(validateReviewedRecord(updated).valid, true);
    assert.equal(updated.review.humanReviewer, true); assert.equal(updated.review.entireSourceWatched, true);
    assert.equal((await reviewedPlanningSeeds(t.state)).seeds.length, 1);
  } finally { await t.cleanup(); }
});

test("assistant-authored cat examples are not imported by a normal list or daily run", async () => {
  const t = await setup();
  try {
    const list = spawnSync(process.execPath, ["scripts/planning-inbox.mjs", "list"], {
      env: { ...process.env, STATE_DIR: t.root }, encoding: "utf8", timeout: 30000
    });
    assert.equal(list.status, 0, list.stderr); assert.deepEqual(JSON.parse(list.stdout).records, []);
    assert.equal((await readPlanningInbox(t.state)).records.length, 0);
    const summary = await runDailyIsolated(t.root, "report-no-implicit-cats");
    assert.equal(summary.planning.Primeplug.totalRecords, 0);
    assert.equal(summary.productionReport.totals.attempted, 0); assert.equal(summary.productionReport.totals.produced, 0);
    assert.equal((await t.state.getQueue()).jobs.length, 0);
    assert.equal((await readPlanningInbox(t.state)).records.length, 0);
  } finally { await t.cleanup(); }
});

test("an explicit example selection stages only a pending source, never the assistant's plan or review", async () => {
  const t = await setup();
  try {
    const catalog = JSON.parse(await readFile("config/primeplug-reviewed-backlog.json", "utf8"));
    const key = catalog.records[0].key;
    const run = () => spawnSync(process.execPath, ["scripts/planning-inbox.mjs", "stage-example", key], { env: { ...process.env, STATE_DIR: t.root }, encoding: "utf8", timeout: 30000 });
    const first = run(); assert.equal(first.status, 0, first.stderr); assert.equal(JSON.parse(first.stdout).status, "example_staged_for_fresh_human_review");
    const inbox = await readPlanningInbox(t.state);
    assert.equal(inbox.records.length, 1); assert.equal(inbox.records[0].status, "awaiting_review");
    assert.equal(inbox.records[0].seed, undefined); assert.equal(inbox.records[0].review, undefined); assert.equal(inbox.records[0].reviewDigest, undefined);
    assert.equal((await reviewedPlanningSeeds(t.state)).seeds.length, 0); assert.equal((await t.state.getQueue()).jobs.length, 0);
    const again = run(); assert.equal(again.status, 0, again.stderr); assert.equal(JSON.parse(again.stdout).status, "example_not_staged");
  } finally { await t.cleanup(); }
});

test("daily integration preserves a queued plan when its inbox is unreadable", async () => {
  const t = await setup();
  try {
    await enqueueBootstrapJob(t.state);
    await writeFile(t.state.path("planning-inbox.json"), "invalid JSON");
    const summary = await runDailyIsolated(t.root, "report-unavailable");
    const job = (await t.state.getQueue()).jobs[0];
    assert.equal(job.status, "queued"); assert.equal(job.attempts, 0);
    assert.equal(job.result.deferred, true); assert.match(job.result.reason, /inbox is unavailable/);
    assert.equal(summary.productionReport.totals.considered, 1);
    assert.equal(summary.productionReport.totals.attempted, 0);
    assert.equal(summary.productionReport.totals.deferred, 1);
    assert.equal(summary.productionReport.totals.produced, 0);
    assert.equal(summary.planning.Primeplug.status, "unavailable");
  } finally { await t.cleanup(); }
});

test("a real inbox revocation still cancels the matching stale queued plan", async () => {
  const t = await setup();
  try {
    const records = await enqueueBootstrapJob(t.state);
    // Override every bootstrap record so this offline integration test does
    // not discover or render anything else.
    await writeFile(t.state.path("planning-inbox.json"), JSON.stringify({ version: 1, records: records.map((r) => ({ key: r.key, candidate: r.candidate, status: "rejected" })) }));
    const summary = await runDailyIsolated(t.root, "report-revoked");
    const job = (await t.state.getQueue()).jobs[0];
    assert.equal(job.status, "cancelled"); assert.equal(job.attempts, 0);
    assert.match(job.result.reason, /revoked/);
    assert.equal(summary.productionReport.totals.attempted, 0);
    assert.equal(summary.productionReport.totals.produced, 0);
  } finally { await t.cleanup(); }
});

test("bounded old-source recovery rotates across days instead of starving later pages", async () => {
  const t = await setup();
  try {
    for (let i = 0; i < 5; i++) await t.state.recordSource(candidate(`rotation-${i}`), "awaiting_plan");
    const seen = new Set();
    for (let day = 0; day < 3; day++) {
      const result = await recoverPreviouslyAwaitingCandidates(t.state, {
        maxSources: 2, now: new Date(Date.UTC(2026, 0, 1 + day)),
        fetchImpl: async (url) => {
          for (const title of new URL(url).searchParams.get("titles").split("|")) seen.add(title);
          return { ok: true, json: async () => ({ query: { pages: {} } }) };
        }
      });
      assert.equal(result.checked, 2);
    }
    assert.equal(seen.size, 5);
  } finally { await t.cleanup(); }
});
