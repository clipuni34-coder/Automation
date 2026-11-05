// Narration-first producer for worthwhile non-speech real footage.
// For each manifest entry with productionMode "narrated":
//   rights/host gates (same standard as produce-candidates) -> download
//   -> probe (>=720p native; audio NOT required) -> original commentary
//   script narrated via configured TTS (Gemini when ENABLE_GEMINI_TTS=true,
//   else local Kokoro; if neither is configured the candidate is HELD,
//   never silently faked) -> vertical 9:16 re-edit of the selected window
//   with narration as primary audio (original audio ducked underneath
//   when present) -> burned captions incl. a distinct hook cue ->
//   thumbnail -> technical QC/repair -> SHA-256 -> posting package.
// Publishing is never performed here.
// Usage: node scripts/produce-narrated.mjs [manifest] [outDir] [workDir]
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { join, resolve } from "node:path";
import { qcAndRepair, probeVideo } from "../src/production/qc-repair.js";
import { generateNarration } from "../src/production/voice.js";
import { buildCaptionCues, buildAssDocument, validateNarratedEntry } from "../src/production/narrated-plan.js";

const manifestPath = resolve(process.argv[2] ?? "config/primeplug-candidates.json");
const outDir = resolve(process.argv[3] ?? "output/narrated");
const workDir = resolve(process.argv[4] ?? "work/narrated");
const ALLOWED_HOSTS = new Set(["upload.wikimedia.org", "commons.wikimedia.org", "nasa.gov", "www.nasa.gov", "svs.gsfc.nasa.gov"]);
const APPROVED_RIGHTS = new Set(["owned_by_user", "permission_granted", "licensed", "public_domain"]);
const MIN_SOURCE_HEIGHT = 720;

await mkdir(outDir, { recursive: true });
await mkdir(workDir, { recursive: true });

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: opts.timeout ?? 900000, maxBuffer: 32 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
function probe(path) {
  const r = run("ffprobe", ["-v", "error", "-show_entries", "format=duration,size:stream=codec_name,codec_type,width,height", "-of", "json", path], { timeout: 120000 });
  if (r.status !== 0) return null;
  const parsed = JSON.parse(r.stdout);
  const video = (parsed.streams ?? []).find((s) => s.codec_type === "video");
  const audio = (parsed.streams ?? []).find((s) => s.codec_type === "audio");
  return { width: video?.width ?? 0, height: video?.height ?? 0, durationSeconds: Number(parsed.format?.duration ?? 0), hasAudio: Boolean(audio) };
}
async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
function audioDurationSeconds(path) {
  const r = run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path], { timeout: 60000 });
  const value = Number(r.stdout.trim());
  return Number.isFinite(value) ? value : 0;
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const outcomes = [];

