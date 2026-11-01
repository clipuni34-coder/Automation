const CATEGORY_NAMES = {
  "1": "Film & Animation", "2": "Autos & Vehicles", "10": "Music",
  "15": "Pets & Animals", "17": "Sports", "19": "Travel & Events",
  "20": "Gaming", "22": "People & Blogs", "23": "Comedy",
  "24": "Entertainment", "25": "News & Politics", "26": "Howto & Style",
  "27": "Education", "28": "Science & Technology", "29": "Nonprofits & Activism"
};

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function bounded(value) {
  return Math.max(0, Math.min(100, value));
}

function nicheStats(candidates) {
  const views = candidates.map(item => Number(item.metrics?.views)).filter(Number.isFinite);
  const scores = candidates.map(item => Number(item.score)).filter(Number.isFinite);
  const engagements = candidates.map(item => {
    const viewCount = Number(item.metrics?.views);
    if (!Number.isFinite(viewCount) || viewCount <= 0) return null;
    return ((Number(item.metrics?.likes) || 0) + (Number(item.metrics?.comments) || 0)) / viewCount * 100;
  }).filter(Number.isFinite);
  const velocities = candidates.map(item => Number(item.scoreComponents?.velocity)).filter(Number.isFinite);
  const creators = new Map();
  const regions = new Set();
  const formats = new Map();
  for (const item of candidates) {
    const creator = item.creatorId ?? item.creator;
    if (creator) creators.set(creator, (creators.get(creator) ?? 0) + 1);
    for (const region of item.seenInRegions ?? []) regions.add(region);
    const format = item.format ?? "unclassified";
    formats.set(format, (formats.get(format) ?? 0) + 1);
  }
  const creatorCounts = [...creators.values()].sort((a, b) => b - a);
  const creatorConcentration = candidates.length ? (creatorCounts[0] ?? 0) / candidates.length : 1;
  const creatorDiversity = bounded((creators.size / Math.max(1, Math.min(candidates.length, 20))) * 100);
  const regionalReach = bounded((regions.size / 12) * 100);
  const formatDiversity = bounded((formats.size / 5) * 100);
  const medianScore = median(scores);
  const medianEngagementRate = median(engagements);
  const medianVelocity = median(velocities);
  const medianViews = median(views);
  const opportunityScore = Math.round(
    medianScore * 0.30 +
    bounded(medianEngagementRate * 20) * 0.20 +
    medianVelocity * 0.15 +
    regionalReach * 0.15 +
    creatorDiversity * 0.10 +
    formatDiversity * 0.10
  );
  return {
    sampleSize: candidates.length,
    uniqueCreators: creators.size,
    regionsObserved: [...regions].sort(),
    medianViews: Math.round(medianViews),
    medianOpportunityScore: Math.round(medianScore),
    medianEngagementRate: Math.round(medianEngagementRate * 100) / 100,
    medianVelocityScore: Math.round(medianVelocity),
    creatorConcentration: Math.round(creatorConcentration * 100) / 100,
    formatMix: Object.fromEntries([...formats.entries()].sort((a, b) => b[1] - a[1])),
    opportunityScore,
    confidence: candidates.length >= 30 && creators.size >= 10 && regions.size >= 4 ? "high" : candidates.length >= 15 && creators.size >= 5 && regions.size >= 3 ? "medium" : "low",
    decision: candidates.length >= 15 && creators.size >= 5 && regions.size >= 3 && opportunityScore >= 45 ? "promising_to_test" : "collect_more_data",
    exampleTopics: candidates.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 4).map(item => item.title)
  };
}

export function researchNiches(discovery, { generatedAt = new Date().toISOString() } = {}) {
  const byCategory = new Map();
  const formatCandidates = new Map();
  for (const candidate of discovery?.candidates ?? []) {
    if (candidate.platform !== "youtube" || !candidate.categoryId) continue;
    const categoryId = String(candidate.categoryId);
    if (!byCategory.has(categoryId)) byCategory.set(categoryId, []);
    byCategory.get(categoryId).push(candidate);
  }

  const categories = [...byCategory.entries()].map(([categoryId, candidates]) => ({
    categoryId,
    niche: CATEGORY_NAMES[categoryId] ?? `YouTube category ${categoryId}`,
    ...nicheStats(candidates)
  })).sort((a, b) => b.opportunityScore - a.opportunityScore);

  const promising = categories.filter(item => item.decision === "promising_to_test").slice(0, 5);
  const recommendations = promising.map((item, index) => ({
    rank: index + 1,
    niche: item.niche,
    categoryId: item.categoryId,
    opportunityScore: item.opportunityScore,
    confidence: item.confidence,
    evidence: {
      sampleSize: item.sampleSize,
      uniqueCreators: item.uniqueCreators,
      regionsObserved: item.regionsObserved,
      medianViews: item.medianViews,
      medianEngagementRate: item.medianEngagementRate,
      creatorConcentration: item.creatorConcentration,
      formatMix: item.formatMix
    },
    decision: "run_a_channel_pilot_before_committing"
  }));

  return {
    version: 1,
    generatedAt,
    discoveryRuns: discovery?.runs?.length ?? 0,
    sampleSize: categories.reduce((sum, item) => sum + item.sampleSize, 0),
    categories,
    recommendations,
    constraints: [
      "These are relative opportunity signals from the collected YouTube most-popular charts, not estimates of total addressable audience, RPM or guaranteed growth.",
      "A promising category requires multiple videos, creators and regions; a single breakout cannot determine a niche.",
      "Run a small channel pilot and compare actual retention, subscriber conversion and production cost before creating several channels.",
      "Google Trends RSS signals are not yet joined to category-level video performance in this score."
    ]
  };
}
