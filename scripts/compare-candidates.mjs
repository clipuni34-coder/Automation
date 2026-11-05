// Candidate comparison - reads ONLY structured results produced during the
// current production run (output/candidates/<id>.candidate.json, written by
// scripts/produce-candidates.mjs). Ranking rules live in candidate-utils.mjs:
// only completed + QC-passed candidates are eligible or scored; every other
// candidate stays visible with its exact reason and rankScore null.
// Usage: node scripts/compare-candidates.mjs [manifest] [resultsDir] [outDir]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { rankRow, summariseComparison } from "./candidate-utils.mjs";

const manifestPath = resolve(process.argv[2] ?? "config/candidate-manifest.json");
const resultsDir = resolve(process.argv[3] ?? "output/candidates");
const outDir = resolve(process.argv[4] ?? resultsDir);
await mkdir(outDir, { recursive: true });
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const rows = [];
for (const entry of manifest) {
  let candidate = null;
  try { candidate = JSON.parse(await readFile(join(resultsDir, `${entry.id}.candidate.json`), "utf8")); } catch { /* missing stays visible */ }
  if (candidate && candidate.id !== entry.id) candidate = null;
  rows.push(rankRow(candidate ?? { id: entry.id, label: entry.label, creator: entry.creator, sourceUrl: entry.sourceUrl, rightsEvidenceUrl: entry.rightsEvidenceUrl, license: entry.license, status: "missing_result" }));
}
const comparison = summariseComparison(rows);
const md = [
  "# Candidate comparison", "", `Generated: ${comparison.rankedAt}`, "",
  `**Winner:** ${comparison.winner ?? "none - no candidate passed every gate"}`, "", comparison.winnerRationale, "",
  "| Candidate | Outcome | Editorial | Visual QC | Technical QC | Native source | Duration | Rank |",
  "|---|---|---|---|---|---|---|---|",
  ...comparison.candidates.map((r) => `| ${r.label ?? r.id} | ${r.status}${r.reason ? ` - ${String(r.reason).replaceAll("|", "/").slice(0, 160)}` : ""} | ${r.editorialAverage ?? "-"} | ${r.visualQcScore ?? "-"} | ${r.technicalQc ?? "-"} | ${r.originalResolution ?? "-"} | ${r.durationSeconds ? r.durationSeconds.toFixed(1) + "s" : "-"} | ${r.rankScore ?? "-"} |`),
  "", "Only completed candidates that passed technical QC are ranked. Held, rejected and failed candidates keep their exact recorded reason and receive no score."
].join("\n");
await writeFile(join(outDir, "comparison.json"), JSON.stringify(comparison, null, 2));
await writeFile(join(outDir, "comparison.md"), md);
console.log(JSON.stringify(comparison, null, 2));
