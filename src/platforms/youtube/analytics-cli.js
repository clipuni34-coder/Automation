import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { refreshYouTubeAccessToken } from "./publisher.js";
import { fetchYouTubeAnalyticsReport, rowsToObjects } from "./analytics.js";

const end = new Date();
end.setUTCDate(end.getUTCDate() - 2); // Analytics reports can lag; avoid assuming yesterday is complete.
const start90 = new Date(end);
start90.setUTCDate(start90.getUTCDate() - 89);
const start365 = new Date(end);
start365.setUTCDate(start365.getUTCDate() - 364);
const iso = date => date.toISOString().slice(0, 10);
const outputPath = resolve(process.env.YOUTUBE_ANALYTICS_PATH ?? "data/youtube-analytics.json");

function aggregateByCreatorContentType(rows) {
  const groups = new Map();
  for (const row of rows) {
    const type = row.creatorContentType ?? "UNKNOWN";
    const group = groups.get(type) ?? {
      creatorContentType: type,
      views: 0,
      engagedViews: 0,
      estimatedMinutesWatched: 0,
      _viewDurationWeighted: 0,
      _viewPercentageWeighted: 0,
      _viewsForAverages: 0
    };
    const views = Number(row.views ?? 0);
    group.views += views;
    group.engagedViews += Number(row.engagedViews ?? 0);
    group.estimatedMinutesWatched += Number(row.estimatedMinutesWatched ?? 0);
    group._viewDurationWeighted += Number(row.averageViewDuration ?? 0) * views;
    group._viewPercentageWeighted += Number(row.averageViewPercentage ?? 0) * views;
    group._viewsForAverages += views;
    groups.set(type, group);
  }
  return [...groups.values()].map(group => {
    const count = group._viewsForAverages;
    return {
      creatorContentType: group.creatorContentType,
      views: group.views,
      engagedViews: group.engagedViews,
      estimatedMinutesWatched: group.estimatedMinutesWatched,
      ...(count > 0 ? {
        averageViewDuration: group._viewDurationWeighted / count,
        averageViewPercentage: group._viewPercentageWeighted / count
      } : {})
    };
  });
}

try {
  const token = await refreshYouTubeAccessToken();
  const [contentTypes90d, contentTypes365d, channelEngagement90d, topVideos90d] = await Promise.all([
    fetchYouTubeAnalyticsReport({
      accessToken: token.accessToken, startDate: iso(start90), endDate: iso(end),
      // creatorContentType is only supported as an optional dimension on time-based
      // channel reports, so include the required day dimension and aggregate locally.
      dimensions: "day,creatorContentType",
      metrics: "views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage"
    }).catch(error => { throw new Error(`90-day content-type report: ${error.message}`); }),
    fetchYouTubeAnalyticsReport({
      accessToken: token.accessToken, startDate: iso(start365), endDate: iso(end),
      dimensions: "day,creatorContentType",
      metrics: "views,engagedViews,estimatedMinutesWatched"
    }).catch(error => { throw new Error(`365-day content-type report: ${error.message}`); }),
    fetchYouTubeAnalyticsReport({
      accessToken: token.accessToken, startDate: iso(start90), endDate: iso(end),
      metrics: "views,likes,comments,shares,subscribersGained,estimatedMinutesWatched,averageViewDuration"
    }).catch(error => { throw new Error(`channel engagement report: ${error.message}`); }),
    fetchYouTubeAnalyticsReport({
      accessToken: token.accessToken, startDate: iso(start90), endDate: iso(end),
      dimensions: "video,creatorContentType",
      metrics: "views,engagedViews,likes,comments,shares,subscribersGained,estimatedMinutesWatched,averageViewDuration,averageViewPercentage",
      sort: "-views", maxResults: 200
    }).catch(error => { throw new Error(`top-videos report: ${error.message}`); })
  ]);
  const types90 = aggregateByCreatorContentType(rowsToObjects(contentTypes90d));
  const types365 = aggregateByCreatorContentType(rowsToObjects(contentTypes365d));
  const shorts90 = types90.find(row => row.creatorContentType === "SHORTS") ?? {};
  const longForm365 = types365.find(row => row.creatorContentType === "VIDEO_ON_DEMAND") ?? {};
  const result = {
    fetchedAt: new Date().toISOString(),
    reportingLagDays: 2,
    reportingWindows: {
      last90Days: { startDate: iso(start90), endDate: iso(end) },
      last365Days: { startDate: iso(start365), endDate: iso(end) }
    },
    contentTypeBreakdownLast90Days: types90,
    contentTypeBreakdownLast365Days: types365,
    channelEngagementLast90Days: rowsToObjects(channelEngagement90d),
    topVideosLast90Days: rowsToObjects(topVideos90d),
    estimatesNotOfficialYppCounters: {
      shortsViewsLast90Days: Number(shorts90.views ?? 0),
      shortsEngagedViewsLast90Days: Number(shorts90.engagedViews ?? 0),
      longFormEstimatedWatchHoursLast365Days: Math.round(Number(longForm365.estimatedMinutesWatched ?? 0) / 60 * 100) / 100
    },
    source: "YouTube Analytics API",
    caveat: "These are Analytics estimates, not YouTube Studio's qualified public YPP counters. Private, unlisted, deleted, promoted or otherwise ineligible views/watch time may be excluded from YPP thresholds. Use the Earn tab in YouTube Studio as the authoritative monetization progress source."
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ status: "saved", outputPath, topVideos: result.topVideosLast90Days.length, fetchedAt: result.fetchedAt }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", error: error.message }));
  process.exitCode = 1;
}
