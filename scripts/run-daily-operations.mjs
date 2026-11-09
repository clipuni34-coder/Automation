// Daily multi-channel operations run.
// For every configured channel, independently: load niche -> gather
// candidates (rights-evidenced seed sources + optional live discovery,
// which is research-only) -> screen rights -> dedupe against persistent
// state -> enqueue -> produce via the verified multi-candidate orchestrator
// -> record everything. One channel failing never stops the others.
// State lives in STATE_DIR (default data/state) and is designed to be
// persisted between cloud runs (see .github/workflows/daily-operations.yml).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { loadChannels } from "../src/config/channels.js";
import { loadNicheRegistry, buildDiscoveryConfig } from "../src/engine/niches.js";
import { openChannelState, sourceFingerprint } from "../src/engine/state.js";
import { runDailyOperations } from "../src/engine/scheduler.js";
import { isTransientRightsFailure, validateCurrentProductionAttempt } from "../src/engine/attempt-gate.js";
import { runDiscovery } from "../src/discovery/engine.js";
import { verifyCandidateRights } from "../src/engine/rights-verification.js";
import { collectCommonsCandidates } from "../src/discovery/sources/commons.js";
import { buildProductionReport } from "../src/engine/run-report.js";
import { isDailyProductionSeed, isTransientProductionOutcome, narratedRequeueDecision, transientNextDayDecision, ttsConfigurationRequeueDecision } from "../src/engine/retry-policy.js";
import { primeplugCreativePathwayGate } from "../src/engine/primeplug-creative-policy.js";

const stateRoot = resolve(process.env.STATE_DIR ?? "data/state");
const channelsPath = process.env.CHANNEL_PROFILES_PATH ?? "config/channels.json";
const nichesPath = process.env.NICHES_PATH ?? "config/niches.json";
const productionEnabled = process.env.DAILY_PRODUCTION_ENABLED === "true";
const dateKey = new Date().toISOString().slice(0, 10);
const reportDir = resolve(process.env.DAILY_REPORT_DIR ?? `output/daily/${dateKey}`);
await mkdir(reportDir, { recursive: true });

const channels = await loadChannels(channelsPath);
const nicheRegistry = await loadNicheRegistry(nichesPath);

