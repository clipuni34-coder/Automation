import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildReeditPlan } from "./reedit.js";
import { buildReeditRenderManifest } from "../production/plan-manifest.js";
import { renderShortVideo } from "../production/render.js";
const input = process.argv[2];
if (!input) { console.error("Usage: npm run reedit -- <reedit-input.json> [output.json]"); process.exitCode = 1; }
else { try { const data = JSON.parse(await readFile(resolve(input), "utf8")); const plan = buildReeditPlan(data); let rendered = null; if (data.sourceLocalPath && data.audioPath && data.outputPath && plan.status === "edit_plan_ready") { const manifest = buildReeditRenderManifest({ plan, sourceLocalPath: data.sourceLocalPath, audioPath: data.audioPath, outputPath: data.outputPath }); rendered = await renderShortVideo(manifest); } const output = process.argv[3] ?? input.replace(/\\.json$/i, ".reedit-plan.json"); await mkdir(dirname(resolve(output)), { recursive: true }); await writeFile(resolve(output), JSON.stringify({ ...plan, rendered }, null, 2)); console.log(JSON.stringify({ status: plan.status, outputPath: resolve(output), selectedSegments: plan.editDecisionList.length, rights: plan.rights.status, rendered: rendered?.outputPath ?? null }, null, 2)); } catch (error) { console.error(JSON.stringify({ status: "failed", error: error.message })); process.exitCode = 1; } }
