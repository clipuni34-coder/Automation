import { collectYouTubeGlobal, searchYouTubeVideos } from "./sources/youtube.js";
import { collectRssFeeds } from "./sources/rss.js";
import { readDiscoveryStore, writeDiscoveryStore } from "./store.js";
import { scoreCandidate, topicKey } from "./scoring.js";
import { buildTopicClusters, explainCandidateDecision } from "./topics.js";

export async function runDiscovery({
  config = {},
  storePath = "data/discovery.json",
  collectors = {},
  now = () => new Date()
} = {}) {
  const store = await readDiscoveryStore(storePath);
  const timestamp = now().toISOString();
  const sourceResults = await Promise.allSettled([
    (collectors.youtube ?? collectYouTubeGlobal)({
      apiKey: config.youtubeApiKey,
      regions: config.regions,
      categories: config.categories,
      concurrency: config.youtubeConcurrency ?? 5
    }),
    (collectors.rss ?? collectRssFeeds)({ feedUrls: config.rssFeeds ?? [] }),
    (collectors.youtubeSearch ?? searchYouTubeVideos)({ apiKey: config.youtubeApiKey, queries: config.searchQueries ?? [], maxResults: config.searchMaxResults ?? 20, order: config.searchOrder ?? "viewCount", regionCode: config.searchRegion ?? "US" })
  ]);

  const sources = sourceResults.map((result, index) => {
    const name = ["youtube", "rss", "youtube_search"][index] ?? "unknown";
    return result.status === "fulfilled"
      ? result.value
      : { source: name, status: "error", items: [], error: result.reason?.message ?? "Unknown error" };
  });

  const incoming = sources.flatMap((source) => source.items ?? []);
  const existingById = new Map(store.candidates.map((item) => [item.id, item]));
  const observations = [];
  const merged = new Map(store.candidates.map((item) => [item.id, item]));

  for (const item of incoming) {
    if (!item.id || !item.title || !item.sourceUrl) continue;
    const scored = scoreCandidate(item, store.observations);
    const previous = existingById.get(item.id);
    const candidate = {
      ...item,
      topicKey: topicKey(item.title),
      score: scored.score,
      scoreComponents: scored.components,
      evidence: scored.evidence,
      confidence: scored.confidence,
      firstSeenAt: previous?.firstSeenAt ?? timestamp,
      lastSeenAt: timestamp,
      decision: "needs_research",
      decisionReasons: []
    };
    merged.set(candidate.id, candidate);
    observations.push({
      id: item.id,
      observedAt: timestamp,
      metrics: item.metrics ?? {},
      source: item.platform
    });
  }

  const ranked = [...merged.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 2000);
  const topicClusters = buildTopicClusters(ranked, new Date(timestamp));
  const clusterByCandidate = new Map();
  for (const cluster of topicClusters) {
    for (const id of cluster.candidateIds) clusterByCandidate.set(id, cluster);
  }
  const reviewedCandidates = ranked.map((candidate) => ({
    ...candidate,
    ...explainCandidateDecision(candidate, clusterByCandidate.get(candidate.id))
  }));

  const nextStore = {
    version: 2,
    observations: [...store.observations, ...observations].slice(-20000),
    candidates: reviewedCandidates,
    topicClusters,
    runs: [...store.runs, {
      startedAt: timestamp,
      completedAt: now().toISOString(),
      discovered: incoming.length,
      accepted: observations.length,
      topicCount: topicClusters.length,
      sources: sources.map(({ source, status, error, requests, successfulRequests, failedRequests, regions, categories }) => ({ source, status, ...(error ? { error } : {}), ...(requests !== undefined ? { requests, successfulRequests, failedRequests, regions, categories } : {}) }))
    }].slice(-500)
  };

  await writeDiscoveryStore(storePath, nextStore);
  return {
    run: nextStore.runs.at(-1),
    sources: sources.map(({ source, status, error, items, requests, successfulRequests, failedRequests, regions, categories }) => ({
      source, status, count: items?.length ?? 0, ...(error ? { error } : {}), ...(requests !== undefined ? { requests, successfulRequests, failedRequests, regions, categories } : {})
    })),
    topicClusters,
    candidates: reviewedCandidates,
    storePath
  };
}