const seedCandidateCache = new Map();
async function candidateProvider(channel, niche, { pass = 0 } = {}) {
  const candidates = [];
  // (a) Rights-evidenced production seeds. Audit fixtures remain available
  // for tests, but they are never selected for an ordinary daily run.
  // Retry passes reuse only the rights checks made in THIS workflow run.
  if (channel.seedCandidateManifest) {
    try {
      let cached = seedCandidateCache.get(channel.id);
      if (!cached) {
        cached = [];
        const seeds = JSON.parse(await readFile(channel.seedCandidateManifest, "utf8"));
        for (const seed of seeds) {
          if (!isDailyProductionSeed(seed)) continue;
          cached.push({
            id: seed.id, title: seed.label, sourceUrl: seed.sourceUrl, creator: seed.creator,
            supersedesCandidateId: seed.supersedesCandidateId ?? null,
            rightsEvidenceUrl: seed.rightsEvidenceUrl, license: seed.license,
            sourceResolution: seed.sourceResolution, seedManifestEntry: seed
          });
        }
        seedCandidateCache.set(channel.id, cached);
      }
      const state = await openChannelState(stateRoot, channel.id);
      const queue = await state.getQueue();
      for (const candidate of cached) {
        // Old completed seeds need no repeated API call. A queued job is
        // still rechecked by the attempt gate immediately before rendering.
        const alreadyQueued = queue.jobs.some((j) => j.candidate?.id === candidate.id && ["queued", "running", "completed", "failed"].includes(j.status));
        const used = candidate.supersedesCandidateId ? alreadyQueued : await state.hasUsedSource(candidate.sourceUrl, { rescreenRejected: true, reconsiderPlanned: true, reconsiderUnqueued: true });
        if (used || alreadyQueued) continue;
        if (!candidate.rightsVerification || (pass > 0 && isTransientRightsFailure(candidate.rightsVerification))) {
          candidate.rightsVerification = await verifyCandidateRights(candidate).catch((e) => ({ status: "evidence_recorded_not_independently_verified", verificationError: String(e?.message ?? e).slice(0, 200) }));
        }
        candidates.push(candidate);
      }
    } catch (error) { console.error(`[${channel.id}] seed manifest unreadable: ${error.message}`); }
  }
  // (c) Verified reusable-footage discovery (Wikimedia Commons API).
  // Every returned candidate has an exact licence verified on its own
  // file page; unverifiable or non-reusable results are rejected inside
  // the collector and never counted as production candidates.
  if (process.env.COMMONS_DISCOVERY !== "off" && channel.seedCandidateManifest) {
    try {
      // A retry searches a different, bounded slice of the channel's own
      // keywords. Discovery alone never creates a narration/editing plan.
      const queries = (channel.nicheKeywords ?? []).slice(pass * 3, pass * 3 + 3);
      const commons = await collectCommonsCandidates({ queries, perQuery: 3 });
      const prior = globalThis.__commonsDiscovery ?? { items: 0, rejected: [], attempts: [] };
      globalThis.__commonsDiscovery = {
        items: prior.items + commons.items.length,
        rejected: [...prior.rejected, ...commons.rejected].slice(0, 75),
        attempts: [...prior.attempts, { channelId: channel.id, pass: pass + 1, queries: queries.length, items: commons.items.length }]
      };
      for (const item of commons.items) candidates.push(item);
    } catch (error) { console.error(`[${channel.id}] commons discovery failed: ${error.message}`); }
  }
  // (b) Live daily discovery is research only, and is done ONCE per run so
  // retries do not multiply the YouTube search quota.
  if (pass === 0 && process.env.YOUTUBE_DATA_API_KEY) {
    try {
      const config = buildDiscoveryConfig(channel, niche);
      const result = await runDiscovery({ config, storePath: join(stateRoot, channel.id, "discovery-store.json") });
      for (const item of (result.candidates ?? []).slice(0, 25)) {
        candidates.push({ id: item.id, title: item.title, sourceUrl: item.sourceUrl, creator: item.creator ?? "unknown", researchOnly: true, discoveredScore: item.score ?? null });
      }
    } catch (error) { console.error(`[${channel.id}] discovery failed: ${error.message}`); }
  }
  return candidates;
}

