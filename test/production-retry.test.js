import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openChannelState } from "../src/engine/state.js";
import { runChannelCycle, runChannelWithProductionRetries, runDailyOperations } from "../src/engine/scheduler.js";
import { isDailyProductionSeed, narratedRequeueDecision } from "../src/engine/retry-policy.js";
import { validateCurrentProductionAttempt } from "../src/engine/attempt-gate.js";
import { buildProductionReport } from "../src/engine/run-report.js";

const channel = { id: "Primeplug", niche: "funny", operation: { enabled: true, paused: false, maxCandidatesPerDay: 4, publishingMode: "private_only" } };
const niche = { id: "funny" };
const registry = new Map([["funny", niche]]);
function candidate(id, extra = {}) {
  return {
    id, title: `Candidate ${id}`, sourceUrl: `https://upload.wikimedia.org/${id}.webm`, creator: "Creator",
    rightsEvidenceUrl: `https://commons.wikimedia.org/wiki/File:${id}.webm`,
    license: { type: "CC BY 4.0", rightsStatus: "licensed", attributionRequirement: "Credit creator, CC BY 4.0" },
    rightsVerification: { status: "rights_verified_with_evidence", attributionRequired: true },
    ...extra
  };
}
function narratedSeed(id = "a") {
  const c = candidate(id);
  return {
    id, sourceUrl: c.sourceUrl, creator: c.creator, rightsEvidenceUrl: c.rightsEvidenceUrl, license: c.license,
    productionMode: "narrated", window: { startSeconds: 0, seconds: 15 },
    postingTitle: "A playful puppy moment", hookText: "This puppy spots a toy.",
    storyBeats: { hook: "This puppy spots a toy.", development: "The puppy stops and looks.", payoff: "The puppy returns to the toy." },
    visualSubject: "puppy",
    narrationScript: "This puppy spots a toy. The puppy stops and looks across the room for a moment. Then the puppy returns to the toy and settles nearby."
  };
}
function heldJob(seed, result = {}) {
  return { status: "completed", candidate: { id: seed.id, sourceUrl: seed.sourceUrl, seedManifestEntry: seed }, result: { produced: false, pathway: "narrated", outcome: "held_source_overlay", ...result } };
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "primeplug-retry-"));
  const state = await openChannelState(root, "Primeplug");
  return { root, state, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("unchanged quality holds and test-only seeds are never automatically reopened", () => {
  const original = narratedSeed(); const job = heldJob(original);
  assert.equal(narratedRequeueDecision(job, structuredClone(original)).requeue, false);
  assert.equal(narratedRequeueDecision(job, { ...original, label: "display-only change" }).requeue, false);
  assert.equal(narratedRequeueDecision(job, { ...original, window: { startSeconds: 12, seconds: 15 }, testOnly: true }).requeue, false);
  assert.equal(isDailyProductionSeed({ testOnly: true }), false);
  assert.equal(isDailyProductionSeed(original), true);
  assert.equal(narratedRequeueDecision(job, { ...original, sourceUrl: "https://upload.wikimedia.org/different.webm" }).requeue, false);
});

test("only a valid materially changed narration or no-speech pathway can be reopened", () => {
  const original = narratedSeed(); const job = heldJob(original);
  const revised = { ...original, window: { startSeconds: 10, seconds: 15 } };
  assert.deepEqual(narratedRequeueDecision(job, revised), { requeue: true, reason: "production_plan_changed" });
  assert.equal(narratedRequeueDecision(job, { ...revised, narrationScript: "Too short." }).requeue, false);
  const former = { ...original }; delete former.productionMode;
  const noSpeech = heldJob(former, { pathway: null, outcome: "rejected_no_speech", reason: "Transcription produced no usable speech" });
  assert.deepEqual(narratedRequeueDecision(noSpeech, original), { requeue: true, reason: "new_narrated_plan_for_no_speech" });
  const rightsHold = heldJob(former, { pathway: null, outcome: "held_rights", reason: "License prohibited" });
  assert.equal(narratedRequeueDecision(rightsHold, original).requeue, false);
});

test("each attempt uses the current source and requires a fresh independent rights check", async () => {
  const seed = narratedSeed(); const c = { ...candidate("a"), seedManifestEntry: seed };
  const job = { candidate: { ...candidate("a"), seedManifestEntry: { ...seed, license: { type: "old" } } } };
  let checks = 0;
  const approved = await validateCurrentProductionAttempt({ job, candidates: [c], verifyRights: async (observed) => {
    checks++; assert.deepEqual(observed.license, seed.license);
    return { status: "rights_verified_with_evidence", attributionRequired: true };
  }});
  assert.equal(approved.allowed, true); assert.equal(checks, 1); assert.equal(approved.seed, seed);
  const prohibited = await validateCurrentProductionAttempt({ job, candidates: [c], verifyRights: async () => ({ status: "reuse_prohibited" }) });
  assert.equal(prohibited.allowed, false); assert.equal(prohibited.outcome, "held_fresh_rights_check");
  const unavailable = await validateCurrentProductionAttempt({ job, candidates: [c], verifyRights: async () => { throw new Error("network"); } });
  assert.equal(unavailable.allowed, false); assert.equal(unavailable.outcome, "held_fresh_rights_check");
  const missing = await validateCurrentProductionAttempt({ job, candidates: [], verifyRights: async () => { throw new Error("must not call"); } });
  assert.equal(missing.allowed, false); assert.equal(missing.outcome, "held_candidate_identity");
  const fixture = { ...c, seedManifestEntry: { ...seed, testOnly: true } };
  assert.equal((await validateCurrentProductionAttempt({ job, candidates: [fixture], verifyRights: async () => { throw new Error("must not call"); } })).allowed, false);
});

test("after a held candidate, retry finds a different eligible planned candidate and stops on success", async () => {
  const t = await setup();
  try {
    const seen = [];
    const run = await runChannelWithProductionRetries({ channel, niche, state: t.state,
      candidateProvider: async (_c, _n, { pass }) => pass === 0 ? [candidate("held")] : [candidate("held"), candidate("good")],
      produceJob: async (job) => { seen.push(job.candidate.id); return job.candidate.id === "held" ? { produced: false, outcome: "held_source_overlay" } : { produced: true, outcome: "completed" }; }
    });
    assert.deepEqual(seen, ["held", "good"], "a deterministic hold must not be produced again");
    assert.equal(run.retry.passes, 2); assert.equal(run.retry.stopReason, "produced");
    assert.equal(run.attempted, 2); assert.equal(run.produced, 1);
    const logs = (await readFile(join(t.root, "Primeplug", "runs.jsonl"), "utf8")).trim().split("\n");
    assert.equal(logs.length, 1, "all retry passes belong to one auditable daily run");
  } finally { await t.cleanup(); }
});

test("no production is reported honestly after three bounded searches; research and unplanned footage never render", async () => {
  const t = await setup();
  try {
    let renders = 0; const passes = [];
    const run = await runChannelWithProductionRetries({ channel, niche, state: t.state,
      candidateProvider: async (_c, _n, { pass }) => {
        passes.push(pass);
        return [candidate(`unplanned${pass}`, { needsProductionPlan: true }), candidate(`research${pass}`, { researchOnly: true })];
      },
      produceJob: async () => { renders++; return { produced: true }; }
    });
    assert.deepEqual(passes, [0, 1, 2]); assert.equal(renders, 0); assert.equal(run.produced, 0);
    assert.equal(run.awaitingPlan, 3); assert.equal(run.retry.stopReason, "passes_exhausted");
    assert.equal((await t.state.getQueue()).jobs.length, 0);
    assert.equal(buildProductionReport({ runs: [run] }, { productionEnabled: true }).productionOutcome, "no_production");
  } finally { await t.cleanup(); }
});

test("a source awaiting a plan can be reconsidered when a real plan is later supplied", async () => {
  const t = await setup();
  try {
    let renders = 0;
    const run = await runChannelWithProductionRetries({ channel, niche, state: t.state,
      candidateProvider: async (_c, _n, { pass }) => [candidate("same", pass === 0 ? { needsProductionPlan: true } : {})],
      produceJob: async () => { renders++; return { produced: true }; }
    });
    assert.equal(run.retry.passes, 2); assert.equal(renders, 1); assert.equal(run.produced, 1);
  } finally { await t.cleanup(); }
});

test("production attempts are capped at four and excess eligible candidates remain available", async () => {
  const t = await setup();
  try {
    let calls = 0; const items = Array.from({ length: 7 }, (_, i) => candidate(`v${i}`));
    const run = await runChannelWithProductionRetries({ channel, niche, state: t.state, maxJobs: 100, maxPasses: 100,
      candidateProvider: async () => items,
      produceJob: async () => { calls++; return { produced: false, outcome: "held_story_incomplete" }; }
    });
    assert.equal(calls, 4); assert.equal(run.retry.maxProductionAttempts, 4);
    assert.equal(run.retry.stopReason, "attempt_limit_reached");
    assert.equal(await t.state.hasUsedSource(items[4].sourceUrl, { rescreenRejected: true }), false);
    const next = await runChannelCycle({ channel, niche, state: t.state, candidateProvider: async () => [items[4]], produceJob: async () => ({ produced: true }) });
    assert.equal(next.produced, 1);
  } finally { await t.cleanup(); }
});

test("a transient thrown failure is retried within the bounded run; a deterministic hold is not", async () => {
  const t = await setup();
  try {
    let calls = 0;
    const run = await runChannelWithProductionRetries({ channel, niche, state: t.state,
      candidateProvider: async () => [candidate("transient")],
      produceJob: async () => { calls++; if (calls < 3) throw new Error("temporary network failure"); return { produced: true }; }
    });
    assert.equal(calls, 3); assert.equal(run.produced, 1); assert.equal(run.retry.passes, 3);
    assert.equal((await t.state.getQueue()).jobs[0].attempts, 3);
  } finally { await t.cleanup(); }
});

test("paused channel and production-disabled operation do not trigger retry searches", async () => {
  const t = await setup();
  try {
    await t.state.setPaused(true); let searched = 0;
    const paused = await runChannelWithProductionRetries({ channel, niche, state: t.state, candidateProvider: async () => { searched++; return []; }, produceJob: async () => ({ produced: true }) });
    assert.equal(paused.status, "paused"); assert.equal(paused.retry.passes, 1); assert.equal(searched, 0);
    await t.state.setPaused(false);
    const deferred = await runChannelWithProductionRetries({ channel, niche, state: t.state, candidateProvider: async () => { searched++; return [candidate("deferred")]; }, produceJob: async () => ({ deferred: true, produced: false, reason: "Production disabled" }) });
    assert.equal(deferred.retry.stopReason, "production_deferred"); assert.equal(deferred.retry.passes, 1); assert.equal(searched, 1);
    assert.equal((await t.state.getQueue()).jobs[0].attempts, 0);
    const src = await readFile("scripts/run-daily-operations.mjs", "utf8");
    assert.match(src, /productionEnabled && channel\.id === "Primeplug"/);
  } finally { await t.cleanup(); }
});

test("default multi-channel operation remains a single pass unless explicitly configured", async () => {
  const t = await setup();
  try {
    let providerCalls = 0;
    const summary = await runDailyOperations({ channels: [channel], nicheRegistry: registry, openState: async () => t.state, candidateProvider: async () => { providerCalls++; return []; }, produceJob: async () => ({ produced: true }) });
    assert.equal(providerCalls, 1); assert.equal(summary.runs[0].produced, 0);
    assert.equal(summary.runs[0].retry, undefined);
  } finally { await t.cleanup(); }
});

test("retry stops on the first produced video and leaves other planned jobs queued", async () => {
  const t = await setup();
  try {
    const called = [];
    const run = await runChannelWithProductionRetries({ channel, niche, state: t.state,
      candidateProvider: async () => [candidate("first"), candidate("second"), candidate("third")],
      produceJob: async (job) => { called.push(job.candidate.id); return { produced: true }; }
    });
    assert.deepEqual(called, ["first"]); assert.equal(run.attempted, 1); assert.equal(run.produced, 1);
    assert.equal(run.retry.stopReason, "produced");
    assert.deepEqual((await t.state.getQueue()).jobs.map(j => j.status), ["completed", "queued", "queued"]);
  } finally { await t.cleanup(); }
});

test("a lower configured daily candidate limit also caps total retry attempts", async () => {
  const t = await setup();
  try {
    const lower = { ...channel, operation: { ...channel.operation, maxCandidatesPerDay: 2 } };
    let called = 0;
    const run = await runChannelWithProductionRetries({ channel: lower, niche, state: t.state, maxJobs: 4,
      candidateProvider: async (_c, _n, { pass }) => [candidate(`limit-${pass}-a`), candidate(`limit-${pass}-b`)],
      produceJob: async () => { called++; return { produced: false, outcome: "held" }; }
    });
    assert.equal(called, 2); assert.equal(run.retry.maxProductionAttempts, 2); assert.equal(run.retry.stopReason, "attempt_limit_reached");
  } finally { await t.cleanup(); }
});

test("legacy eligible discoveries with no queue entry can get a plan, but used Commons URL variants remain duplicates", async () => {
  const t = await setup();
  try {
    const original = candidate("legacy"); const tracking = { ...original, sourceUrl: `${original.sourceUrl}?utm_source=commons.wikimedia.org` };
    // Old runs called unplanned and over-capacity sources "eligible".
    await t.state.recordSource(tracking, "eligible");
    let produced = 0;
    const first = await runChannelCycle({ channel, niche, state: t.state, candidateProvider: async () => [original], produceJob: async () => { produced++; return { produced: true }; } });
    assert.equal(first.enqueued, 1); assert.equal(produced, 1);
    const second = await runChannelCycle({ channel, niche, state: t.state, candidateProvider: async () => [tracking], produceJob: async () => { produced++; return { produced: true }; } });
    assert.equal(second.duplicates, 1); assert.equal(produced, 1);
    assert.equal((await t.state.getQueue()).jobs.length, 1);
  } finally { await t.cleanup(); }
});

test("reports preserve work already performed if a later state operation fails", async () => {
  const t = await setup();
  try {
    const save = t.state.saveQueue.bind(t.state); let writes = 0;
    t.state.saveQueue = async (queue) => { writes++; if (writes === 5) throw new Error("simulated state write failure"); return save(queue); };
    const run = await runChannelWithProductionRetries({ channel, niche, state: t.state,
      candidateProvider: async () => [candidate("first-error"), candidate("second-error")],
      produceJob: async () => ({ produced: false, outcome: "held" })
    });
    assert.equal(run.status, "error"); assert.equal(run.retry.passes, 1);
    assert.ok(run.attempted >= 1); assert.equal(run.completed, 1); assert.equal(run.produced, 0);
    assert.match(run.error, /state write failure/);
  } finally { await t.cleanup(); }
});

test("payoff timing guard holds a cut-off story or narration, and is opt-in for older plans", async () => {
  const { validateStoryWindowTiming } = await import("../src/production/narrated-plan.js");
  const entry = { window: { startSeconds: 7, seconds: 15.3, minimumStorySeconds: 14 } };
  assert.equal(validateStoryWindowTiming(entry, 14, 22.52).valid, true);
  assert.equal(validateStoryWindowTiming(entry, 11, 22.52).valid, false);
  assert.equal(validateStoryWindowTiming(entry, 13.2, 22.52).valid, false, "shortest audio must reach the payoff, not merely the nominal video window");
  assert.equal(validateStoryWindowTiming(entry, 16, 22.52).valid, false);
  assert.equal(validateStoryWindowTiming(entry, 14, 20).valid, false);
  assert.equal(validateStoryWindowTiming({ window: { seconds: 15 } }, 20, 15).valid, true);
});

test("the two new candidate plans are complete, rights-attributed, non-test, and distinct", async () => {
  const seeds = JSON.parse(await readFile("config/primeplug-candidates.json", "utf8"));
  const { validateNarratedEntry } = await import("../src/production/narrated-plan.js");
  const selected = seeds.filter(s => ["puppies-share-bed-tokyo", "seal-diver-fin-skomer"].includes(s.id));
  assert.equal(selected.length, 2); assert.notEqual(selected[0].sourceUrl, selected[1].sourceUrl);
  for (const seed of selected) {
    assert.equal(isDailyProductionSeed(seed), true);
    assert.equal(validateNarratedEntry(seed).valid, true);
    assert.ok(seed.window.minimumStorySeconds > 0);
    assert.match(seed.license.attributionRequirement, /creativecommons\.org\/licenses\//);
  }
  const seal = selected.find(s => s.id === "seal-diver-fin-skomer");
  assert.equal(seal.muteOriginalAudio, true);
  assert.match(seal.license.attributionRequirement, /Natural Resources Wales/);
});

test("only classified temporary outages may be retried on a later Lagos day", async () => {
  const { isTransientProductionOutcome, transientNextDayDecision } = await import("../src/engine/retry-policy.js");
  assert.equal(isTransientProductionOutcome({ status: "rejected_source_unavailable", reason: "HTTP 429" }), true);
  assert.equal(isTransientProductionOutcome({ status: "rejected_source_unavailable", reason: "HTTP 404" }), false);
  assert.equal(isTransientProductionOutcome({ status: "held_source_overlay", reason: "network timeout" }), false);
  const seed = narratedSeed();
  const job = { status: "failed", candidate: { id: seed.id, sourceUrl: seed.sourceUrl }, updatedAt: "2026-11-08T23:45:00.000Z", lastError: "Temporary production dependency failure: rejected_source_unavailable" };
  assert.equal(transientNextDayDecision(job, seed, { now: new Date("2026-11-09T05:30:00Z") }), false, "both timestamps are the same Lagos day");
  assert.equal(transientNextDayDecision(job, seed, { now: new Date("2026-11-10T05:30:00Z") }), true);
  assert.equal(transientNextDayDecision({ ...job, lastError: "held_source_overlay" }, seed, { now: new Date("2026-11-10T05:30:00Z") }), false);
  assert.equal(transientNextDayDecision({ ...job, status: "completed" }, seed, { now: new Date("2026-11-10T05:30:00Z") }), false);
  assert.equal(transientNextDayDecision(job, { ...seed, testOnly: true }, { now: new Date("2026-11-10T05:30:00Z") }), false);
});

test("a missing narration provider hold reopens only after a provider is configured", async () => {
  const { ttsConfigurationRequeueDecision } = await import("../src/engine/retry-policy.js");
  const seed = narratedSeed(); const job = heldJob(seed, { outcome: "held_tts_not_configured" });
  assert.equal(ttsConfigurationRequeueDecision(job, seed, { ttsConfigured: false }), false);
  assert.equal(ttsConfigurationRequeueDecision(job, seed, { ttsConfigured: true }), true);
  assert.equal(ttsConfigurationRequeueDecision(heldJob(seed, { outcome: "held_source_overlay" }), seed, { ttsConfigured: true }), false);
  assert.equal(ttsConfigurationRequeueDecision(job, { ...seed, testOnly: true }, { ttsConfigured: true }), false);
});

test("source audio is muted unless explicitly enabled with separate clearance; explicit mute always wins", async () => {
  const { shouldMixOriginalAudio, validateOriginalAudioPlan } = await import("../src/production/narrated-plan.js");
  const cleared = { enabled: true, rightsStatus: "licensed", rightsEvidenceUrl: "https://example.org/audio-rights", license: "CC BY 4.0", allAudioElementsCleared: true, commercialUseAllowed: true, derivativesAllowed: true, basis: "Every sound and musical element in the source audio has been separately reviewed.", attribution: "Sound creator, CC BY 4.0" };
  assert.equal(shouldMixOriginalAudio({ hasAudio: true }, {}), false);
  assert.equal(shouldMixOriginalAudio({ hasAudio: true }, { sourceAudio: cleared }), true);
  assert.equal(shouldMixOriginalAudio({ hasAudio: true }, { sourceAudio: cleared, muteOriginalAudio: true }), false);
  assert.equal(shouldMixOriginalAudio({ hasAudio: false }, { sourceAudio: cleared }), false);
  assert.equal(validateOriginalAudioPlan({ sourceAudio: { ...cleared, license: "CC BY-NC 4.0" } }).valid, false);
  assert.equal(validateOriginalAudioPlan({ sourceAudio: { ...cleared, allAudioElementsCleared: false } }).valid, false);
  assert.equal(validateOriginalAudioPlan({ sourceAudio: { ...cleared, rightsEvidenceUrl: "http://unsafe.example" } }).valid, false);
});
