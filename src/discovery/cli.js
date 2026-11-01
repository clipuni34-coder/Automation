import { runDiscovery } from "./engine.js";

const result = await runDiscovery({
  config: {
    youtubeApiKey: process.env.YOUTUBE_DATA_API_KEY,
    regionCode: process.env.DISCOVERY_REGION ?? "NG",
    rssFeeds: (process.env.RSS_FEEDS ?? "").split(",").map((value) => value.trim()).filter(Boolean)
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
    evidence: item.evidence,
    url: item.sourceUrl
  })),
  note: "First observations cannot establish growth velocity. RSS/video items are discovery references, not reusable media."
}, null, 2));
