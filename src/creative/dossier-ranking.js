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
