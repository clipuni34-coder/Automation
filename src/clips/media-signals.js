import { spawnSync } from "node:child_process";

function run(command, args, label) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120_000 });
  if (result.error) throw new Error(label + ": " + result.error.message);
  if (result.status !== 0) throw new Error(label + ": " + (result.stderr || result.stdout || "command failed").trim());
  return result.stderr || "";
}

export function parseSceneChanges(log) {
  const times = [];
  for (const match of String(log).matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g)) {
    const time = Number(match[1]);
    if (Number.isFinite(time) && time >= 0 && (times.length === 0 || time > times.at(-1))) times.push(time);
  }
  return times;
}

export function parseSilenceIntervals(log, durationSeconds = null) {
  const intervals = [];
  let openStart = null;
  for (const line of String(log).split(/\r?\n/)) {
    const start = line.match(/silence_start:\s*([0-9]+(?:\.[0-9]+)?)/);
    if (start) openStart = Number(start[1]);
    const end = line.match(/silence_end:\s*([0-9]+(?:\.[0-9]+)?)/);
    if (end && openStart !== null) {
      const finish = Number(end[1]);
      if (finish > openStart) intervals.push({ start: openStart, end: finish });
      openStart = null;
    }
  }
  if (openStart !== null && Number.isFinite(durationSeconds) && durationSeconds > openStart) {
    intervals.push({ start: openStart, end: durationSeconds });
  }
  return intervals;
}

export function summarizeMomentSignals(moment, mediaSignals = {}) {
  const start = Number(moment.start), end = Number(moment.end), duration = end - start;
  if (!Number.isFinite(start) || !Number.isFinite(end) || duration <= 0) throw new Error("Moment requires valid start and end timestamps");
  const cuts = (mediaSignals.sceneChanges ?? []).filter((time) => time >= start && time <= end);
  const silentSeconds = (mediaSignals.silenceIntervals ?? []).reduce((total, interval) =>
    total + Math.max(0, Math.min(end, interval.end) - Math.max(start, interval.start)), 0);
  const silenceRatio = Math.min(1, silentSeconds / duration);
  return {
    sceneChangeCount: cuts.length,
    visualActivity: Math.min(10, 2 + cuts.length * 2),
    silenceRatio: Number(silenceRatio.toFixed(3)),
    speechContinuity: Number((10 * (1 - silenceRatio)).toFixed(2)),
    method: "ffmpeg_scene_change_and_silencedetect"
  };
}

export function analyzeMediaSignals(sourcePath, { ffmpegPath = "ffmpeg", ffprobePath = "ffprobe", durationSeconds } = {}) {
  const sceneLog = run(ffmpegPath, [
    "-hide_banner", "-i", sourcePath, "-vf", "select='gt(scene,0.25)',showinfo", "-an", "-f", "null", "-"
  ], "FFmpeg scene-change analysis failed");
  const audioProbe = spawnSync(ffprobePath, [
    "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", sourcePath
  ], { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 30_000 });
  if (audioProbe.error) throw new Error("FFprobe audio inspection failed: " + audioProbe.error.message);
  if (audioProbe.status !== 0) throw new Error("FFprobe audio inspection failed: " + (audioProbe.stderr || "unknown error").trim());
  let silenceIntervals = [];
  if (audioProbe.stdout.trim()) {
    const silenceLog = run(ffmpegPath, [
      "-hide_banner", "-i", sourcePath, "-af", "silencedetect=noise=-35dB:d=0.35", "-vn", "-f", "null", "-"
    ], "FFmpeg silence analysis failed");
    silenceIntervals = parseSilenceIntervals(silenceLog, durationSeconds);
  }
  return {
    engine: "ffmpeg", sceneThreshold: 0.25, silenceThreshold: "-35dB",
    sceneChanges: parseSceneChanges(sceneLog), silenceIntervals, audioPresent: Boolean(audioProbe.stdout.trim())
  };
}
