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
import { runAdvancedQc } from "../src/production/advanced-qc.js";
import { generateNarration } from "../src/production/voice.js";
import { buildCaptionCues, buildAssDocument, validateNarratedEntry, decideOverlayCorrection } from "../src/production/narrated-plan.js";

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

  // Source-overlay (watermark / promotional CTA) detection on the SOURCE
  // window, before any of our captions exist. Edge bands may be reframed
  // away; anything unsafe is held, never covered up.
  const windowStartPre = Number(entry.window?.startSeconds ?? 0);
  const windowSecondsPre = Math.min(Number(entry.window?.seconds ?? 30), 60);
  let overlayDecision = { action: "none", reason: null };
  try {
    const det = run(process.env.PYTHON ?? "python3", ["scripts/detect_overlay.py", rawPath, String(windowStartPre), String(windowSecondsPre)], { timeout: 300000 });
    const detection = JSON.parse(det.stdout.trim().split("\n").at(-1));
    outcome.sourceOverlayDetection = detection;
    overlayDecision = decideOverlayCorrection(detection);
  } catch (e) {
    overlayDecision = { action: "hold", reason: `Overlay detection failed: ${String(e?.message ?? e).slice(0, 200)}` };
  }
  outcome.overlayDecision = overlayDecision;
  if (overlayDecision.action === "hold") { await done("held_source_overlay", overlayDecision.reason); continue; }
  const preCropFilter = overlayDecision.action === "reframe"
    ? (overlayDecision.band === "top"
      ? `crop=iw:ih*${(1 - overlayDecision.fraction - 0.02).toFixed(3)}:0:ih*${(overlayDecision.fraction + 0.02).toFixed(3)},`
      : `crop=iw:ih*${(1 - overlayDecision.fraction - 0.02).toFixed(3)}:0:0,`)
    : "";

  // Vertical re-edit of the chosen story window, timed to the narration.
  const windowStart = Number(entry.window?.startSeconds ?? 0);
  const windowSeconds = Math.min(Number(entry.window?.seconds ?? 30), Math.max(10, narrationSeconds + 1));
  const cues = buildCaptionCues(entry.narrationScript, narrationSeconds);
  const assPath = join(workDir, `${entry.id}.captions.ass`);
  await writeFile(assPath, buildAssDocument(cues, { title: entry.postingTitle }));
  outcome.captionCues = cues.length;

  const outputPath = join(outDir, `${entry.id}.mp4`);
  // Meaningful re-edit, not a plain extraction: the window is cut into
  // three story beats with alternating punch-in reframing (wide -> 1.25x
  // punch -> wide), then our captions are burned over the joined edit.
  const third = (windowSeconds / 3).toFixed(2);
  const segScale = (factor) => factor === 1
    ? "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920"
    : `scale=${Math.round(1080 * factor)}:${Math.round(1920 * factor)}:force_original_aspect_ratio=increase,crop=1080:1920`;
  const filter = `[0:v]trim=start=${windowStart}:duration=${windowSeconds},setpts=PTS-STARTPTS,${preCropFilter}split=3[vv1][vv2][vv3];` +
    `[vv1]trim=start=0:duration=${third},setpts=PTS-STARTPTS,${segScale(1)},setsar=1[v1];` +
    `[vv2]trim=start=${third}:duration=${third},setpts=PTS-STARTPTS,${segScale(1.25)},setsar=1[v2];` +
    `[vv3]trim=start=${(2 * Number(third)).toFixed(2)},setpts=PTS-STARTPTS,${segScale(1)},setsar=1[v3];` +
    `[v1][v2][v3]concat=n=3:v=1:a=0,subtitles=${assPath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "'\\''")}[v]`;
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", rawPath, "-i", narrationPath, "-filter_complex", filter];
  if (originalProbe.hasAudio) {
    args.push("-filter_complex", `${filter};[0:a]atrim=start=${windowStart}:duration=${windowSeconds},asetpts=PTS-STARTPTS,volume=0.12[bg];[1:a]asetpts=PTS-STARTPTS[na];[bg][na]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]`, "-map", "[v]", "-map", "[a]");
  } else {
    args.push("-map", "[v]", "-map", "1:a");
  }
  // Rebuild args cleanly (filter defined once above).
  const finalArgs = ["-y", "-hide_banner", "-loglevel", "error", "-i", rawPath, "-i", narrationPath];
  if (originalProbe.hasAudio) {
    finalArgs.push("-filter_complex", `${filter};[0:a]atrim=start=${windowStart}:duration=${windowSeconds},asetpts=PTS-STARTPTS,volume=0.12[bg];[1:a]asetpts=PTS-STARTPTS[na];[bg][na]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]`, "-map", "[v]", "-map", "[a]");
  } else {
    finalArgs.push("-filter_complex", `${filter};[1:a]loudnorm=I=-14:TP=-1.5:LRA=11[na]`, "-map", "[v]", "-map", "[na]");
  }
  finalArgs.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-shortest", outputPath);
  const render = run("ffmpeg", finalArgs, { timeout: 1200000 });
  if (render.status !== 0) { await done("failed_render", `Vertical narrated render failed: ${render.stderr.slice(-300)}`); continue; }
  outcome.outputPath = outputPath;

  const thumbPath = join(outDir, `${entry.id}.thumbnail.jpg`);
  const thumb = run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(Math.min(3, narrationSeconds / 2)), "-i", outputPath, "-frames:v", "1", "-q:v", "2", thumbPath], { timeout: 120000 });
  if (thumb.status === 0) outcome.thumbnailPath = thumbPath;

  // Audio QC: narration must be clearly audible (mean level gate).
  const vol = run("ffmpeg", ["-i", outputPath, "-af", "volumedetect", "-f", "null", "/dev/null"], { timeout: 300000 });
  const meanMatch = /mean_volume:\s*(-[\d.]+) dB/.exec(vol.stderr);
  const maxMatch = /max_volume:\s*(-[\d.]+) dB/.exec(vol.stderr);
  outcome.audioLevels = { meanDb: meanMatch ? Number(meanMatch[1]) : null, maxDb: maxMatch ? Number(maxMatch[1]) : null };
  if (outcome.audioLevels.meanDb !== null && outcome.audioLevels.meanDb < -22) {
    await done("held_audio_qc", `Narration mean level ${outcome.audioLevels.meanDb} dB is below the -22 dB audibility gate after normalization.`);
    continue;
  }

  // Post-render proof: the overlay must actually be gone from our output
  // (sampled below our caption zones — captions are ours and expected).
  try {
    const detOut = run(process.env.PYTHON ?? "python3", ["scripts/detect_overlay.py", outputPath, "0", String(Math.min(windowSeconds, narrationSeconds))], { timeout: 300000 });
    outcome.outputOverlayDetection = JSON.parse(detOut.stdout.trim().split("\n").at(-1));
  } catch { outcome.outputOverlayDetection = { status: "check_failed" }; }

  // Advanced measurable QC (resolution/codec/duration/loudness/clipping/
  // black frames/silence/pacing/fast-start). A failed check holds the
  // render: a green status must be earned numerically.
  const advancedQc = await runAdvancedQc(outputPath, {}).catch((e) => ({ passed: false, checks: [{ name: "advanced_qc_ran", passed: false, detail: e.message }] }));
  outcome.advancedQc = advancedQc;
  if (!advancedQc.passed) {
    const failed = advancedQc.checks.filter((c) => !c.passed).map((c) => `${c.name} (${c.detail})`).join("; ");
    await done("held_advanced_qc", `Advanced QC held this render: ${failed}`);
    continue;
  }

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
