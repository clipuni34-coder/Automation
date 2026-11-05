// Advanced measurable QC for rendered outputs. Pure parsers turn ffmpeg
// analysis output into thresholds-checked metrics; `runAdvancedQc` wires
// them to a real file. Every check is numeric — a green result must be
// earned, and the raw metrics are recorded with the outcome.
import { spawnSync } from "node:child_process";
import { open } from "node:fs/promises";

export function parseVolumedetect(stderr) {
  const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(stderr ?? "");
  const max = /max_volume:\s*(-?[\d.]+) dB/.exec(stderr ?? "");
  return { meanDb: mean ? Number(mean[1]) : null, maxDb: max ? Number(max[1]) : null };
}

export function parseBlackdetect(stderr) {
  const matches = [...(stderr ?? "").matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)];
  const totalBlack = matches.reduce((a, m) => a + (Number(m[2]) - Number(m[1])), 0);
  return { blackSegments: matches.length, blackSeconds: Number(totalBlack.toFixed(2)) };
}

export function parseSilencedetect(stderr, durationSeconds = 0) {
  const starts = [...(stderr ?? "").matchAll(/silence_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...(stderr ?? "").matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  let total = 0;
  for (let i = 0; i < Math.min(starts.length, ends.length); i++) total += Math.max(0, ends[i] - starts[i]);
  // ffmpeg emits no silence_end for silence that runs to end-of-file.
  // That trailing silence must be counted (closed at the file duration),
  // not silently dropped.
  let trailingSilenceSeconds = 0;
  if (starts.length > ends.length && durationSeconds > 0) {
    trailingSilenceSeconds = Math.max(0, durationSeconds - starts[starts.length - 1]);
    total += trailingSilenceSeconds;
  }
  return { silenceSegments: starts.length, silenceSeconds: Number(total.toFixed(2)), trailingSilenceSeconds: Number(trailingSilenceSeconds.toFixed(2)) };
}

export function parseSceneChanges(stderr) {
  const times = [...(stderr ?? "").matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
  return { sceneChanges: times.length, sceneTimes: times.slice(0, 50) };
}

// MP4 fast-start check: the moov atom must appear before the first mdat.
export async function checkFastStart(path) {
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(16 * 1024 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const data = buf.subarray(0, bytesRead);
    const moov = data.indexOf(Buffer.from("moov"));
    const mdat = data.indexOf(Buffer.from("mdat"));
    if (moov === -1) return { fastStart: false, reason: "moov atom not found in the first 16MB" };
    if (mdat === -1) return { fastStart: true, reason: "moov present before any mdat in the inspected header" };
    return { fastStart: moov < mdat, reason: moov < mdat ? "moov precedes mdat" : "moov follows mdat (not fast-start)" };
  } finally { await fh.close(); }
}

export function evaluateAdvancedQc({ probe, volume, black, silence, scenes, durationSeconds, fastStart }) {
  const checks = [];
  const add = (name, passed, detail) => checks.push({ name, passed: Boolean(passed), detail });
  const v = (probe?.streams ?? []).find((s) => s.codec_type === "video");
  const a = (probe?.streams ?? []).find((s) => s.codec_type === "audio");
  add("resolution_1080x1920", v?.width === 1080 && v?.height === 1920, `video=${v?.width}x${v?.height}`);
  add("codec_h264", v?.codec_name === "h264", `video=${v?.codec_name}`);
  // The narrated/speech production modes require audio. A render with no
  // audio stream FAILS — it must never pass because a check was optional.
  add("audio_present_aac", Boolean(a) && a.codec_name === "aac", `audio=${a?.codec_name ?? "none"}`);
  add("duration_8_to_58s", durationSeconds >= 8 && durationSeconds <= 58, `duration=${durationSeconds}s`);
  add("narration_audible", volume?.meanDb !== null && volume?.meanDb !== undefined && volume?.meanDb >= -22 && volume?.meanDb <= -8, `mean=${volume?.meanDb} dB`);
  add("no_clipping", volume?.maxDb !== null && volume?.maxDb !== undefined && volume?.maxDb <= -0.3, `max=${volume?.maxDb} dB`);
  add("limited_black_frames", durationSeconds > 0 && black.blackSeconds / durationSeconds <= 0.1, `black=${black.blackSeconds}s of ${durationSeconds}s`);
  add("limited_silence", durationSeconds > 0 && silence.silenceSeconds / durationSeconds <= 0.45, `silence=${silence.silenceSeconds}s of ${durationSeconds}s`);
  add("no_trailing_silence", (silence.trailingSilenceSeconds ?? 0) <= 1.5, `trailingSilence=${silence.trailingSilenceSeconds ?? 0}s`);
  add("scene_pacing", scenes.sceneChanges >= 1, `sceneChanges=${scenes.sceneChanges}`);
  add("faststart", fastStart?.fastStart === true, fastStart?.reason ?? "unknown");
  return { passed: checks.every((c) => c.passed), checks, metrics: { volume, black, silence, scenes: { sceneChanges: scenes.sceneChanges } } };
}

function run(cmd, args, timeout = 600000) {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout, maxBuffer: 32 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export async function runAdvancedQc(path, { ffmpegPath = "ffmpeg", ffprobePath = "ffprobe" } = {}) {
  const probeRun = run(ffprobePath, ["-v", "error", "-show_entries", "stream=codec_name,codec_type,width,height:format=duration", "-of", "json", path], 120000);
  const probe = probeRun.status === 0 ? JSON.parse(probeRun.stdout) : { streams: [] };
  const durationSeconds = Number(probe?.format?.duration ?? 0);
  const vol = run(ffmpegPath, ["-i", path, "-af", "volumedetect", "-f", "null", "/dev/null"], 300000);
  const blk = run(ffmpegPath, ["-i", path, "-vf", "blackdetect=d=0.5:pix_th=0.1", "-an", "-f", "null", "/dev/null"], 300000);
  const sil = run(ffmpegPath, ["-i", path, "-af", "silencedetect=noise=-45dB:d=0.8", "-vn", "-f", "null", "/dev/null"], 300000);
  // Threshold 0.1: the original 0.35 only fires on hard cuts and held a
  // continuous single-shot render that measurably contains 26 visual
  // changes at 0.1 (cape-fox audit render, run 42062317891). 0.1 counts
  // real subject/camera/edit changes, including punch-in beat cuts.
  const scn = run(ffmpegPath, ["-i", path, "-vf", "select='gt(scene,0.1)',showinfo", "-an", "-f", "null", "/dev/null"], 300000);
  const fastStart = await checkFastStart(path).catch((e) => ({ fastStart: false, reason: e.message }));
  return evaluateAdvancedQc({
    probe,
    volume: parseVolumedetect(vol.stderr),
    black: parseBlackdetect(blk.stderr),
    silence: parseSilencedetect(sil.stderr, durationSeconds),
    scenes: parseSceneChanges(scn.stderr),
    durationSeconds,
    fastStart
  });
}
