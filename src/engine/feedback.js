// Per-channel analytics feedback. Consumes REAL analytics snapshots only
// (fetched via the YouTube Analytics API into channel state). With no data
// it says so — it never fabricates history or improvements.
import { topicKey } from "../discovery/scoring.js";

export function analyzeChannelFeedback({ analytics, published = [], now = new Date() } = {}) {
  if (!analytics || !Array.isArray(analytics.topVideos) || analytics.topVideos.length === 0) {
    return {
      status: "insufficient_data", generatedAt: now.toISOString(),
      reason: "No measured video performance is available for this channel yet. Publish (privately at first), sync analytics, then re-run feedback.",
      topicPerformance: [], recommendations: ["Collect at least 5 published videos with analytics before changing strategy."]
    };
  }
  const byTopic = new Map();
  const publishedById = new Map(published.map((v) => [v.videoId, v]));
  for (const video of analytics.topVideos) {
    const record = publishedById.get(video.videoId) ?? {};
    const topic = record.topicKey ?? topicKey(video.title ?? record.title ?? "unknown");
    const group = byTopic.get(topic) ?? { topic, videos: 0, views: 0, engagedViews: 0, watchMinutes: 0, subscribersGained: 0, avgViewPercentageSum: 0, samples: 0 };
    group.videos += 1;
    group.views += Number(video.views ?? 0);
    group.engagedViews += Number(video.engagedViews ?? 0);
    group.watchMinutes += Number(video.estimatedMinutesWatched ?? 0);
    group.subscribersGained += Number(video.subscribersGained ?? 0);
    if (Number.isFinite(Number(video.averageViewPercentage))) { group.avgViewPercentageSum += Number(video.averageViewPercentage); group.samples += 1; }
    byTopic.set(topic, group);
  }
  const topicPerformance = [...byTopic.values()].map((g) => ({
    topic: g.topic, videos: g.videos, views: g.views,
    avgViewsPerVideo: g.videos ? Math.round(g.views / g.videos) : 0,
    avgViewPercentage: g.samples ? Number((g.avgViewPercentageSum / g.samples).toFixed(1)) : null,
    subscribersGained: g.subscribersGained,
    score: Number(((g.views / Math.max(1, g.videos)) * (0.5 + (g.samples ? (g.avgViewPercentageSum / g.samples) / 100 : 0))).toFixed(1))
  })).sort((a, b) => b.score - a.score);

  const best = topicPerformance[0];
  const declining = topicPerformance.filter((t) => t.videos >= 2 && (t.avgViewPercentage ?? 100) < 25);
  const recommendations = [];
  if (best) recommendations.push(`Double down on topic "${best.topic}" (${best.videos} videos, avg ${best.avgViewsPerVideo} views, retention ${best.avgViewPercentage ?? "unknown"}%). Test 2 more videos before expanding.`);
  for (const t of declining) recommendations.push(`Topic "${t.topic}" shows weak retention (${t.avgViewPercentage}% average view percentage across ${t.videos} videos). Change the hook in the first 2 seconds or retire the topic.`);
  if (!declining.length) recommendations.push("No declining topic detected at the current sample size; keep testing one new topic per week alongside proven ones.");
  recommendations.push("Compare only measured periods. A recommendation is a hypothesis for the next experiment, not a guarantee.");

  return {
    status: "ok", generatedAt: now.toISOString(),
    measuredVideos: analytics.topVideos.length,
    topicPerformance, recommendations,
    weightAdjustments: best ? [{ topic: best.topic, discoveryBoost: 1.25, reason: "Highest measured topic score; bounded +25% discovery boost for the next cycle." }] : []
  };
}
