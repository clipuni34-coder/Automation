import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { researchNiches } from "./niche-research.js";

const discoveryPath = process.env.DISCOVERY_STORE_PATH ?? "data/discovery.json";
const outputPath = resolve(process.env.NICHE_RESEARCH_PATH ?? "data/niche-research.json");
const discovery = JSON.parse(await readFile(discoveryPath, "utf8"));
const report = researchNiches(discovery);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({
  status: "completed",
  outputPath,
  categorySamples: report.categories.length,
  promisingNiches: report.recommendations.map(item => ({ niche: item.niche, score: item.opportunityScore, confidence: item.confidence }))
}, null, 2));
