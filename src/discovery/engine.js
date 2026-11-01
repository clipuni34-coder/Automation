import { collectYouTubePopular } from "./sources/youtube.js";
import { collectRssFeeds } from "./sources/rss.js";
import { readDiscoveryStore, writeDiscoveryStore } from "./store.js";
import { scoreCandidate, topicKey } from "./scoring.js";

export async function runDiscovery({
  config = {},
  storePath = "data/discovery.json",
  collectors = {},
  now = () => new Date()
} = {}) {
  const store = await readDiscoveryStore(storePath);
  const timestamp = now().toISOString();
  const sourceResults = await Promise.allSettled([
    (collectors.youtube ?? collectYouTubePopular)({
      apiKey: config.youtubeApiKey,
      regionCode: config.regionCode ?? "NG"
    }),
    (collectors.rss ?? collectRssFeeds)({ feedUrls: config.rssFeeds ?? [] })
  ]);

  const sources = sourceResults.map((result, index) => {
    const name = index === 0 ? "youtube" : "rss";
    return result.status === "fulfilled"
      ? result.value
      : { source: name, status: "error", items: [], error: result.reason?.message ?? "Unknown error" };
  });

  const incoming = sources.flatMap((source) => source.items ?? []);
  const existingById = new Map(store.candidates.map((item) => [item.id, item]));
  const observations = [];
  const candidates = [];

  for (const item of incoming) {
    if (!item.id || !item.title || !item.sourceUrl) continue;
    const scored = scoreCandidate(item, store.observations);
    const candidate = {
      ...item,
      topicKey: topicKey(item.title),
      score: scored.score,
      scoreComponents: scored.components,
      evidence: scored.evidence,
      confidence: scored.confidence,
      firstSeenAt: existingById.get(item.id)?.firstSeenAt ?? timestamp,
      lastSeenAt: timestamp,
      decision: "needs_research",
      decisionReasons: scored.evidence.velocityMeasured
        ? ["Repeated observation supports a measured view-velocity estimate"]
        : ["No prior observation: trend velocity is not yet measurable"]
    };
    candidates.push(candidate);
    observations.push({
      id: item.id,
      observedAt: timestamp,
      metrics: item.metrics ?? {},
      source: item.platform
    });
  }

  const merged = new Map(store.candidates.map((item) => [item.id, item]));
  for (const candidate of candidates) {
    const old = merged.get(candidate.id);
    merged.set(candidate.id, old
      ? { ...old, ...candidate, firstSeenAt: old.firstSeenAt }
      : candidate);
  }

  const nextStore = {
    version: 1,
    observations: [...store.observations, ...observations].slice(-20000),
    candidates: [...merged.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 2000),
    runs: [...store.runs, {
      startedAt: timestamp,
      completedAt: now().toISOString(),
      discovered: incoming.length,
      accepted: candidates.length,
      sources: sources.map(({ source, status, error }) => ({ source, status, ...(error ? { error } : {}) }))
    }].slice(-500)
  };

  await writeDiscoveryStore(storePath, nextStore);
  return {
    run: nextStore.runs.at(-1),
    sources: sources.map(({ source, status, error, items }) => ({
      source, status, count: items?.length ?? 0, ...(error ? { error } : {})
    })),
    candidates: candidates.sort((a, b) => b.score - a.score),
    storePath
  };
}
