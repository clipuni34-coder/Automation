// Daily multi-channel operations run.
// For every configured channel, independently: load niche -> gather
// candidates (rights-evidenced seed sources + optional live discovery,
// which is research-only) -> screen rights -> dedupe against persistent
// state -> enqueue -> produce via the verified multi-candidate orchestrator
// -> record everything. One channel failing never stops the others.
// State lives in STATE_DIR (default data/state) and is designed to be
// persisted between cloud runs (see .github/workflows/daily-operations.yml).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadChannels } from "../src/config/channels.js";
import { loadNicheRegistry, buildDiscoveryConfig } from "../src/engine/niches.js";
import { openChannelState, sourceFingerprint } from "../src/engine/state.js";
import { runDailyOperations } from "../src/engine/scheduler.js";
import { runDiscovery } from "../src/discovery/engine.js";
import { verifyCandidateRights } from "../src/engine/rights-verification.js";
import { collectCommonsCandidates } from "../src/discovery/sources/commons.js";
import { buildProductionReport } from "../src/engine/run-report.js";

const stateRoot = resolve(process.env.STATE_DIR ?? "data/state");
const channelsPath = process.env.CHANNEL_PROFILES_PATH ?? "config/channels.json";
const nichesPath = process.env.NICHES_PATH ?? "config/niches.json";
const productionEnabled = process.env.DAILY_PRODUCTION_ENABLED === "true";
const dateKey = new Date().toISOString().slice(0, 10);
const reportDir = resolve(process.env.DAILY_REPORT_DIR ?? `output/daily/${dateKey}`);
await mkdir(reportDir, { recursive: true });

const channels = await loadChannels(channelsPath);
const nicheRegistry = await loadNicheRegistry(nichesPath);

async function candidateProvider(channel, niche) {
  const candidates = [];
  // (a) Rights-evidenced seed sources configured for this channel.
  if (channel.seedCandidateManifest) {
    try {
      const seeds = JSON.parse(await readFile(channel.seedCandidateManifest, "utf8"));
      for (const seed of seeds) {
        const enriched = {
          id: seed.id, title: seed.label, sourceUrl: seed.sourceUrl, creator: seed.creator,
          supersedesCandidateId: seed.supersedesCandidateId ?? null,
          rightsEvidenceUrl: seed.rightsEvidenceUrl, license: seed.license,
          sourceResolution: seed.sourceResolution, seedManifestEntry: seed
        };
        // Independent rights check against the asset's actual file page.
        enriched.rightsVerification = await verifyCandidateRights(enriched).catch((e) => ({ status: "evidence_recorded_not_independently_verified", verificationError: String(e?.message ?? e).slice(0, 200) }));
        candidates.push(enriched);
      }
    } catch (error) { console.error(`[${channel.id}] seed manifest unreadable: ${error.message}`); }
  }
  // (c) Verified reusable-footage discovery (Wikimedia Commons API).
  // Every returned candidate has an exact licence verified on its own
  // file page; unverifiable or non-reusable results are rejected inside
  // the collector and never counted as production candidates.
  if (process.env.COMMONS_DISCOVERY !== "off" && channel.seedCandidateManifest) {
    try {
      const queries = (channel.nicheKeywords ?? []).slice(0, 3);
      const commons = await collectCommonsCandidates({ queries, perQuery: 3 });
      globalThis.__commonsDiscovery = { items: commons.items.length, rejected: commons.rejected.slice(0, 25) };
      for (const item of commons.items) candidates.push(item);
    } catch (error) { console.error(`[${channel.id}] commons discovery failed: ${error.message}`); }
  }
  // (b) Live daily discovery (research references only — never auto-cleared for reuse).
  if (process.env.YOUTUBE_DATA_API_KEY) {
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
  const seed = job.candidate?.seedManifestEntry;
  if (!seed) throw new Error("Job candidate has no seed manifest entry; cannot produce");
  if (seed.productionMode === "narrated") {
    const channelWorkN = join(stateRoot, channel.id, "production");
    await mkdir(channelWorkN, { recursive: true });
    const manifestPathN = join(channelWorkN, `${job.candidate.id}.manifest.json`);
    await writeFile(manifestPathN, JSON.stringify([seed], null, 2));
    const outDirN = join(channelWorkN, "output");
    const rn = spawnSync("node", ["scripts/produce-narrated.mjs", manifestPathN, outDirN, join(channelWorkN, "work")], { encoding: "utf8", timeout: 1500000, maxBuffer: 32 * 1024 * 1024 });
    let outcomeN = null;
    try { outcomeN = JSON.parse(await readFile(join(outDirN, `${job.candidate.id}.candidate.json`), "utf8")); } catch { /* below */ }
    if (!outcomeN) throw new Error(`Narrated production produced no outcome record: ${(rn.stderr || rn.stdout || "").slice(-300)}`);
    if (outcomeN.status === "completed") return { produced: true, outcome: outcomeN.status, pathway: "narrated", outputPath: outcomeN.outputPath, sha256: outcomeN.sha256, thumbnailPath: outcomeN.thumbnailPath ?? null, title: outcomeN.postingPackage?.title ?? null, postingPackage: outcomeN.postingPackage ?? null };
    return { produced: false, outcome: outcomeN.status, pathway: "narrated", reason: outcomeN.reason };
  }
  const channelWork = join(stateRoot, channel.id, "production");
  await mkdir(channelWork, { recursive: true });
  const manifestPath = join(channelWork, `${job.candidate.id}.manifest.json`);
  await writeFile(manifestPath, JSON.stringify([seed], null, 2));
  const outDir = join(channelWork, "output");
  const r = spawnSync("node", ["scripts/produce-candidates.mjs", manifestPath, outDir, join(channelWork, "work")], { encoding: "utf8", timeout: 1500000, maxBuffer: 32 * 1024 * 1024 });
  let outcome = null;
  try { outcome = JSON.parse(await readFile(join(outDir, `${job.candidate.id}.candidate.json`), "utf8")); } catch { /* below */ }
  if (!outcome) throw new Error(`Production produced no outcome record: ${(r.stderr || r.stdout || "").slice(-300)}`);
  if (outcome.status === "completed") {
    let pkg = outcome.postingPackage ?? null;
    if (!pkg) { try { const rep = JSON.parse(await readFile(join(outDir, `${job.candidate.id}.repurpose.json`), "utf8")); pkg = rep.postingPackage?.platformPackages?.youtube_shorts ?? null; } catch { /* package optional */ } }
    return { produced: true, outcome: outcome.status, outputPath: outcome.outputPath, sha256: outcome.sha256, thumbnailPath: outcome.thumbnailPath ?? null, title: pkg?.title ?? outcome.pipeline?.title ?? null, postingPackage: pkg ? { title: pkg.title, description: pkg.description, hashtags: pkg.hashtags } : null };
  }
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

// Requeue candidates that previously could not be produced (no speech /
// no audio) but whose current seed now routes to the narration-first
// pathway. This is a pathway change, not a retry of a failed decision.
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
      if (job.status === "completed" && job.result?.produced === false && current?.productionMode === "narrated") {
        job.status = "queued"; job.attempts = 0;
        job.candidate.seedManifestEntry = current;
        job.result = { ...(job.result ?? {}), requeuedForNarratedPathwayAt: new Date().toISOString() };
        requeued += 1;
      }
    }
    if (requeued) { await st.saveQueue(q); console.log(`[${channel.id}] requeued ${requeued} job(s) for the narrated pathway`); }
  } catch (error) { console.error(`[${channel.id}] narrated requeue failed: ${error.message}`); }
}

