import test from "node:test";
import assert from "node:assert/strict";
import { buildViralReport } from "../src/discovery/viral-report.js";

test("viral report includes ranked evidence and only safe HTTPS source links", () => {
  const html = buildViralReport({
    candidates: [{
      title: "Fast-growing video",
      creator: "Creator",
      platform: "youtube",
      sourceUrl: "https://youtube.com/watch?v=abc",
      rightsStatus: "reference_only",
      rightsEvidenceUrl: "https://example.com/rights",
      score: 81,
      confidence: "high",
      momentum: "breakout_candidate",
      decisionReasons: ["Measured growth"],
      evidence: { viewsPerHour: 500, velocityMeasured: true, breakoutSignal: true },
      metrics: { views: 10000, likes: 500 },
      scoreComponents: { recency: 90, engagement: 70, velocity: 80, completeness: 100 }
    }, {
      title: "<script>alert(1)</script>",
      sourceUrl: "javascript:alert(1)",
      score: 20,
      evidence: {}
    }],
    topicClusters: [{ label: "Football highlights", candidateCount: 5, distinctCreatorCount: 3, lifecycle: "active", saturation: "moderate", averageOpportunityScore: 70 }]
  }, { latestPlan: { recommendations: [{ title: "Football trend", creativeAngle: "Find a differentiated angle" }] } }, "2026-11-02T00:00:00.000Z");
  assert.match(html, /Fast-growing video/);
  assert.match(html, /https:\/\/youtube\.com\/watch/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Breakout candidate/);
  assert.match(html, /Football highlights/);
  assert.match(html, /Reference only — not cleared for reuse/);
  assert.match(html, /Rights evidence/);
  assert.match(html, /Rights unverified — do not download or republish/);
});

test("viral report handles an empty discovery store without throwing", () => {
  const html = buildViralReport({ candidates: [], topicClusters: [] });
  assert.match(html, /No discovery candidates yet/);
  assert.match(html, /No topic clusters available yet/);
});
