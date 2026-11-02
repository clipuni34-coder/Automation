import test from "node:test";
import assert from "node:assert/strict";
import { evaluateProductionVisualQuality, assertProductionVisualQuality } from "../src/production/production-quality-gate.js";

function passingReport() {
  return {
    status: "passed",
    score: 96,
    rendered: { status: "passed" },
    storyboard: { metrics: { sceneCount: 3 } },
    semanticReview: { status: "passed", reviewedScenes: 3, failedScenes: 0 }
  };
}

test("production visual gate accepts a high-scoring report with every scene verified", () => {
  const report = passingReport();
  assert.deepEqual(evaluateProductionVisualQuality(report), { eligible: true, reasons: [] });
  assert.equal(assertProductionVisualQuality(report).eligible, true);
});

test("production visual gate blocks a review report even when the MP4 encoded correctly", () => {
  const report = passingReport();
  report.status = "review";
  report.score = 25;
  report.semanticReview = { status: "unverified", reviewedScenes: 0, failedScenes: 0 };
  const result = evaluateProductionVisualQuality(report);
  assert.equal(result.eligible, false);
  assert.match(result.reasons.join(" "), /status is not passed/);
  assert.match(result.reasons.join(" "), /score must be at least 85/);
  assert.match(result.reasons.join(" "), /semantic visual verification did not pass/);
  assert.throws(() => assertProductionVisualQuality(report), /blocked this video/);
});

test("production visual gate blocks incomplete scene coverage", () => {
  const report = passingReport();
  report.semanticReview.reviewedScenes = 2;
  const result = evaluateProductionVisualQuality(report);
  assert.equal(result.eligible, false);
  assert.match(result.reasons.join(" "), /Every storyboard scene/);
});

test("production visual gate blocks any semantically rejected scene", () => {
  const report = passingReport();
  report.semanticReview.failedScenes = 1;
  const result = evaluateProductionVisualQuality(report);
  assert.equal(result.eligible, false);
  assert.match(result.reasons.join(" "), /failed semantic visual verification/);
});

test("production visual gate blocks missing reports and low technical QC", () => {
  assert.equal(evaluateProductionVisualQuality(null).eligible, false);
  const report = passingReport();
  report.rendered.status = "review";
  assert.match(evaluateProductionVisualQuality(report).reasons.join(" "), /technical inspection did not pass/);
});
