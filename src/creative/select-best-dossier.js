import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

export function rankResearchDossiers(dossiers, discovery) {
  const candidates = discovery?.candidates ?? [];
  return dossiers.map(dossier => {
    const candidate = candidates.find(item =>
      item.id === dossier.candidateId ||
      (item.title && dossier.topic && item.title.trim().toLowerCase() === dossier.topic.trim().toLowerCase())
    );
    const sourceCount = (dossier.evidence ?? []).length;
    const extractedCount = (dossier.evidence ?? []).filter(item => item.extractionStatus === "opened" || item.extractedContent).length;
    const score = Number(candidate?.score ?? dossier.discoveryEvidence?.score ?? 0);
    return {
      path: dossier.path,
      topic: dossier.topic,
      opportunityScore: score,
      evidenceCount: sourceCount,
      extractedSourceCount: extractedCount,
      rankScore: score + Math.min(10, sourceCount * 2) + Math.min(5, extractedCount * 2)
    };
  }).sort((a, b) => b.rankScore - a.rankScore || a.path.localeCompare(b.path));
}

const files = (await readdir(".")).filter(name => /^research-.*\.json$/i.test(name)).sort();
const dossiers = [];
for (const file of files) {
  try {
    dossiers.push({ ...(JSON.parse(await readFile(resolve(file), "utf8"))), path: file });
  } catch {
    // Ignore malformed dossier files; a malformed file must not block valid research.
  }
}
if (!dossiers.length) {
  console.log("");
} else {
  const discoveryPath = process.env.DISCOVERY_STORE_PATH ?? "data/discovery.json";
  let discovery = { candidates: [] };
  try { discovery = JSON.parse(await readFile(discoveryPath, "utf8")); } catch {}
  const ranked = rankResearchDossiers(dossiers, discovery);
  console.log(ranked[0].path);
}
