import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { refreshYouTubeAccessToken } from "./publisher.js";
import { fetchYouTubeAnalyticsReport, rowsToObjects } from "./analytics.js";

const end = new Date();
end.setUTCDate(end.getUTCDate() - 2); // Analytics reports can lag; avoid assuming yesterday is complete.
const start = new Date(end);
start.setUTCDate(start.getUTCDate() - 89);
const iso = date => date.toISOString().slice(0, 10);
const outputPath = resolve(process.env.YOUTUBE_ANALYTICS_PATH ?? "data/youtube-analytics.json");

try {
  const token = await refreshYouTubeAccessToken();
  const [shorts, longForm, topVideos] = await Promise.all([
    fetchYouTubeAnalyticsReport({
      accessToken: token.accessToken, startDate: iso(start), endDate: iso(end),
      metrics: "views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained",
      filters: "creatorContentType==SHORTS"
    }).catch(error => ({ status: "unavailable", error: error.message })),
    fetchYouTubeAnalyticsReport({
      accessToken: token.accessToken,
      startDate: iso(new Date(end.getTime() - 364 * 86400000)), endDate: iso(end),
      metrics: "views,estimatedMinutesWatched,averageViewDuration,likes,comments,shares,subscribersGained",
      filters: "creatorContentType==VIDEO_ON_DEMAND"
    }),
    fetchYouTubeAnalyticsReport({
      accessToken: token.accessToken, startDate: iso(start), endDate: iso(end),
      dimensions: "video,creatorContentType",
      metrics: "views,likes,comments,shares,subscribersGained,estimatedMinutesWatched,averageViewDuration,averageViewPercentage",
      sort: "-views", maxResults: 200
    })
  ]);
  const result = {
    fetchedAt: new Date().toISOString(),
    reportingLagDays: 2,
    reportingWindows: { last90Days: { startDate: iso(start), endDate: iso(end) }, last365Days: { startDate: iso(new Date(end.getTime() - 364 * 86400000)), endDate: iso(end) } },
    shortsLast90Days: rowsToObjects(shorts),
    channelLast365Days: rowsToObjects(longForm),
    topVideosLast90Days: rowsToObjects(topVideos),
    source: "YouTube Analytics API",
    caveat: "Analytics data is delayed and these reports do not by themselves provide all YPP-eligible counters. Use the Earn tab in YouTube Studio as the authoritative monetization progress source."
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ status: "saved", outputPath, topVideos: result.topVideosLast90Days.length, fetchedAt: result.fetchedAt }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", error: error.message }));
  process.exitCode = 1;
}
