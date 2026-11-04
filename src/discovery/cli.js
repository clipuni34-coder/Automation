import { runDiscovery } from "./engine.js";
import { DEFAULT_CATEGORIES, DEFAULT_REGIONS } from "./sources/youtube.js";

const list = (value, fallback) => value
  ? value.split(",").map((item) => item.trim()).filter(Boolean)
  : fallback;

const result = await runDiscovery({
  config: {
    youtubeApiKey: process.env.YOUTUBE_DATA_API_KEY,
    regions: list(process.env.DISCOVERY_REGIONS, DEFAULT_REGIONS),
    categories: list(process.env.DISCOVERY_CATEGORIES, DEFAULT_CATEGORIES),
    youtubeConcurrency: Number(process.env.DISCOVERY_CONCURRENCY ?? 5),
    rssFeeds: (process.env.RSS_FEEDS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
    searchQueries: (process.env.DISCOVERY_SEARCH_QUERIES ?? "").split("|").map((value) => value.trim()).filter(Boolean),
    searchMaxResults: Number(process.env.DISCOVERY_SEARCH_MAX_RESULTS ?? 20),
    searchOrder: process.env.DISCOVERY_SEARCH_ORDER ?? "viewCount",
    searchRegion: process.env.DISCOVERY_SEARCH_REGION ?? "NG",
    searchPublishedAfter: new Date(Date.now() - Math.max(1, Number(process.env.DISCOVERY_SEARCH_WINDOW_DAYS ?? 7)) * 24 * 60 * 60 * 1000).toISOString()
  },
  storePath: process.env.DISCOVERY_STORE_PATH ?? "data/discovery.json"
});

console.log(JSON.stringify({
  run: result.run,
  sources: result.sources,
  topCandidates: result.candidates.slice(0, 10).map((item) => ({
    title: item.title,
    platform: item.platform,
    score: item.score,
    confidence: item.confidence,
    momentum: item.momentum,
    evidence: item.evidence,
    decision: item.decision,
    decisionReasons: item.decisionReasons,
    regions: item.seenInRegions ?? [],
    categories: item.seenInCategories ?? [],
    url: item.sourceUrl
  })),
  note: "Global regional/category coverage is a discovery sample, not all videos uploaded to YouTube. First observations cannot establish growth velocity. Reference videos are not reusable media."
}, null, 2));
