import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { buildReeditPlan } from "../creative/reedit.js";
import { buildReeditRenderManifest } from "../production/plan-manifest.js";
import { renderShortVideo } from "../production/render.js";

/**
 * End-to-end re-edit of a locally supplied, rights-cleared source video.
 * A transcript with timestamps is required; this deliberately does not
 * scrape/download arbitrary social-platform videos.
 */
export async function runAuthorizedReedit(input, {
  ffmpegPath = "ffmpeg",
  ffprobePath = "ffprobe",
  render = renderShortVideo
} = {}) {
  if (!input || typeof input !== "object") throw new Error("A re-edit input object is required");
  const sourceLocalPath = resolve(String(input.sourceLocalPath ?? ""));
  const outputPath = resolve(String(input.outputPath ?? ""));
  if (!input.sourceLocalPath || !input.outputPath) throw new Error("sourceLocalPath and outputPath are required");
  await access(sourceLocalPath);
  const platform = input.platform ?? "youtube_shorts";
  const plan = buildReeditPlan({
    source: input.source,
    transcriptSegments: input.transcriptSegments,
    targetDurationSeconds: input.targetDurationSeconds ?? 45,
    platform,
    narrativeSemanticAnalysis: input.narrativeSemanticAnalysis ?? null
  });
  if (plan.status !== "edit_plan_ready") {
    return { status: plan.status, plan, rendered: null, outputPath: null };
  }

  // The renderer expects an audio input even for source-only edits. Generate
  // a silent bed; source audio is preserved/mixed by the renderer when present.
  const duration = Number(plan.targetDurationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("The selected edit has no positive duration");
  await mkdir(dirname(outputPath), { recursive: true });
  const audioPath = resolve(input.audioPath ?? outputPath + ".silence.wav");
  if (!input.audioPath) {
    await new Promise((resolvePromise, reject) => {
      const child = spawn(ffmpegPath, [
        "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
        "-t", duration.toFixed(3), "-c:a", "pcm_s16le", audioPath
      ], { stdio: "ignore" });
      child.once("error", reject);
      child.once("close", code => code === 0 ? resolvePromise() : reject(new Error("FFmpeg could not create the silent audio bed")));
    });
  } else {
    await access(audioPath);
  }

  const manifest = buildReeditRenderManifest({ plan, sourceLocalPath, audioPath, outputPath });
  const rendered = await render(manifest, { ffmpegPath, ffprobePath });
  return {
    status: rendered.status === "rendered" ? "completed" : "failed",
    plan,
    rendered,
    outputPath: rendered.outputPath,
    sourceLocalPath,
    audioBedGenerated: !input.audioPath
  };
}
