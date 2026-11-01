import test from "node:test";
import assert from "node:assert/strict";
import { collectYouTubeGlobal } from "../src/discovery/sources/youtube.js";

test("collects region/category charts and deduplicates videos with coverage metadata", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: new URL(url), options });
    const region = new URL(url).searchParams.get("regionCode");
    const category = new URL(url).searchParams.get("videoCategoryId");
    return {
      ok: true,
      json: async () => ({
        items: [{
          id: "same-video",
          snippet: {
            title: "A globally popular video",
            channelTitle: "Creator",
            channelId: "channel-1",
            publishedAt: "2026-10-31T12:00:00Z",
            categoryId: category ?? "24"
          },
          statistics: { viewCount: "1000", likeCount: "50", commentCount: "5" }
        }]
      })
    };
  };
  const result = await collectYouTubeGlobal({
    apiKey: "test-key",
    regions: ["US", "GB"],
    categories: ["10", "20"],
    concurrency: 2,
    fetchImpl
  });
  assert.equal(calls.length, 4);
  assert.ok(calls.every((call) => call.options.headers["x-goog-api-key"] === "test-key"));
  assert.equal(result.status, "ok");
  assert.equal(result.requests, 4);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].seenInRegions, ["US", "GB"]);
  assert.deepEqual(result.items[0].seenInCategories, ["10", "20"]);
});

test("reports partial coverage when one region/category request fails", async () => {
  const fetchImpl = async (url) => {
    if (new URL(url).searchParams.get("regionCode") === "GB") {
      return { ok: false, status: 403, text: async () => "quota or region error" };
    }
    return { ok: true, json: async () => ({ items: [{ id: "available-video", snippet: { title: "Example", channelTitle: "Channel", publishedAt: "2026-10-31T00:00:00Z" }, statistics: { viewCount: "10" } }] }) };
  };
  const result = await collectYouTubeGlobal({
    apiKey: "test-key",
    regions: ["US", "GB"],
    categories: [],
    fetchImpl
  });
  assert.equal(result.status, "partial");
  assert.equal(result.successfulRequests, 1);
  assert.equal(result.failedRequests, 1);
});
