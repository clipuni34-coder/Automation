import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildCompilationPlan } from "./compilation.js";
import { buildCompilationRenderManifest } from "../production/plan-manifest.js";
import { renderShortVideo } from "../production/render.js";
const input = process.argv[2];
if (!input) { console.error("Usage: npm run compile-clips -- <compilation-input.json> [output.json]"); process.exitCode = 1; }
else { try { const data = JSON.parse(await readFile(resolve(input), "utf8")); const plan = buildCompilationPlan(data); let rendered = null; if (data.mediaAssets && data.audioPath && data.outputPath && plan.status === "compilation_plan_ready") { const manifest = buildCompilationRenderManifest({ plan, mediaAssets: data.mediaAssets, audioPath: data.audioPath, outputPath: data.outputPath }); rendered = await renderShortVideo(manifest); } const output = process.argv[3] ?? input.replace(/\\.json$/i, ".compilation-plan.json"); await mkdir(dirname(resolve(output)), { recursive: true }); await writeFile(resolve(output), JSON.stringify({ ...plan, rendered }, null, 2)); console.log(JSON.stringify({ status: plan.status, outputPath: resolve(output), selectedClips: plan.sequence.length, rejectedCount: plan.rejectedCount ?? 0, rendered: rendered?.outputPath ?? null }, null, 2)); if (plan.status !== "compilation_plan_ready") process.exitCode = 2; } catch (error) { console.error(JSON.stringify({ status: "failed", error: error.message })); process.exitCode = 1; } }
