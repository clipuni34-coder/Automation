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
        candidates.push({
          id: seed.id, title: seed.label, sourceUrl: seed.sourceUrl, creator: seed.creator,
          rightsEvidenceUrl: seed.rightsEvidenceUrl, license: seed.license,
          sourceResolution: seed.sourceResolution, seedManifestEntry: seed
        });
      }
    } catch (error) { console.error(`[${channel.id}] seed manifest unreadable: ${error.message}`); }
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
  if (!productionEnabled) return { produced: false, reason: "Production disabled for this run (DAILY_PRODUCTION_ENABLED is not true). Candidate queued for the next enabled run.", candidate: job.candidate?.id ?? null };
  const seed = job.candidate?.seedManifestEntry;
  if (!seed) throw new Error("Job candidate has no seed manifest entry; cannot produce");
  const channelWork = join(stateRoot, channel.id, "production");
  await mkdir(channelWork, { recursive: true });
  const manifestPath = join(channelWork, `${job.candidate.id}.manifest.json`);
  await writeFile(manifestPath, JSON.stringify([seed], null, 2));
  const outDir = join(channelWork, "output");
  const r = spawnSync("node", ["scripts/produce-candidates.mjs", manifestPath, outDir, join(channelWork, "work")], { encoding: "utf8", timeout: 1500000, maxBuffer: 32 * 1024 * 1024 });
  let outcome = null;
  try { outcome = JSON.parse(await readFile(join(outDir, `${job.candidate.id}.candidate.json`), "utf8")); } catch { /* below */ }
  if (!outcome) throw new Error(`Production produced no outcome record: ${(r.stderr || r.stdout || "").slice(-300)}`);
  if (outcome.status === "completed") return { produced: true, outcome: outcome.status, outputPath: outcome.outputPath, sha256: outcome.sha256 };
  // Held/rejected is a successful *decision*, not a job failure to retry forever.
  return { produced: false, outcome: outcome.status, reason: outcome.reason };
}

const summary = await runDailyOperations({
  channels, nicheRegistry,
  openState: (id) => openChannelState(stateRoot, id),
  candidateProvider, produceJob
});
await writeFile(join(reportDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
