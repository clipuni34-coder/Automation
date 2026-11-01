import test from "node:test";
import assert from "node:assert/strict";
import { recommendNextExperiment, summarizeVideoPerformance } from "../src/strategy/performance.js";

test("calculates retention and engagement from platform-reported metrics", () => {
  const result = summarizeVideoPerformance({
    views: 10000, likes: 800, comments: 100, shares: 50,
    durationSeconds: 30, averageViewDurationSeconds: 24,
    impressions: 20000, impressionsClickThroughRate: 5.2,
    viewedVsSwipedAwayPercent: 68, subscribersGained: 40
  });
  assert.equal(result.averagePercentViewed, 80);
  assert.equal(result.engagementRate, 9.5);
  assert.equal(result.commentRate, 1);
  assert.equal(result.subscribersGained, 40);
});

test("recommends retention experiments only when performance is below baseline", () => {
  const result = recommendNextExperiment({
    current: { views: 1000, likes: 20, comments: 2, shares: 1, durationSeconds: 30, averageViewDurationSeconds: 10, viewedVsSwipedAwayPercent: 30 },
    baseline: { averagePercentViewed: 65, viewedVsSwipedAwayPercent: 60 },
    sampleSize: 5
  });
  assert.ok(result.nextExperiments.some(item => item.includes("faster opening")));
  assert.ok(result.nextExperiments.some(item => item.includes("first-frame")));
});

test("does not overfit recommendations to a tiny sample", () => {
  const result = recommendNextExperiment({
    current: { views: 30, likes: 2, comments: 0, shares: 0 },
    baseline: {},
    sampleSize: 1
  });
  assert.ok(result.nextExperiments[0].includes("at least three"));
  assert.match(result.caveat, /no metric predicts guaranteed virality/);
});
