import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

function run(command, args, timeoutMs = 120000) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(command + " exited with code " + code + ": " + stderr.slice(-2000)));
    });
  });
}

/**
 * Heuristic editorial review of the storyboard before rendering.
 * It measures pacing, visual reuse and caption load; it does not claim to
 * understand whether a story is funny, moving, truthful or likely to go viral.
 */
export function assessStoryboardVisualQuality(manifest) {
  const scenes = Array.isArray(manifest?.scenes) ? manifest.scenes : [];
  const warnings = [];
  const checks = [];
  let score = 100;
  const penalize = (points, message) => { score -= points; warnings.push(message); };
  // A single source file is expected for a repurposed video. Distinct, non-overlapping
  // source ranges are distinct visual beats; only an identical repeated range is a reuse.
  const visualKeys = scenes.map(scene => {
    const path = resolve(scene.videoPath ?? scene.imagePath ?? "");
    if (scene.sourceType === "creator_clip" && scene.videoPath) {
      return [path, Number(scene.sourceIn ?? 0).toFixed(3), Number(scene.sourceOut ?? 0).toFixed(3)].join("|");
    }
    return path;
  });
  const uniquePaths = new Set(visualKeys);
  const repeatedCount = visualKeys.length - uniquePaths.size;
  const stillCount = scenes.filter(scene => Boolean(scene.imagePath)).length;
  const videoCount = scenes.length - stillCount;
  const editorialScores = scenes.map(scene => Number(scene.editorialScore)).filter(Number.isFinite);
  const averageEditorialScore = editorialScores.length ? Number((editorialScores.reduce((sum, value) => sum + value, 0) / editorialScores.length).toFixed(2)) : null;
  if (averageEditorialScore !== null && averageEditorialScore < 5.5) penalize(10, "Selected transcript moments have a low average editorial score (" + averageEditorialScore.toFixed(2) + "/10); human review is required before publishing.");
  else if (averageEditorialScore !== null) checks.push("Selected transcript moments meet the editorial-score review threshold.");

  if (scenes.length < 3) penalize(8, "Fewer than three visual beats: the video may feel visually repetitive.");
  else checks.push("Storyboard contains at least three visual beats.");

  if (repeatedCount > 0) penalize(Math.min(20, repeatedCount * 10), "One or more identical visual ranges are reused; add distinct scene-specific visuals.");
  else checks.push("Every scene uses a distinct media range or visual asset.");

  if (stillCount === scenes.length && scenes.length > 1) {
    penalize(5, "All scenes are still images; subtle zoom motion helps, but relevant live-action footage or animated scenes would add visual energy.");
  } else if (videoCount > 0) checks.push("The storyboard includes moving video footage.");

  for (const [index, scene] of scenes.entries()) {
    const duration = Number(scene.end) - Number(scene.start);
    const label = "Scene " + (index + 1);
    if (duration < 1.1) penalize(5, label + " is very short and may be difficult to read.");
    if (scene.imagePath && duration > 7) penalize(4, label + " holds a still image for more than seven seconds.");
    if (scene.videoPath && duration > 10) penalize(3, label + " runs longer than ten seconds without a planned visual change.");
    if (scene.sourceType === "licensed_stock") {
      if (!scene.tagRelevance) {
        penalize(12, label + " uses stock footage without recorded scene-keyword relevance evidence.");
      } else {
        checks.push(label + " has Pixabay tag-overlap evidence (not visual-semantic verification).");
        warnings.push(label + " still requires a human relevance check; tag overlap cannot prove what the footage depicts.");
      }
    }
    if (scene.sourceType === "original_graphic") {
      penalize(8, label + " uses a generic fallback graphic rather than a scene-specific visual.");
    }
    const caption = String(scene.caption ?? "").trim();
    if (caption.length > 90) penalize(5, label + " caption is too long for a quick mobile read.");
    else if (caption.length > 58) penalize(2, label + " caption may be dense on a phone screen.");
    if (caption && duration > 0 && caption.split(/\s+/).length / duration > 4.5) {
      penalize(3, label + " caption reading speed is high.");
    }
  }

  if (scenes.length === 1 && Number(scenes[0]?.end) - Number(scenes[0]?.start) > 8) {
    penalize(8, "A single visual carries most of the video; introduce more story-specific visual changes.");
  }
  score = Math.max(0, Math.min(100, score));
  return {
    score,
    status: score >= 85 ? "good" : score >= 70 ? "review" : "weak",
    checks,
    warnings,
    metrics: { sceneCount: scenes.length, uniqueAssets: uniquePaths.size, repeatedAssets: repeatedCount, stillScenes: stillCount, videoScenes: videoCount, averageEditorialScore }
  };
}

/**
 * Inspect the encoded video for prolonged black frames and frozen sections.
 * These are warnings rather than automatic failures because intentional dark
 * shots and deliberate holds can be editorial choices.
 */
export async function inspectRenderedVisualQuality(videoPath, { ffmpegPath = "ffmpeg" } = {}) {
  const path = resolve(videoPath);
  const file = await stat(path);
  if (!file.isFile() || file.size < 1024) throw new Error("Rendered video is missing or unexpectedly small");
  const result = await run(ffmpegPath, [
    "-hide_banner", "-nostats", "-i", path, "-an",
    "-vf", "blackdetect=d=0.8:pix_th=0.04,freezedetect=n=-55dB:d=2",
    "-f", "null", "-"
  ]);
  const blackEvents = [...result.stderr.matchAll(/black_start:([0-9.]+) black_end:([0-9.]+) black_duration:([0-9.]+)/g)]
    .map(match => ({ start: Number(match[1]), end: Number(match[2]), duration: Number(match[3]) }));
  const freezeEvents = [...result.stderr.matchAll(/freeze_start:([0-9.]+)(?: freeze_duration:([0-9.]+))?/g)]
    .map(match => ({ start: Number(match[1]), duration: match[2] ? Number(match[2]) : null }));
  const warnings = [];
  if (blackEvents.some(event => event.duration >= 1.2)) warnings.push("The encoded video contains a prolonged near-black section; inspect it to rule out a missing visual.");
  if (freezeEvents.some(event => (event.duration ?? 0) >= 3)) warnings.push("The encoded video contains a long frozen section; confirm that the visual hold is intentional.");
  return {
    status: warnings.length ? "review" : "passed",
    fileBytes: file.size,
    blackEvents,
    freezeEvents,
    warnings,
    checks: ["FFmpeg decoded the complete video stream.", "Prolonged black-frame and freeze checks completed."]
  };
}

export async function buildVisualQualityReport(manifest, videoPath, options = {}) {
  const storyboard = assessStoryboardVisualQuality(manifest);
  const rendered = await inspectRenderedVisualQuality(videoPath, options);
  const warnings = [...storyboard.warnings, ...rendered.warnings];
  return {
    status: warnings.length ? "review" : "passed",
    score: storyboard.score,
    generatedAt: new Date().toISOString(),
    storyboard,
    rendered,
    warnings,
    limitations: [
      "This is an automated technical/editorial heuristic, not a human judgement of humour, emotional impact, factual accuracy or virality.",
      "Pixabay tag overlap is a conservative keyword heuristic, not computer-vision semantic verification; stock scenes still require a human relevance check.",
      "A passing technical report does not prove that every visual is contextually relevant."
    ]
  };
}
