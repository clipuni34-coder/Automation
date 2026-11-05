// Multi-candidate production orchestrator.
// Processes EVERY manifest entry independently and records a truthful,
// structured outcome for each — completed, held, rejected or failed, always
// with a reason. One candidate's failure never stops the others.
//
// Stages per candidate: URL/host validation -> rights-record check ->
// retrieve original footage -> ffprobe (resolution/duration/audio) ->
// minimum-footage gates (>=720p, audio present) -> rights-gated repurpose
// pipeline (transcribe -> select -> render) -> technical QC (+repair) ->
// SHA256. Publishing is never performed here.
//
// Usage: node scripts/produce-candidates.mjs [manifest] [outDir] [workDir]
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { join, resolve } from "node:path";
import { qcAndRepair, probeVideo } from "../src/production/qc-repair.js";
import { classifyRepurpose } from "./candidate-utils.mjs";

const manifestPath = resolve(process.argv[2] ?? "config/candidate-manifest.json");
const outDir = resolve(process.argv[3] ?? "output/candidates");
const workDir = resolve(process.argv[4] ?? "work/candidates-cloud");
const ALLOWED_HOSTS = new Set(["upload.wikimedia.org", "commons.wikimedia.org", "nasa.gov", "www.nasa.gov", "svs.gsfc.nasa.gov"]);
const APPROVED_RIGHTS = new Set(["owned_by_user", "permission_granted", "licensed", "public_domain"]);
const MIN_SOURCE_HEIGHT = 720;

