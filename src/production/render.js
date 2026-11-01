import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { spawn } from "node:child_process";

const ALLOWED_SOURCE_TYPES = new Set(["original_graphic", "generated_visual", "public_domain", "licensed_stock"]);
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
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/{/g, "\\{").replace(/}/g, "\\}").replace(/\r?\n/g, "\\N");
}

function assTime(seconds) {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor((centiseconds % 360000) / 6000);
  const secs = Math.floor((centiseconds % 6000) / 100);
  const cs = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object") throw new Error("A render manifest is required");
  if (!Array.isArray(manifest.scenes) || manifest.scenes.length < 1 || manifest.scenes.length > 30) {
    throw new Error("Manifest must contain between 1 and 30 scenes");
  }
  if (!manifest.audioPath) throw new Error("A narration audioPath is required");
  let previousEnd = 0;
  for (const [index, scene] of manifest.scenes.entries()) {
    if (!scene.imagePath || !Number.isFinite(scene.start) || !Number.isFinite(scene.end) || scene.start < 0 || scene.end <= scene.start) {
      throw new Error(`Scene ${index + 1} needs an imagePath and a valid positive start/end time`);
    }
    if (Math.abs(scene.start - previousEnd) > 0.02) throw new Error("Scenes must be chronological and contiguous, starting at 0 seconds");
    previousEnd = scene.end;
    if (!ALLOWED_SOURCE_TYPES.has(scene.sourceType)) throw new Error(`Scene ${index + 1} has an unapproved or missing asset sourceType`);
    if (scene.sourceType !== "original_graphic" && (!scene.sourceUrl || !scene.license)) {
      throw new Error(`Scene ${index + 1} must include sourceUrl and license provenance`);
    }
  }
  return previousEnd;
}

function buildAss(scenes, duration) {
  const header = [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1920",
    "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Caption,DejaVu Sans,68,&H00FFFFFF,&H0000FFFF,&H00101010,&H99000000,1,0,0,0,100,100,0,0,1,5,1,2,90,90,250,1", "",
    "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
  ];
  const events = scenes.map((scene) => `Dialogue: 0,${assTime(scene.start)},${assTime(Math.min(scene.end, duration))},Caption,,0,0,0,,{\\an2}${escapeAss(scene.caption)}`);
  return [...header, ...events, ""].join("\n");
}

export async function renderShortVideo(manifest, { ffmpegPath = "ffmpeg", ffprobePath = "ffprobe" } = {}) {
  const duration = validateManifest(manifest);
  const outputPath = resolve(manifest.outputPath ?? "output.mp4");
  const audioPath = resolve(manifest.audioPath);
  await access(audioPath);
  for (const scene of manifest.scenes) await access(resolve(scene.imagePath));
  await mkdir(dirname(outputPath), { recursive: true });
  const assPath = `${outputPath}.captions.ass`;
  await writeFile(assPath, buildAss(manifest.scenes, duration), { mode: 0o600 });

  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const scene of manifest.scenes) args.push("-loop", "1", "-framerate", String(FPS), "-t", (scene.end - scene.start).toFixed(3), "-i", resolve(scene.imagePath));
  const audioIndex = manifest.scenes.length;
  args.push("-i", audioPath);

  const filters = [];
  const videoLabels = [];
  manifest.scenes.forEach((scene, index) => {
    const label = `v${index}`;
    filters.push(`[${index}:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},zoompan=z='min(zoom+0.00035,1.06)':d=1:s=${WIDTH}x${HEIGHT}:fps=${FPS},setsar=1,format=yuv420p[${label}]`);
    videoLabels.push(`[${label}]`);
  });
  filters.push(`${videoLabels.join("")}concat=n=${manifest.scenes.length}:v=1:a=0,subtitles=filename='${assPath.replace(/\\/g, "/").replace(/:/g, "\\:")}',format=yuv420p[vout]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[vout]", "-map", `${audioIndex}:a:0`,
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
  return {
    status: "rendered",
    outputPath,
    durationSeconds: actualDuration,
    width: video.width,
    height: video.height,
    videoCodec: video.codec_name,
    audioCodec: audio.codec_name,
    fps: video.r_frame_rate,
    scenes: manifest.scenes.length,
    assetProvenance: manifest.scenes.map(({ sourceType, sourceUrl = null, license = null }) => ({ sourceType, sourceUrl, license }))
  };
}

export async function loadRenderManifest(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}
