import { createHash } from "node:crypto";

const STOP_WORDS = new Set([
  "about", "after", "again", "against", "also", "because", "before", "being",
  "between", "could", "from", "have", "into", "just", "more", "most", "over",
  "same", "should", "some", "such", "than", "that", "their", "there", "these",
  "they", "this", "those", "through", "under", "very", "what", "when", "where",
  "which", "while", "with", "would", "your", "video", "videos", "watch", "new"
]);

function terms(title = "") {
  return new Set(title.toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word)));
}

function similarity(left, right) {
  const a = terms(left), b = terms(right);
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter((word) => b.has(word)).length;
  const union = new Set([...a, ...b]).size;
  return shared >= 2 && shared / union >= 0.25 ? shared / union : 0;
}

function clusterId(label) {
  return "topic:" + createHash("sha1").update(label).digest("hex").slice(0, 12);
}

export function buildTopicClusters(candidates, now = new Date()) {
  const groups = [];
  for (const candidate of candidates) {
    let best = null, bestScore = 0;
    for (const group of groups) {
      const score = Math.max(...group.items.map((item) => similarity(candidate.title, item.title)), 0);
      if (score > bestScore) { best = group; bestScore = score; }
    }
    if (best) best.items.push(candidate);
    else groups.push({ items: [candidate] });
  }

  const timestamp = now instanceof Date ? now.getTime() : Date.parse(now);
  return groups.map(({ items }) => {
    const sorted = [...items].sort((a, b) => Date.parse(b.publishedAt ?? 0) - Date.parse(a.publishedAt ?? 0));
    const label = sorted[0]?.title ?? "Untitled topic";
    const creators = new Set(items.map((item) => item.creatorId ?? item.creator).filter(Boolean));
    const recent = items.filter((item) => {
      const published = Date.parse(item.publishedAt ?? "");
      return Number.isFinite(published) && timestamp - published <= 7 * 86400000 && timestamp >= published;
    });
    const count = items.length;
    const lifecycle = count < 3 ? "insufficient_data"
      : count >= 8 && creators.size >= 5 ? "crowded"
      : recent.length >= 3 ? "active" : "emerging";
    const saturation = count >= 8 && creators.size >= 5 ? "high"
      : count >= 4 && creators.size >= 3 ? "moderate" : "low";
    const averageScore = Math.round(items.reduce((sum, item) => sum + (item.score ?? 0), 0) / count);
    return {
      id: clusterId([...terms(label)].sort().join(" ") || label.toLowerCase()),
      label,
      candidateCount: count,
      distinctCreatorCount: creators.size,
      recentCandidateCount: recent.length,
      averageOpportunityScore: averageScore,
      lifecycle,
      saturation,
      saturationMethod: "reference-video and distinct-creator counts; not total market saturation",
      confidence: count >= 5 && creators.size >= 3 ? "medium" : "low",
      candidateIds: items.map((item) => item.id)
    };
  }).sort((a, b) => b.averageOpportunityScore - a.averageOpportunityScore);
}

export function explainCandidateDecision(candidate, cluster) {
  const reasons = [];
  if (candidate.confidence === "low") reasons.push("Growth velocity is not yet measured");
  if ((candidate.score ?? 0) < 35) reasons.push("Opportunity score is below the research threshold (35/100)");
  if (cluster?.saturation === "high") reasons.push("Reference coverage is crowded; seek a differentiated angle");
  if (cluster?.lifecycle === "insufficient_data") reasons.push("Too few related references to establish a trend lifecycle");
  if (!reasons.length) reasons.push("Candidate meets the initial research-screening threshold");
  return {
    decision: (candidate.score ?? 0) >= 35 ? "needs_research" : "hold",
    decisionReasons: reasons
  };
}
