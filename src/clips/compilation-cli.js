import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { buildCompilationPlan } from "./compilation.js";
import { buildCompilationRenderManifest } from "../production/plan-manifest.js";
import { renderShortVideo } from "../production/render.js";

async function makeSilentBed(path, duration) {
  await mkdir(dirname(path), { recursive: true });
  await new Promise((resolvePromise, reject) => {
    const child = spawn("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-t", Number(duration).toFixed(3), "-c:a", "pcm_s16le", path
    ], { stdio: "ignore" });
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolvePromise() : reject(new Error("FFmpeg could not create compilation audio bed")));
  });
}

const input = process.argv[2];
if (!input) {
  console.error("Usage: npm run compile-clips -- <compilation-input.json> [output.json]");
  process.exitCode = 1;
} else {
  try {
    const data = JSON.parse(await readFile(resolve(input), "utf8"));
    const plan = buildCompilationPlan(data);
    let rendered = null;
    if (data.mediaAssets && data.outputPath && plan.status === "compilation_plan_ready") {
      const audioPath = resolve(data.audioPath ?? data.outputPath + ".silence.wav");
      if (data.audioPath) await readFile(resolve(data.audioPath));
      else await makeSilentBed(audioPath, plan.targetDurationSeconds);
      const manifest = buildCompilationRenderManifest({ plan, mediaAssets: data.mediaAssets, audioPath, outputPath: data.outputPath });
      rendered = await renderShortVideo(manifest);
    }
    const output = process.argv[3] ?? input.replace(/\.json$/i, ".compilation-plan.json");
    await mkdir(dirname(resolve(output)), { recursive: true });
    await writeFile(resolve(output), JSON.stringify({ ...plan, rendered }, null, 2));
    console.log(JSON.stringify({ status: plan.status, outputPath: resolve(output), selectedClips: plan.sequence.length, rejectedCount: plan.rejectedCount ?? 0, rendered: rendered?.outputPath ?? null, sourceAudioPreserved: rendered?.sourceAudioPreserved ?? false }, null, 2));
    if (plan.status !== "compilation_plan_ready") process.exitCode = 2;
  } catch (error) {
    console.error(JSON.stringify({ status: "failed", error: error.message }));
    process.exitCode = 1;
  }
}
