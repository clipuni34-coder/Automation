// Per-channel YouTube Analytics sync. Each connected channel is synced with
// its OWN OAuth connection and its identity is verified before any data is
// stored. Channels without credentials or with a mismatched identity are
// reported and skipped — never silently mixed. Writes snapshots + feedback
// into per-channel state. No credential values are printed.
import { resolve } from "node:path";
import { loadChannels } from "../src/config/channels.js";
import { openChannelState } from "../src/engine/state.js";
import { analyzeChannelFeedback } from "../src/engine/feedback.js";
import { refreshYouTubeAccessToken, getAuthorizedYouTubeChannel } from "../src/platforms/youtube/publisher.js";
import { fetchYouTubeAnalyticsReport, rowsToObjects } from "../src/platforms/youtube/analytics.js";

const stateRoot = resolve(process.env.STATE_DIR ?? "data/state");
const channels = await loadChannels(process.env.CHANNEL_PROFILES_PATH ?? "config/channels.json");
const end = new Date(); end.setUTCDate(end.getUTCDate() - 2);
const start = new Date(end); start.setUTCDate(start.getUTCDate() - 89);
const iso = (d) => d.toISOString().slice(0, 10);

const results = [];
for (const channel of channels) {
  const entry = { channelId: channel.id, status: "skipped", reason: null };
  results.push(entry);
  if (channel.status !== "connected" || !channel.youtubeChannelId) { entry.reason = "Channel is not marked connected with a YouTube channel id"; continue; }
  const refreshToken = process.env[channel.refreshTokenEnv] || (channel.refreshTokenEnv === "YOUTUBE_REFRESH_TOKEN" ? process.env.REFRESH_TOKEN : "");
  if (!process.env.YOUTUBE_CLIENT_ID || !refreshToken) { entry.reason = `Missing credentials: ${!process.env.YOUTUBE_CLIENT_ID ? "YOUTUBE_CLIENT_ID " : ""}${!refreshToken ? channel.refreshTokenEnv : ""}`.trim(); continue; }
  try {
    const token = await refreshYouTubeAccessToken({ refreshToken });
    const identity = await getAuthorizedYouTubeChannel({ accessToken: token.accessToken });
    if (identity.channelId !== channel.youtubeChannelId) { entry.status = "blocked_identity_mismatch"; entry.reason = `OAuth connects to ${identity.channelId} (${identity.title}), expected ${channel.youtubeChannelId}`; continue; }
    const [summaryReport, topReport] = await Promise.all([
      fetchYouTubeAnalyticsReport({ accessToken: token.accessToken, startDate: iso(start), endDate: iso(end), metrics: "views,likes,comments,shares,subscribersGained,subscribersLost,estimatedMinutesWatched" }),
      fetchYouTubeAnalyticsReport({ accessToken: token.accessToken, startDate: iso(start), endDate: iso(end), dimensions: "video", metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage", sort: "-views", maxResults: 50 })
    ]);
    const totals = rowsToObjects(summaryReport)[0] ?? {};
    const topVideos = rowsToObjects(topReport).map((v) => ({ videoId: v.video, views: v.views, estimatedMinutesWatched: v.estimatedMinutesWatched, averageViewDuration: v.averageViewDuration, averageViewPercentage: v.averageViewPercentage }));
    // Titles for topic analysis (Data API, same OAuth token).
    if (topVideos.length) {
      const ids = topVideos.map((v) => v.videoId).join(",");
      const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ids}`, { headers: { authorization: `Bearer ${token.accessToken}` } });
      const payload = await res.json().catch(() => ({}));
      const titles = new Map((payload.items ?? []).map((i) => [i.id, i.snippet?.title]));
      for (const v of topVideos) v.title = titles.get(v.videoId) ?? null;
    }
    const state = await openChannelState(stateRoot, channel.id);
    const snapshot = { channelId: channel.youtubeChannelId, channelTitle: identity.title, fetchedAt: new Date().toISOString(), window: { startDate: iso(start), endDate: iso(end) }, totals, topVideos };
    await state.saveAnalytics(snapshot);
    const published = (await state.getPublished()).videos;
    const feedback = analyzeChannelFeedback({ analytics: snapshot, published });
    await state.saveFeedback(feedback);
    entry.status = "synced";
    entry.detail = { channelTitle: identity.title, topVideos: topVideos.length, totals, feedbackStatus: feedback.status };
  } catch (error) {
    entry.status = "failed";
    entry.reason = String(error.message).slice(0, 400);
  }
}
console.log(JSON.stringify({ syncedAt: new Date().toISOString(), channels: results }, null, 2));