async function produceJob(job, channel) {
  if (!productionEnabled) return { deferred: true, produced: false, reason: "Production disabled for this run (DAILY_PRODUCTION_ENABLED is not true). Candidate queued for the next enabled run.", candidate: job.candidate?.id ?? null };
  // Queued entries can be days old. Require a current, non-test manifest
  // candidate and an independent fresh rights check for every attempt.
  const gate = await validateCurrentProductionAttempt({ job, candidates: seedCandidateCache.get(channel.id) ?? [] });
  if (!gate.allowed && gate.retryable) throw new Error(`Fresh rights verification temporarily unavailable: ${gate.reason}`);
  if (!gate.allowed) return { produced: false, outcome: gate.outcome, reason: gate.reason };
  job.candidate = gate.candidate;
  const seed = gate.seed;
  const creativeGate = primeplugCreativePathwayGate(channel, seed);
  if (!creativeGate.allowed) return { produced: false, outcome: creativeGate.outcome, reason: creativeGate.reason };
  if (seed.productionMode === "narrated") {
    const channelWorkN = join(stateRoot, channel.id, "production");
    await mkdir(channelWorkN, { recursive: true });
    const manifestPathN = join(channelWorkN, `${job.candidate.id}.manifest.json`);
    await writeFile(manifestPathN, JSON.stringify([seed], null, 2));
    // A new directory for EVERY attempt prevents a crash from being mistaken
    // for a stale successful outcome left by a previous day or attempt.
    const outDirN = join(channelWorkN, "output", "attempts", randomUUID());
    const rn = spawnSync("node", ["scripts/produce-narrated.mjs", manifestPathN, outDirN, join(channelWorkN, "work")], { encoding: "utf8", timeout: 1500000, maxBuffer: 32 * 1024 * 1024 });
    if (rn.status !== 0) throw new Error(`Narrated production exited without a confirmed outcome: ${(rn.error?.message || rn.stderr || rn.stdout || "").slice(-300)}`);
    let outcomeN = null;
    try { outcomeN = JSON.parse(await readFile(join(outDirN, `${job.candidate.id}.candidate.json`), "utf8")); } catch { /* below */ }
    if (!outcomeN || outcomeN.id !== job.candidate.id) throw new Error(`Narrated production produced no matching outcome record: ${(rn.stderr || rn.stdout || "").slice(-300)}`);
    if (outcomeN.status === "completed") return { produced: true, outcome: outcomeN.status, pathway: "narrated", outputPath: outcomeN.outputPath, sha256: outcomeN.sha256, thumbnailPath: outcomeN.thumbnailPath ?? null, title: outcomeN.postingPackage?.title ?? null, postingPackage: outcomeN.postingPackage ?? null, creativeReview: outcomeN.creativeReview ?? null };
    if (isTransientProductionOutcome(outcomeN)) throw new Error(`Temporary production dependency failure: ${outcomeN.status}`);
    return { produced: false, outcome: outcomeN.status, pathway: "narrated", reason: outcomeN.reason };
  }
  const channelWork = join(stateRoot, channel.id, "production");
  await mkdir(channelWork, { recursive: true });
  const manifestPath = join(channelWork, `${job.candidate.id}.manifest.json`);
  await writeFile(manifestPath, JSON.stringify([seed], null, 2));
  const outDir = join(channelWork, "output", "attempts", randomUUID());
  const r = spawnSync("node", ["scripts/produce-candidates.mjs", manifestPath, outDir, join(channelWork, "work")], { encoding: "utf8", timeout: 1500000, maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`Production exited without a confirmed outcome: ${(r.error?.message || r.stderr || r.stdout || "").slice(-300)}`);
  let outcome = null;
  try { outcome = JSON.parse(await readFile(join(outDir, `${job.candidate.id}.candidate.json`), "utf8")); } catch { /* below */ }
  if (!outcome || outcome.id !== job.candidate.id) throw new Error(`Production produced no matching outcome record: ${(r.stderr || r.stdout || "").slice(-300)}`);
  if (outcome.status === "completed") {
    let pkg = outcome.postingPackage ?? null;
    if (!pkg) { try { const rep = JSON.parse(await readFile(join(outDir, `${job.candidate.id}.repurpose.json`), "utf8")); pkg = rep.postingPackage?.platformPackages?.youtube_shorts ?? null; } catch { /* package optional */ } }
    return { produced: true, outcome: outcome.status, outputPath: outcome.outputPath, sha256: outcome.sha256, thumbnailPath: outcome.thumbnailPath ?? null, title: pkg?.title ?? outcome.pipeline?.title ?? null, postingPackage: pkg ? { title: pkg.title, description: pkg.description, hashtags: pkg.hashtags } : null };
  }
  if (isTransientProductionOutcome(outcome)) throw new Error(`Temporary production dependency failure: ${outcome.status}`);
  // Held/rejected is a successful *decision*, not a job failure to retry forever.
  return { produced: false, outcome: outcome.status, reason: outcome.reason };
}

// Revive deferred jobs stuck as completed by production-disabled cycles.
for (const channel of channels) {
  try {
    const st = await openChannelState(stateRoot, channel.id);
    const q = await st.getQueue();
    let revived = 0;
    for (const job of q.jobs) {
      if (job.status === "completed" && job.result?.produced === false && /Production disabled/i.test(job.result?.reason ?? "")) {
        job.status = "queued"; job.attempts = 0; job.result = { ...(job.result ?? {}), revivedAt: new Date().toISOString(), note: "Re-queued: earlier completion was a production-disabled deferral, not production." };
        revived += 1;
      }
    }
    if (revived) { await st.saveQueue(q); console.log(`[${channel.id}] revived ${revived} production-disabled deferral(s)`); }
  } catch (error) { console.error(`[${channel.id}] revive failed: ${error.message}`); }
}

// Requeue a genuinely changed complete plan or a corrected infrastructure
// condition, never an unchanged editorial/overlay hold or a test fixture.
// Check only whether narration is configured; never log or expose secrets.
const ttsConfigured = Boolean((process.env.ENABLE_GEMINI_TTS === "true" && process.env.GEMINI_API_KEY)
  || (existsSync(resolve(process.env.KOKORO_MODEL_PATH ?? "models/kokoro/kokoro-v1.0.onnx"))
    && existsSync(resolve(process.env.KOKORO_VOICES_PATH ?? "models/kokoro/voices-v1.0.bin"))));
for (const channel of channels) {
  if (!channel.seedCandidateManifest) continue;
  try {
    const seeds = JSON.parse(await readFile(channel.seedCandidateManifest, "utf8"));
    const byId = new Map(seeds.map((x) => [x.id, x]));
    const st = await openChannelState(stateRoot, channel.id);
    const q = await st.getQueue();
    let requeued = 0;
    for (const job of q.jobs) {
      const current = byId.get(job.candidate?.id);
      const decision = narratedRequeueDecision(job, current);
      if (decision.requeue) {
        job.status = "queued"; job.attempts = 0;
        job.candidate.seedManifestEntry = current;
        job.result = { ...(job.result ?? {}), requeuedForNarratedPathwayAt: new Date().toISOString(), requeueReason: decision.reason };
        requeued += 1;
      } else if (transientNextDayDecision(job, current, { timeZone: channel.timezone ?? "Africa/Lagos" })) {
        job.status = "queued"; job.attempts = 0;
        job.result = { ...(job.result ?? {}), requeuedAfterTransientFailureAt: new Date().toISOString(), requeueReason: "next_local_day_after_transient_dependency_failure" };
        requeued += 1;
      } else if (ttsConfigurationRequeueDecision(job, current, { ttsConfigured })) {
        job.status = "queued"; job.attempts = 0;
        job.result = { ...(job.result ?? {}), requeuedAfterTtsConfiguredAt: new Date().toISOString(), requeueReason: "narration_now_configured" };
        requeued += 1;
      }
    }
    if (requeued) { await st.saveQueue(q); console.log(`[${channel.id}] requeued ${requeued} job(s) for the narrated pathway`); }
  } catch (error) { console.error(`[${channel.id}] narrated requeue failed: ${error.message}`); }
}

// Cancel queued/failed seed jobs that are no longer production seeds,
// including explicit audit fixtures. Retain the fixture records for tests.
// Discovery-sourced jobs (no seed entry) are untouched.
for (const channel of channels) {
  if (!channel.seedCandidateManifest) continue;
  try {
    const seeds = JSON.parse(await readFile(channel.seedCandidateManifest, "utf8"));
    const currentIds = new Set(seeds.filter(isDailyProductionSeed).map((x) => x.id));
    const st = await openChannelState(stateRoot, channel.id);
    const q = await st.getQueue();
    let cancelled = 0;
    for (const job of q.jobs) {
      if (["queued", "failed"].includes(job.status) && job.candidate?.seedManifestEntry && !currentIds.has(job.candidate.id)) {
        job.status = "cancelled"; job.result = { produced: false, reason: "Superseded or test-only: seed is not in this channel's current production manifest." };
        cancelled += 1;
      }
    }
    if (cancelled) { await st.saveQueue(q); console.log(`[${channel.id}] cancelled ${cancelled} superseded off-niche job(s)`); }
  } catch (error) { console.error(`[${channel.id}] supersede cleanup failed: ${error.message}`); }
}

const summary = await runDailyOperations({
  channels, nicheRegistry,
  openState: (id) => openChannelState(stateRoot, id),
  candidateProvider, produceJob,
  // No additional schedules or uploads: if Primeplug makes nothing on a
  // production-enabled run, try other screened/planned candidates in the
  // same run, with at most three discovery passes and four work attempts.
  retryPolicyForChannel: (channel) => productionEnabled && channel.id === "Primeplug" ? { maxPasses: 3, maxJobs: 4 } : null
});
// Production outcome is reported separately from execution outcome: a
// production-enabled run with zero produced videos is `no_production`.
summary.commonsDiscovery = globalThis.__commonsDiscovery ?? { items: 0, rejected: [] };
summary.productionReport = buildProductionReport(summary, { productionEnabled });
await writeFile(join(reportDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, runs: summary.runs?.map((r) => ({ channelId: r.channelId, status: r.status, discovered: r.discovered, rightsVerified: r.rightsVerified, eligible: r.eligible, produced: r.produced })) }, null, 2));