// Cancel queued seed jobs superseded by a niche/config change (their seed is
// no longer in the channel's current manifest) so stale off-niche work is
// never produced. Discovery-sourced jobs (no seed entry) are untouched.
for (const channel of channels) {
  if (!channel.seedCandidateManifest) continue;
  try {
    const seeds = JSON.parse(await readFile(channel.seedCandidateManifest, "utf8"));
    const currentIds = new Set(seeds.map((x) => x.id));
    const st = await openChannelState(stateRoot, channel.id);
    const q = await st.getQueue();
    let cancelled = 0;
    for (const job of q.jobs) {
      if (job.status === "queued" && job.candidate?.seedManifestEntry && !currentIds.has(job.candidate.id)) {
        job.status = "cancelled"; job.result = { produced: false, reason: "Superseded: seed is no longer in this channel's current niche manifest." };
        cancelled += 1;
      }
    }
    if (cancelled) { await st.saveQueue(q); console.log(`[${channel.id}] cancelled ${cancelled} superseded off-niche job(s)`); }
  } catch (error) { console.error(`[${channel.id}] supersede cleanup failed: ${error.message}`); }
}

const summary = await runDailyOperations({
  channels, nicheRegistry,
  openState: (id) => openChannelState(stateRoot, id),
  candidateProvider, produceJob
});
// Production outcome is reported separately from execution outcome: a
// production-enabled run with zero produced videos is `no_production`.
summary.commonsDiscovery = globalThis.__commonsDiscovery ?? { items: 0, rejected: [] };
summary.productionReport = buildProductionReport(summary, { productionEnabled });
await writeFile(join(reportDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, runs: summary.runs?.map((r) => ({ channelId: r.channelId, status: r.status, discovered: r.discovered, rightsVerified: r.rightsVerified, eligible: r.eligible, produced: r.produced })) }, null, 2));
