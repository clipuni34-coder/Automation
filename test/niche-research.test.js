import test from "node:test";
import assert from "node:assert/strict";
import { researchNiches } from "../src/strategy/niche-research.js";

function video(id, categoryId = "20", index = 0) {
  return {
    id: `youtube:${id}`, platform: "youtube", categoryId,
    title: categoryId === "20" ? `Roblox gaming streamer challenge ${index}` : `Funny comedy moment ${index}`,
    creator: `Creator ${index % 6}`, creatorId: `creator-${index % 6}`,
    metrics: { views: 500000 + index * 1000, likes: 30000 + index * 10, comments: 1000 },
    score: 75 + (index % 5), scoreComponents: { velocity: 70 + (index % 4) },
    seenInRegions: ["NG", "US", "GB", "IN"]
  };
}

test("identifies promising niches only with repeated creator and regional evidence", () => {
  const discovery = { runs: [{}, {}, {}], candidates: Array.from({ length: 24 }, (_, i) => video(String(i), "20", i)) };
  const result = researchNiches(discovery, { generatedAt: "2026-11-01T10:00:00.000Z" });
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0].niche, "Gaming");
  assert.equal(result.recommendations[0].decision, "run_a_channel_pilot_before_committing");
  assert.equal(result.categories[0].confidence, "medium");
  assert.ok(result.categories[0].uniqueCreators >= 5);
});

test("does not recommend a niche from a single viral outlier", () => {
  const discovery = { candidates: [{
    id: "youtube:one", platform: "youtube", categoryId: "23", title: "Funny viral moment",
    creatorId: "one-creator", metrics: { views: 10000000, likes: 500000, comments: 20000 },
    score: 100, scoreComponents: { velocity: 100 }, seenInRegions: ["US"]
  }] };
  const result = researchNiches(discovery);
  assert.equal(result.recommendations.length, 0);
  assert.equal(result.categories[0].decision, "collect_more_data");
});

test("keeps unsupported and non-YouTube sources out of YouTube niche scoring", () => {
  const result = researchNiches({ candidates: [
    { id: "rss:one", platform: "rss", categoryId: "20", title: "Gaming trend", metrics: {} },
    { id: "youtube:two", platform: "youtube", title: "Uncategorised trend", metrics: {} }
  ] });
  assert.equal(result.categories.length, 0);
});
