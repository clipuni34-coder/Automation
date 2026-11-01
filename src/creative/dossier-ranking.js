const NON_INDEPENDENT_HOSTS = new Set([
  "youtube.com", "youtu.be", "instagram.com", "facebook.com", "tiktok.com",
  "reddit.com", "x.com", "twitter.com", "msn.com", "news.google.com",
  "google.com", "bing.com"
]);

function hostFor(value) {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return host;
  } catch {
    return null;
  }
}

function publisherKey(host) {
  if (!host) return null;
  const labels = host.split(".");
  return labels.length > 2 ? labels.slice(-2).join(".") : host;
}

export function rankResearchDossiers(dossiers, discovery) {
  const candidates = discovery?.candidates ?? [];
  return dossiers.map(dossier => {
    const candidate = candidates.find(item =>
      item.id === dossier.candidateId ||
      (item.title && dossier.topic && item.title.trim().toLowerCase() === dossier.topic.trim().toLowerCase())
    );
    const evidence = dossier.evidence ?? [];
    const sourceCount = evidence.length;
    const extractedCount = evidence.filter(item => item.extractionStatus === "opened" || item.extractedContent).length;
    const independentPublishers = new Set();
    let substantiveSources = 0;
    let relevanceTotal = 0;
    let relevanceCount = 0;
    for (const item of evidence) {
      const host = hostFor(item.url);
      if (host && !NON_INDEPENDENT_HOSTS.has(host)) independentPublishers.add(publisherKey(host));
      const excerptLength = String(item.extractedContent ?? item.sourceExcerpt ?? "").trim().length;
      if (excerptLength >= 500) substantiveSources += 1;
      if (Number.isFinite(item.searchRelevance)) {
        relevanceTotal += Math.max(0, Math.min(1, item.searchRelevance));
        relevanceCount += 1;
      }
    }
    const opportunityScore = Number(candidate?.score ?? dossier.discoveryEvidence?.score ?? 0);
    const averageRelevance = relevanceCount ? relevanceTotal / relevanceCount : 0;
    // Opportunity is only one input: research breadth and usable source text now matter too.
    // These are triage heuristics, not source verification or a truth score.
    const rankScore =
      opportunityScore * 0.35 +
      Math.min(5, independentPublishers.size) * 6 +
      Math.min(5, substantiveSources) * 3 +
      averageRelevance * 10 +
      Math.min(5, extractedCount) * 4;
    return {
      path: dossier.path,
      topic: dossier.topic,
      opportunityScore,
      evidenceCount: sourceCount,
      extractedSourceCount: extractedCount,
      independentPublisherCount: independentPublishers.size,
      substantiveSourceCount: substantiveSources,
      averageSearchRelevance: Math.round(averageRelevance * 1000) / 1000,
      rankScore: Math.round(rankScore * 100) / 100,
      rankingCaveat: "Research breadth is a triage signal only; search excerpts are not independently verified."
    };
  }).sort((a, b) => b.rankScore - a.rankScore || a.path.localeCompare(b.path));
}
