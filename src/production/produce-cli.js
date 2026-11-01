import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { generateNarration } from "./voice.js";
import { generateStoryboardAssets } from "./visuals.js";
import { buildOriginalRenderManifest } from "./plan-manifest.js";
import { renderShortVideo } from "./render.js";
import { buildPublishingPackage } from "../packaging/package.js";

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolvePromise(stdout) : reject(new Error(command + " failed: " + stderr.slice(-2500))));
  });
}

async function audioDuration(path) {
  const raw = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path]);
  const duration = Number(raw.trim());
  if (!Number.isFinite(duration) || duration < 5) throw new Error("Narration audio duration is invalid");
  return duration;
}

const briefPath = process.argv[2];
const baseOutputDir = resolve(process.argv[3] ?? join("output", "latest"));
const outputDir = join(baseOutputDir, new Date().toISOString().replace(/[:.]/g, "-"));
if (!briefPath) { console.error("Usage: npm run produce -- <creative-brief.json> [output-directory]"); process.exitCode = 1; }
else {
  try {
    const brief = JSON.parse(await readFile(resolve(briefPath), "utf8"));
    const editorial = brief.editorial ?? brief;
    if (!editorial.fullScript || !Array.isArray(editorial.visualPlan)) throw new Error("Creative brief must include a fullScript and visualPlan");
    await mkdir(outputDir, { recursive: true });
    const narrationPath = join(outputDir, "narration.wav");
    const narration = await generateNarration({ text: editorial.fullScript, outputPath: narrationPath });
    if (narration.status !== "generated") throw new Error("Narration provider is not configured");
    const duration = await audioDuration(narrationPath);
    const assets = await generateStoryboardAssets({ visualPlan: editorial.visualPlan, topic: brief.topic ?? editorial.workingTitle, outputDir: join(outputDir, "assets") });
    const manifest = buildOriginalRenderManifest({ brief, assets, audioPath: narrationPath, outputPath: join(outputDir, "short.mp4"), totalDurationSeconds: duration });
    const manifestPath = join(outputDir, "render-manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    const rendered = await renderShortVideo(manifest);
    const packageData = buildPublishingPackage({ brief, renderResult: rendered, assets });
    const packagePath = join(outputDir, "publishing-package.json");
    await writeFile(packagePath, JSON.stringify(packageData, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ status: "rendered", videoPath: rendered.outputPath, packagePath, scenes: rendered.scenes, durationSeconds: rendered.durationSeconds, sourceAudioPreserved: rendered.sourceAudioPreserved }, null, 2));
  } catch (error) { console.error(JSON.stringify({ status: "failed", error: error.message })); process.exitCode = 1; }
}
