import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { assertAssetRights } from "../rights/asset-rights.js";
import { buildVisualQualityReport } from "./visual-qc.js";

const ALLOWED_SOURCE_TYPES = new Set(["original_graphic", "generated_visual", "public_domain", "licensed_stock", "creator_clip"]);
const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;

function run(command, args, { timeoutMs = 180000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${command} exited with code ${code}: ${stderr.slice(-3000)}`));
    });
  });
}

function escapeAss(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/{/g, "\\{").replace(/}/g, "\\}").split(String.fromCharCode(10)).join("\\N");
}

function assTime(seconds) {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor((centiseconds % 360000) / 6000);
  const secs = Math.floor((centiseconds % 6000) / 100);
  const cs = centiseconds % 100;
  return String(hours) + ":" + String(minutes).padStart(2, "0") + ":" + String(secs).padStart(2, "0") + "." + String(cs).padStart(2, "0");
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object") throw new Error("A render manifest is required");
  if (!Array.isArray(manifest.scenes) || manifest.scenes.length < 1 || manifest.scenes.length > 30) throw new Error("Manifest must contain between 1 and 30 scenes");
  if (!manifest.audioPath) throw new Error("A narration audioPath is required");
  let previousEnd = 0;
  for (const [index, scene] of manifest.scenes.entries()) {
    if ((!scene.imagePath && !scene.videoPath) || (scene.imagePath && scene.videoPath) || !Number.isFinite(scene.start) || !Number.isFinite(scene.end) || scene.start < 0 || scene.end <= scene.start) throw new Error("Scene " + (index + 1) + " needs exactly one imagePath or videoPath and a valid positive start/end time");
    if (Math.abs(scene.start - previousEnd) > 0.02) throw new Error("Scenes must be chronological and contiguous, starting at 0 seconds");
    previousEnd = scene.end;
    if (!ALLOWED_SOURCE_TYPES.has(scene.sourceType)) throw new Error("Scene " + (index + 1) + " has an unapproved or missing asset sourceType");
    if (["public_domain", "licensed_stock", "creator_clip"].includes(scene.sourceType) && (!scene.sourceUrl || !scene.license)) throw new Error("Scene " + (index + 1) + " must include sourceUrl and license provenance");
    if (scene.sourceType === "generated_visual" && (!scene.generationModel || !scene.generationPrompt)) throw new Error("Scene " + (index + 1) + " must include generated visual provenance");
    if (scene.sourceType === "creator_clip") assertAssetRights({ ...scene, durationSeconds: scene.end - scene.start }, { platform: manifest.targetPlatform ?? "youtube_shorts" });
  }
  return previousEnd;
}

function wrapCaption(value, maxChars = 30) {
  const words = String(value ?? "").trim().split(/\\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? line + " " + word : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function buildAss(scenes, duration) {
  const header = [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1920",
    "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Caption,DejaVu Sans,60,&H00FFFFFF,&H0000FFFF,&H00101010,&HCC101010,1,0,0,0,100,100,0,0,3,2,1,2,100,100,330,1", "",
    "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
  ];
  const events = [];
  for (const scene of scenes) {
    const lines = wrapCaption(scene.caption, 30);
    const chunks = [];
    for (let index = 0; index < lines.length; index += 2) chunks.push(lines.slice(index, index + 2).join("\\N"));
    const chunkDuration = (scene.end - scene.start) / Math.max(1, chunks.length);
    chunks.forEach((chunk, index) => {
      const start = scene.start + chunkDuration * index;
      const end = Math.min(scene.end, start + chunkDuration + 0.04);
      events.push("Dialogue: 0," + assTime(start) + "," + assTime(end) + ",Caption,,0,0,0,,{\\\\an2}" + escapeAss(chunk));
    });
  }
  return [...header, ...events, ""].join(String.fromCharCode(10));
}

export async function renderShortVideo(manifest, { ffmpegPath = "ffmpeg", ffprobePath = "ffprobe" } = {}) {
  const duration = validateManifest(manifest);
  const outputPath = resolve(manifest.outputPath ?? "output.mp4");
  const audioPath = resolve(manifest.audioPath);
  await access(audioPath);
  for (const scene of manifest.scenes) await access(resolve(scene.videoPath ?? scene.imagePath));
  await mkdir(dirname(outputPath), { recursive: true });
  const assPath = `${outputPath}.captions.ass`;
  await writeFile(assPath, buildAss(manifest.scenes, duration), { mode: 0o600 });

  const preserveSourceAudio = manifest.preserveSourceAudio !== false;
  const sourceAudioAvailable = await Promise.all(manifest.scenes.map(async (scene) => {
    if (!preserveSourceAudio || !scene.videoPath) return false;
    const probe = await run(ffprobePath, ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "json", resolve(scene.videoPath)]);
    return (JSON.parse(probe.stdout).streams ?? []).length > 0;
  }));
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const [index, scene] of manifest.scenes.entries()) {
    if (scene.videoPath) {
      args.push("-ss", String(scene.sourceIn ?? 0), "-t", (scene.end - scene.start).toFixed(3));
      if (!sourceAudioAvailable[index]) args.push("-an");
      args.push("-i", resolve(scene.videoPath));
    } else args.push("-loop", "1", "-framerate", String(FPS), "-t", (scene.end - scene.start).toFixed(3), "-i", resolve(scene.imagePath));
  }
  const audioIndex = manifest.scenes.length;
  args.push("-i", audioPath);

  const filters = [];
  const videoLabels = [];
  manifest.scenes.forEach((scene, index) => {
    const label = `v${index}`;
    const duration = (scene.end - scene.start).toFixed(3);
    const motion = scene.videoPath ? `trim=duration=${duration},setpts=PTS-STARTPTS,` : '';
    const zoom = scene.videoPath ? '' : `,zoompan=z='min(zoom+0.00035,1.06)':d=1:s=${WIDTH}x${HEIGHT}:fps=${FPS}`;
    filters.push(`[${index}:v]${motion}scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT}${zoom},fps=${FPS},setsar=1,format=yuv420p[${label}]`);
    videoLabels.push(`[${label}]`);
  });
  filters.push(`${videoLabels.join("")}concat=n=${manifest.scenes.length}:v=1:a=0,subtitles=filename='${assPath.replace(/\\/g, "/").replace(/:/g, "\\:")}',format=yuv420p[vout]`);

  if (preserveSourceAudio) {
    const audioLabels = [];
    manifest.scenes.forEach((scene, index) => {
      const duration = (scene.end - scene.start).toFixed(3);
      const label = "sourceAudio" + index;
      if (sourceAudioAvailable[index]) {
        const volume = Math.max(0, Math.min(2, Number(scene.sourceAudioVolume ?? 0.35)));
        filters.push("[" + index + ":a:0]atrim=duration=" + duration + ",asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=" + volume + "[" + label + "]");
      } else {
        filters.push("anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=" + duration + ",asetpts=PTS-STARTPTS[" + label + "]");
      }
      audioLabels.push("[" + label + "]");
    });
    filters.push(audioLabels.join("") + "concat=n=" + manifest.scenes.length + ":v=0:a=1[sourceAudio]");
    filters.push("[" + audioIndex + ":a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[narration]");
    filters.push("[sourceAudio][narration]amix=inputs=2:duration=first:dropout_transition=2,alimiter=limit=0.95[aout]");
  }
  args.push("-filter_complex", filters.join(";"), "-map", "[vout]", "-map", preserveSourceAudio ? "[aout]" : String(audioIndex) + ":a:0",
    "-t", duration.toFixed(3), "-r", String(FPS), "-c:v", "libx264", "-preset", "veryfast",
    "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart", outputPath);

  await run(ffmpegPath, args);
  const probe = await run(ffprobePath, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate", "-of", "json", outputPath]);
  const metadata = JSON.parse(probe.stdout);
  const video = metadata.streams?.find((stream) => stream.codec_type === "video");
  const audio = metadata.streams?.find((stream) => stream.codec_type === "audio");
  const actualDuration = Number(metadata.format?.duration);
  if (!video || video.codec_name !== "h264" || video.width !== WIDTH || video.height !== HEIGHT) {
    throw new Error("Rendered output failed video codec or 1080x1920 dimension QC");
  }
  if (!audio || audio.codec_name !== "aac") throw new Error("Rendered output failed AAC audio QC");
  if (!Number.isFinite(actualDuration) || Math.abs(actualDuration - duration) > 1.5) {
    throw new Error("Rendered output duration differs materially from the storyboard");
  }
  const visualQuality = await buildVisualQualityReport(manifest, outputPath, { ffmpegPath });
  return {
    status: "rendered",
    visualQuality,
    outputPath,
    durationSeconds: actualDuration,
    width: video.width,
    height: video.height,
    videoCodec: video.codec_name,
    audioCodec: audio.codec_name,
    fps: video.r_frame_rate,
    scenes: manifest.scenes.length,
    sourceAudioPreserved: preserveSourceAudio && sourceAudioAvailable.some(Boolean),
    assetProvenance: manifest.scenes.map(({ sourceType, sourceUrl = null, license = null, rightsStatus = null, rightsEvidenceReference = null, creator = null, generationModel = null, generationPrompt = null }) => ({ sourceType, sourceUrl, license, rightsStatus, rightsEvidenceReference, creator, generationModel, generationPrompt }))
  };
}

export async function loadRenderManifest(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}
