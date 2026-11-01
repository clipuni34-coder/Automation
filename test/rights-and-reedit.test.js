import test from "node:test";
import assert from "node:assert/strict";
import { assessAssetRights } from "../src/rights/asset-rights.js";
import { buildReeditPlan } from "../src/creative/reedit.js";
import { buildCompilationPlan } from "../src/clips/compilation.js";

const licensed = { sourceUrl: "https://media.example/video.mp4", rightsStatus: "licensed", rightsEvidenceReference: "contract-123", allowedPlatforms: ["youtube_shorts"], durationSeconds: 120, title: "Source", creator: "Creator" };

test("rights gate blocks reference-only videos and missing permission evidence", () => {
  assert.equal(assessAssetRights({ ...licensed, rightsStatus: "reference_only" }, { platform: "youtube_shorts" }).allowed, false);
  assert.equal(assessAssetRights({ ...licensed, rightsEvidenceReference: null }, { platform: "youtube_shorts" }).allowed, false);
  assert.equal(assessAssetRights(licensed, { platform: "youtube_shorts" }).allowed, true);
});

test("standalone viral re-edit selects high-value transcript windows and preserves source timestamps", () => {
  const plan = buildReeditPlan({ source: licensed, targetDurationSeconds: 30, transcriptSegments: [
    { id: "slow", start: 0, end: 12, text: "Long setup", signals: { hook: 2, emotion: 1 } },
    { id: "payoff", start: 35, end: 48, text: "Unexpected payoff", signals: { hook: 9, emotion: 9, payoff: 10, clarity: 8 } }
  ] });
  assert.equal(plan.status, "edit_plan_ready");
  assert.equal(plan.editDecisionList[0].segmentId, "payoff");
  assert.equal(plan.editDecisionList[0].sourceIn, 35);
  assert.equal(plan.editDecisionList[0].treatment.punchIn, true);
});

test("reference-only standalone viral videos produce analysis-only plans", () => {
  const plan = buildReeditPlan({ source: { ...licensed, rightsStatus: "reference_only" }, transcriptSegments: [{ start: 1, end: 4, text: "A strong hook", signals: { hook: 9 } }] });
  assert.equal(plan.status, "analysis_only");
  assert.equal(plan.rights.allowed, false);
});

test("compilation ranks cleared creator moments and blocks unlicensed-only clips", () => {
  const base = { sourceUrl: "https://media.example/clip.mp4", rightsStatus: "permission_granted", rightsEvidenceReference: "email-consent-1", allowedPlatforms: ["youtube_shorts"], start: 4, end: 9, creator: "Creator" };
  const plan = buildCompilationPlan({ title: "Top moments", introCommentary: "Here are the moments.", outroCommentary: "Which was best?", clips: [
    { ...base, sourceId: "a", score: 4 }, { ...base, sourceId: "b", score: 9 }
  ] });
  assert.equal(plan.status, "compilation_plan_ready");
  assert.equal(plan.sequence[0].sourceId, "b");
  const blocked = buildCompilationPlan({ introCommentary: "Intro", outroCommentary: "Outro", clips: [
    { sourceId: "a", sourceUrl: base.sourceUrl, rightsStatus: "reference_only", start: 0, end: 4 },
    { sourceId: "b", sourceUrl: base.sourceUrl, rightsStatus: "reference_only", start: 5, end: 9 }
  ] });
  assert.equal(blocked.status, "blocked_rights");
});

test("compilation requires original framing commentary", () => {
  assert.throws(() => buildCompilationPlan({ clips: [], introCommentary: "", outroCommentary: "" }), /at least two/);
});