for (const entry of manifest) {
  if (entry.productionMode !== "narrated") continue;
  const outcome = {
    id: entry.id, label: entry.label, creator: entry.creator, pathway: "narrated",
    sourceUrl: entry.sourceUrl, rightsEvidenceUrl: entry.rightsEvidenceUrl, license: entry.license ?? null,
    status: "processing", reason: null, outputPath: null, thumbnailPath: null, sha256: null,
    startedAt: new Date().toISOString(), finishedAt: null
  };
  const done = async (status, reason) => {
    outcome.status = status; outcome.reason = reason; outcome.finishedAt = new Date().toISOString();
    await writeFile(join(outDir, `${entry.id}.candidate.json`), JSON.stringify(outcome, null, 2));
    outcomes.push(outcome);
    console.log(JSON.stringify({ id: entry.id, status, reason: reason?.slice(0, 200) ?? null }));
  };

  let url;
  try { url = new URL(entry.sourceUrl); if (url.protocol !== "https:") throw new Error("not https"); if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error(`host ${url.hostname} is not allowlisted`); }
  catch (e) { await done("rejected_invalid_url", `Source URL invalid or not allowlisted: ${e.message}`); continue; }

  const lic = entry.license ?? {};
  if (!APPROVED_RIGHTS.has(lic.rightsStatus) || !lic.basis || !entry.rightsEvidenceUrl?.startsWith("https://")) {
    await done("rejected_rights_unverified", "Licence record incomplete or not an approved rights status. Blocked."); continue;
  }
  const validation = validateNarratedEntry(entry);
  if (!validation.valid) { await done("held_narration_plan_incomplete", `Narration plan incomplete: ${validation.reasons.join(" ")}`); continue; }
  outcome.narrationWords = validation.narrationWords;

  const rawPath = join(workDir, `${entry.id}.source`);
  const dl = run("curl", ["-fsSL", "-o", rawPath, entry.sourceUrl], { timeout: 1200000 });
  if (dl.status !== 0) { await done("rejected_source_unavailable", `Download failed: ${dl.stderr.slice(-300)}`); continue; }
  const originalProbe = probe(rawPath);
  if (!originalProbe) { await done("failed_probe", "Downloaded file could not be probed."); continue; }
  outcome.originalProbe = originalProbe;
  if (originalProbe.height < MIN_SOURCE_HEIGHT) { await done("rejected_low_resolution", `Original footage is ${originalProbe.width}x${originalProbe.height}; minimum ${MIN_SOURCE_HEIGHT}p native.`); continue; }

  // Narration (original commentary). No TTS configured -> truthful hold.
  const narrationPath = join(workDir, `${entry.id}.narration.wav`);
  let narration;
  try {
    narration = await generateNarration({ text: entry.narrationScript, outputPath: narrationPath });
  } catch (error) {
    await done("held_tts_unavailable", `Narration generation failed: ${String(error?.message ?? error).slice(0, 300)}`); continue;
  }
  if (narration.status !== "generated") { await done("held_tts_not_configured", "No narration provider is configured (Gemini TTS requires ENABLE_GEMINI_TTS=true with GEMINI_API_KEY, or local Kokoro models). Candidate held, not faked."); continue; }
  outcome.narration = { provider: narration.provider, model: narration.model ?? null };
  const narrationSeconds = audioDurationSeconds(narrationPath);
  if (!(narrationSeconds >= 8)) { await done("failed_narration", `Narration audio invalid or too short (${narrationSeconds}s).`); continue; }

  // Vertical re-edit of the chosen story window, timed to the narration.
  const windowStart = Number(entry.window?.startSeconds ?? 0);
  const windowSeconds = Math.min(Number(entry.window?.seconds ?? 30), Math.max(10, narrationSeconds + 1));
  const cues = buildCaptionCues(entry.narrationScript, narrationSeconds);
  const assPath = join(workDir, `${entry.id}.captions.ass`);
  await writeFile(assPath, buildAssDocument(cues, { title: entry.postingTitle }));
  outcome.captionCues = cues.length;

  const outputPath = join(outDir, `${entry.id}.mp4`);
  const filter = `[0:v]trim=start=${windowStart}:duration=${windowSeconds},setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,subtitles=${assPath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "'\\''")}[v]`;
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", rawPath, "-i", narrationPath, "-filter_complex", filter];
  if (originalProbe.hasAudio) {
    args.push("-filter_complex", `${filter};[0:a]atrim=start=${windowStart}:duration=${windowSeconds},asetpts=PTS-STARTPTS,volume=0.12[bg];[1:a]asetpts=PTS-STARTPTS,volume=1.0[na];[bg][na]amix=inputs=2:duration=first:dropout_transition=0[a]`, "-map", "[v]", "-map", "[a]");
  } else {
    args.push("-map", "[v]", "-map", "1:a");
  }
  // Rebuild args cleanly (filter defined once above).
  const finalArgs = ["-y", "-hide_banner", "-loglevel", "error", "-i", rawPath, "-i", narrationPath];
  if (originalProbe.hasAudio) {
    finalArgs.push("-filter_complex", `${filter};[0:a]atrim=start=${windowStart}:duration=${windowSeconds},asetpts=PTS-STARTPTS,volume=0.12[bg];[1:a]asetpts=PTS-STARTPTS,volume=1.0[na];[bg][na]amix=inputs=2:duration=first:dropout_transition=0[a]`, "-map", "[v]", "-map", "[a]");
  } else {
    finalArgs.push("-filter_complex", filter, "-map", "[v]", "-map", "1:a");
  }
  finalArgs.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-shortest", outputPath);
  const render = run("ffmpeg", finalArgs, { timeout: 1200000 });
  if (render.status !== 0) { await done("failed_render", `Vertical narrated render failed: ${render.stderr.slice(-300)}`); continue; }
  outcome.outputPath = outputPath;

  const thumbPath = join(outDir, `${entry.id}.thumbnail.jpg`);
  const thumb = run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(Math.min(3, narrationSeconds / 2)), "-i", outputPath, "-frames:v", "1", "-q:v", "2", thumbPath], { timeout: 120000 });
  if (thumb.status === 0) outcome.thumbnailPath = thumbPath;

  const qc = await qcAndRepair(outputPath, {}).catch((e) => ({ status: "failed", failures: [e.message] }));
  outcome.qc = qc;
  if (qc.status === "failed") { await done("failed_qc", `Technical QC failed after repair attempt: ${(qc.failures ?? []).join("; ")}`); continue; }
  outcome.outputProbe = await probeVideo(outputPath, {}).catch(() => qc.probe);
  outcome.sha256 = await sha256(outputPath);
  outcome.pipeline = {
    status: "completed", pathway: "narrated", wordCount: validation.narrationWords,
    editorialAverage: null, title: entry.postingTitle,
    selectedMoments: cues.slice(0, 4).map((c) => c.text)
  };
  outcome.postingPackage = {
    title: entry.postingTitle,
    description: [entry.postingDescription ?? entry.narrationScript, "", `Source: ${entry.sourceUrl}`, `Credit: ${entry.creator}. Rights: ${lic.type} — ${lic.attributionRequirement ?? ""}`, "Original commentary narration, captions and edit by Primeplug."].join("\n").slice(0, 4500),
    hashtags: entry.hashtags ?? ["#Shorts", "#funny", "#moments"]
  };
  await done("completed", null);
}

await writeFile(join(outDir, "narrated-summary.json"), JSON.stringify({
  producedAt: new Date().toISOString(), total: outcomes.length,
  completed: outcomes.filter((o) => o.status === "completed").length,
  outcomes: outcomes.map((o) => ({ id: o.id, status: o.status, reason: o.reason }))
}, null, 2));
console.log(JSON.stringify({ total: outcomes.length, completed: outcomes.filter((o) => o.status === "completed").map((o) => o.id) }));
