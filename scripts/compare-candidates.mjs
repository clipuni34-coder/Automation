// Rank completed candidate Shorts from their repurpose result files.
// Ranking (transparent, no hidden model):
//   editorial average score (40%) + visual QC score/10 (25%) +
//   source resolution fitness (20%: >=1080p=10, 720p=8, <720p=2) +
//   duration fitness (15%: 10-55s=10, 6-10s=7, <6s=4)
// Rejected/held candidates must be listed too — rejecting weak footage is a result.
// Usage: node scripts/compare-candidates.mjs <manifest.json>
// Manifest: [{ id, label, resultPath, sourceResolution: "1280x720", sourceUrl,
//              rightsEvidenceUrl, creator }]
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(process.argv[2], "utf8"));
const rows = [];
for (const item of manifest) {
  let result = null;
  try { result = JSON.parse(await readFile(item.resultPath, "utf8")); } catch { /* missing = failed before result */ }
  const eq = result?.plan?.editorialQuality ?? {};
  const editorial = Number(eq.averageSelectedScore ?? 0);
  const visual = Number(result?.rendered?.visualQuality?.score ?? 0);
  const duration = Number(result?.rendered?.durationSeconds ?? 0);
  const height = Number(String(item.sourceResolution).split("x")[1] ?? 0);
  const resolutionScore = height >= 1080 ? 10 : height >= 720 ? 8 : 2;
  const durationScore = duration >= 10 && duration <= 55 ? 10 : duration >= 6 ? 7 : duration > 0 ? 4 : 0;
  const completed = result?.status === "completed";
  // Weighted rank on a 10-point scale: editorial 40%, visual QC 25%, source resolution 20%, duration fitness 15%
  const rankScore = completed ? Number((editorial * 0.4 + (visual / 100) * 10 * 0.25 + resolutionScore * 0.2 + durationScore * 0.15).toFixed(2)) : 0;
  rows.push({
    id: item.id, label: item.label, creator: item.creator, sourceUrl: item.sourceUrl,
    rightsEvidenceUrl: item.rightsEvidenceUrl, sourceResolution: item.sourceResolution,
    status: result?.status ?? "failed_no_result",
    editorialAverage: editorial || null, visualQcScore: visual || null,
    durationSeconds: duration || null, resolutionScore, durationScore,
    rankScore, title: result?.postingPackage?.title ?? null,
    outputPath: result?.outputPath ?? null,
    selectedMoments: (result?.plan?.editDecisionList ?? []).map((m) => m.caption).slice(0, 4)
  });
}
rows.sort((a, b) => b.rankScore - a.rankScore);
console.log(JSON.stringify({ rankedAt: new Date().toISOString(), winner: rows.find((r) => r.status === "completed")?.id ?? null, candidates: rows }, null, 2));