await mkdir(outDir, { recursive: true });
await mkdir(workDir, { recursive: true });

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: opts.timeout ?? 900000, maxBuffer: 32 * 1024 * 1024 });
  return { status: r.status, error: r.error, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
function probe(path) {
  const r = run("ffprobe", ["-v", "error", "-show_entries", "format=duration,size:stream=codec_name,codec_type,width,height", "-of", "json", path], { timeout: 120000 });
  if (r.status !== 0) return null;
  const parsed = JSON.parse(r.stdout);
  const video = (parsed.streams ?? []).find((s) => s.codec_type === "video");
  const audio = (parsed.streams ?? []).find((s) => s.codec_type === "audio");
  return { width: video?.width ?? 0, height: video?.height ?? 0, durationSeconds: Number(parsed.format?.duration ?? 0), sizeBytes: Number(parsed.format?.size ?? 0), videoCodec: video?.codec_name ?? null, audioCodec: audio?.codec_name ?? null, hasAudio: Boolean(audio) };
}
async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const outcomes = [];

for (const entry of manifest) {
  const started = new Date().toISOString();
  const outcome = {
    id: entry.id, label: entry.label, creator: entry.creator,
    sourceUrl: entry.sourceUrl, rightsEvidenceUrl: entry.rightsEvidenceUrl,
    license: entry.license ?? null, status: "processing", reason: null,
    sourceProbe: null, pipeline: null, qc: null, outputPath: null, thumbnailPath: null,
    sha256: null, startedAt: started, finishedAt: null
  };
  const done = async (status, reason) => {
    outcome.status = status; outcome.reason = reason; outcome.finishedAt = new Date().toISOString();
    await writeFile(join(outDir, `${entry.id}.candidate.json`), JSON.stringify(outcome, null, 2));
    outcomes.push(outcome);
    console.log(JSON.stringify({ id: entry.id, status, reason: reason?.slice(0, 200) ?? null }));
  };

  // 1 — URL + host validation
  let url;
  try { url = new URL(entry.sourceUrl); if (url.protocol !== "https:") throw new Error("not https"); if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error(`host ${url.hostname} is not allowlisted`); }
  catch (e) { await done("rejected_invalid_url", `Source URL invalid or not allowlisted: ${e.message}`); continue; }

  // 2 — Rights record must be complete and approved before any processing
  const lic = entry.license ?? {};
  if (!APPROVED_RIGHTS.has(lic.rightsStatus) || !lic.basis || !entry.rightsEvidenceUrl?.startsWith("https://")) {
    await done("rejected_rights_unverified", "Licence record is incomplete, not an approved rights status, or lacks an HTTPS evidence URL. Blocked from processing/publishing.");
    continue;
  }
  outcome.rightsVerification = { status: lic.verificationStatus ?? "evidence_recorded_not_independently_verified", basis: lic.basis, attributionRequirement: lic.attributionRequirement ?? null };

  // 3 — Source availability
  const head = await fetch(entry.sourceUrl, { method: "HEAD", redirect: "follow" }).catch(() => null);
  if (!head || !head.ok) { await done("rejected_source_unavailable", `Source URL did not return a successful response (HTTP ${head?.status ?? "unreachable"}).`); continue; }

  // 4 — Retrieve original footage (excerpt/transcode only as specified; originals never upscaled at intake)
  const proc2 = entry.processing ?? { mode: "full", targetDurationSeconds: 30 };
  const rawPath = join(workDir, `${entry.id}.source`);
  const dl = run("curl", ["-fsSL", "-o", rawPath, entry.sourceUrl], { timeout: 1200000 });
  if (dl.status !== 0) { await done("rejected_source_unavailable", `Download failed: ${dl.stderr.slice(-300)}`); continue; }
  const originalProbe = probe(rawPath);
  if (!originalProbe) { await done("failed_probe", "Downloaded file could not be probed by ffprobe."); continue; }
  outcome.originalProbe = originalProbe;

  let sourcePath = rawPath;
  if (proc2.mode === "excerpt" || proc2.mode === "transcode") {
    sourcePath = join(workDir, `${entry.id}.mp4`);
    const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", rawPath];
    if (proc2.mode === "excerpt") args.push("-t", String(proc2.excerptSeconds ?? 240));
    if (proc2.scaleHeight) args.push("-vf", `scale=-2:${proc2.scaleHeight}`);
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", sourcePath);
    const conv = run("ffmpeg", args, { timeout: 1200000 });
    if (conv.status !== 0) { await done("failed_probe", `Excerpt/transcode failed: ${conv.stderr.slice(-300)}`); continue; }
  }
  outcome.sourceProbe = probe(sourcePath);

  // 5 — Minimum footage gates on the ORIGINAL (native resolution, never upscaled credit)
  if ((originalProbe.height ?? 0) < MIN_SOURCE_HEIGHT) {
    await done("rejected_low_resolution", `Original footage is ${originalProbe.width}x${originalProbe.height}; minimum is ${MIN_SOURCE_HEIGHT}p native. Upscaling is not treated as HD.`);
    continue;
  }
  if (!originalProbe.hasAudio) { await done("rejected_no_audio", "Original footage has no audio stream."); continue; }

  // 6 — Rights-gated repurpose pipeline (transcribe -> select -> render -> package)
  const input = {
    sourceLocalPath: sourcePath,
    outputPath: join(outDir, `${entry.id}.mp4`),
    source: {
      sourceUrl: entry.sourceUrl, title: entry.label, creator: entry.creator,
      rightsStatus: lic.rightsStatus, rightsEvidenceUrl: entry.rightsEvidenceUrl,
      allowedPlatforms: ["youtube_shorts"],
      attribution: lic.attributionRequirement ?? entry.creator
    },
    targetDurationSeconds: proc2.targetDurationSeconds ?? 30,
    platform: "youtube_shorts", whisperModel: "base", pythonPath: process.env.PYTHON ?? "python3"
  };
  const inputPath = join(workDir, `${entry.id}.input.json`);
  const resultPath = join(outDir, `${entry.id}.repurpose.json`);
  await writeFile(inputPath, JSON.stringify(input, null, 2));
  const rep = run("node", ["src/clips/repurpose-cli.js", inputPath, resultPath], { timeout: 1500000 });
  let result = null;
  try { result = JSON.parse(await readFile(resultPath, "utf8")); } catch { /* handled below */ }
  // If only a long render timed out at pipeline level, retry once with provided timestamps at a shorter target.
  let classification = classifyRepurpose({ exitCode: rep.status, result, stderr: rep.stderr || rep.stdout });
  if (classification.status === "failed_pipeline" && result?.transcription?.transcriptPath) {
    try {
      const transcript = JSON.parse(await readFile(result.transcription.transcriptPath, "utf8"));
      const retryInput = { ...input, transcriptWords: transcript.words, targetDurationSeconds: Math.min(proc2.targetDurationSeconds ?? 30, 12), outputPath: input.outputPath };
      const retryPath = join(workDir, `${entry.id}.input-retry.json`);
      await writeFile(retryPath, JSON.stringify(retryInput, null, 2));
      const rep2 = run("node", ["src/clips/repurpose-cli.js", retryPath, resultPath], { timeout: 1500000 });
      result = JSON.parse(await readFile(resultPath, "utf8"));
      classification = classifyRepurpose({ exitCode: rep2.status, result, stderr: rep2.stderr || rep2.stdout });
      classification.retriedWithShorterTarget = true;
    } catch { /* keep original classification */ }
  }
  if (classification.status !== "completed") { await done(classification.status, classification.reason); continue; }

  outcome.pipeline = {
    status: result.status,
    wordCount: result.transcription?.wordCount ?? null,
    candidateCount: result.transcription?.candidateCount ?? null,
    editorialAverage: result.plan?.editorialQuality?.averageSelectedScore ?? null,
    visualQualityScore: result.rendered?.visualQuality?.score ?? null,
    selectedMoments: (result.plan?.editDecisionList ?? []).map((m) => m.caption).slice(0, 4),
    title: result.postingPackage?.title ?? null,
    retriedWithShorterTarget: classification.retriedWithShorterTarget ?? false
  };
  outcome.outputPath = result.outputPath;
  outcome.thumbnailPath = result.thumbnailPath ?? null;

  // 7 — Technical QC with one repair attempt
  const qc = await qcAndRepair(result.outputPath, {}).catch((e) => ({ status: "failed", failures: [e.message] }));
  outcome.qc = qc;
  if (qc.status === "failed") { await done("failed_qc", `Technical QC failed after repair attempt: ${(qc.failures ?? []).join("; ")}`); continue; }
  outcome.outputProbe = await probeVideo(result.outputPath, {}).catch(() => qc.probe);
  outcome.sha256 = await sha256(result.outputPath);
  await done("completed", null);
}

await writeFile(join(outDir, "production-summary.json"), JSON.stringify({
  producedAt: new Date().toISOString(), manifest: manifestPath,
  total: outcomes.length,
  completed: outcomes.filter((o) => o.status === "completed").length,
  heldOrRejected: outcomes.filter((o) => o.status.startsWith("held_") || o.status.startsWith("rejected_")).length,
  failed: outcomes.filter((o) => o.status.startsWith("failed_")).length,
  outcomes: outcomes.map((o) => ({ id: o.id, status: o.status, reason: o.reason }))
}, null, 2));
console.log(JSON.stringify({ total: outcomes.length, completed: outcomes.filter((o) => o.status === "completed").map((o) => o.id) }));
