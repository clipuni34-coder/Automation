import test from "node:test";
import assert from "node:assert/strict";
import { fetchYouTubeAnalyticsReport, rowsToObjects } from "../src/platforms/youtube/analytics.js";

test("requests authorized channel analytics without attaching top-report limits to every report", async () => {
  let requestedUrl;
  const report = await fetchYouTubeAnalyticsReport({
    accessToken: "token",
    startDate: "2026-08-01",
    endDate: "2026-10-30",
    dimensions: "creatorContentType",
    metrics: "views,averageViewPercentage",
    sort: "-views",
    fetchImpl: async url => {
      requestedUrl = new URL(url);
      return { ok: true, json: async () => ({
        columnHeaders: [{ name: "video" }, { name: "views" }, { name: "averageViewPercentage" }],
        rows: [["video123", 5000, 78.5]]
      }) };
    }
  });
  assert.equal(requestedUrl.searchParams.get("dimensions"), "creatorContentType");
  assert.equal(requestedUrl.searchParams.has("filters"), false);
  assert.equal(requestedUrl.searchParams.get("ids"), "channel==MINE");
  assert.equal(requestedUrl.searchParams.has("maxResults"), false);
  assert.equal(report.rows.length, 1);
  assert.deepEqual(rowsToObjects(report), [{ video: "video123", views: 5000, averageViewPercentage: 78.5 }]);
});

test("adds a capped maxResults only when a report explicitly requests it", async () => {
  let requestedUrl;
  await fetchYouTubeAnalyticsReport({
    accessToken: "token",
    startDate: "2026-08-01",
    endDate: "2026-10-30",
    dimensions: "video,creatorContentType",
    metrics: "views,likes",
    sort: "-views",
    maxResults: 500,
    fetchImpl: async url => {
      requestedUrl = new URL(url);
      return { ok: true, json: async () => ({ columnHeaders: [], rows: [] }) };
    }
  });
  assert.equal(requestedUrl.searchParams.get("maxResults"), "200");
});

test("rejects invalid date windows and propagates API errors", async () => {
  await assert.rejects(fetchYouTubeAnalyticsReport({ accessToken: "token", startDate: "2026-11-02", endDate: "2026-11-01" }), /on or before/);
  await assert.rejects(fetchYouTubeAnalyticsReport({
    accessToken: "token", startDate: "2026-01-01", endDate: "2026-01-02",
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: { message: "insufficient scope" } }) })
  }), /insufficient scope/);
});
