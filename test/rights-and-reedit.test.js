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
  assert.equal(assessAssetRights({ ...licensed, rightsStatus: "public_domain", rightsEvidenceReference: null }).allowed, false);
  assert.equal(assessAssetRights({ ...licensed, rightsEvidenceUrl: "http://example.com/license" }).allowed, false);
});

test("standalone viral re-edit selects high-value transcript windows and preserves source timestamps", () => {
  const plan = buildReeditPlan({ source: licensed, targetDurationSeconds: 30, transcriptSegments: [
    { id: "slow", start: 0, end: 12, text: "Long setup", signals: { hook: 2, emotion: 1 } },
    { id: "payoff", start: 35, end: 48, text: "Unexpected payoff", signals: { hook: 9, emotion: 9, payoff: 10, clarity: 8 } }
  ] });
  assert.equal(plan.status, "edit_plan_ready");
  assert.deepEqual(plan.editDecisionList.map(item => item.segmentId), ["slow", "payoff"]);
  assert.equal(plan.editDecisionList[1].sourceIn, 35);
  assert.equal(plan.editDecisionList[1].treatment.punchIn, true);
  assert.equal(plan.openingHook.segmentId, "slow");
  assert.equal(plan.hookOverlay.segmentId, "payoff");
});

test("standalone re-edit prefers a coherent chronological story window over scattered peaks", () => {
  const plan = buildReeditPlan({
    source: licensed,
    targetDurationSeconds: 12,
    transcriptSegments: [
      { id: "weak-setup", start: 0, end: 5, text: "An unrelated opening setup.", signals: { hook: 6, clarity: 6 } },
      { id: "weak-payoff", start: 5, end: 10, text: "An unrelated early payoff.", signals: { payoff: 6, clarity: 6 } },
      { id: "isolated-spike", start: 50, end: 52, text: "A single dramatic sentence.", signals: { hook: 9.9, emotion: 9.9, curiosity: 9.9, payoff: 9.9, clarity: 9.9 } },
      { id: "strong-setup", start: 100, end: 105, text: "Here is the important setup.", signals: { hook: 9.8, emotion: 9.8, curiosity: 9.8, payoff: 9.8, clarity: 9.8 } },
      { id: "strong-payoff", start: 105, end: 110, text: "And this is what happened next.", signals: { hook: 9.8, emotion: 9.8, curiosity: 9.8, payoff: 9.8, clarity: 9.8 } }
    ]
  });
  assert.deepEqual(plan.editDecisionList.map(item => item.segmentId), ["strong-setup", "strong-payoff"]);
  assert.equal(plan.editorialQuality.selectionStrategy, "best_scoring_chronological_story_window");
  assert.equal(plan.editorialQuality.sourceSpanSeconds, 10);
  assert.equal(plan.editorialQuality.sourceContinuity, 1);
});

test("re-edit assigns distinct framing rhythms to setup, development and payoff beats", () => {
  const plan = buildReeditPlan({
    source: licensed,
    targetDurationSeconds: 12,
    transcriptSegments: [
      { id: "setup", start: 10, end: 14, text: "Here is the setup.", signals: { hook: 4, emotion: 4, curiosity: 4, payoff: 4, clarity: 4 } },
      { id: "development", start: 14, end: 18, text: "Then the story develops.", signals: { hook: 4, emotion: 4, curiosity: 4, payoff: 4, clarity: 4 } },
      { id: "payoff", start: 18, end: 22, text: "And here is the result.", signals: { hook: 4, emotion: 4, curiosity: 4, payoff: 4, clarity: 4 } }
    ]
  });
  assert.deepEqual(plan.editDecisionList.map(item => item.treatment.motionTreatment), ["subtle_push", "steady_hold", "settle_pullback"]);
});

test("opening teaser truncation never leaves a dangling conjunction or preposition", () => {
  const plan = buildReeditPlan({
    source: licensed,
    transcriptSegments: [{
      id: "long-hook", start: 10, end: 20,
      text: "That's why these children are practicing to duck and cover just as you do in your school.",
      signals: { hook: 9, emotion: 9, curiosity: 9, payoff: 9, clarity: 9 }
    }]
  });
  assert.ok(plan.hookOverlay.text.length <= 51);
  assert.doesNotMatch(plan.hookOverlay.text, /\\b(and|or|but|to|of|for|with|as|because|that|from|by|in|on)\\.{0,3}$/i);
  assert.match(plan.hookOverlay.text, /…$/);
});


test("re-edit uses a curiosity-led teaser instead of exposing a later payoff", () => {
  const plan = buildReeditPlan({
    source: licensed,
    targetDurationSeconds: 12,
    transcriptSegments: [
      { id: "curiosity-hook", start: 10, end: 15, text: "Why did the entire town suddenly stop?", signals: { hook: 9, curiosity: 9, emotion: 5, payoff: 1, clarity: 8 } },
      { id: "answer-payoff", start: 15, end: 20, text: "The result was a complete evacuation.", signals: { hook: 2, curiosity: 2, emotion: 7, payoff: 10, clarity: 8 } }
    ]
  });
  assert.equal(plan.hookOverlay.segmentId, "curiosity-hook");
  assert.equal(plan.editDecisionList[0].beatRole, "hook");
  assert.equal(plan.editDecisionList[1].beatRole, "payoff");
  assert.equal(plan.editorialQuality.storyArcCoverage, 2);
});

test("beat classification recognises a chronological context-tension-payoff arc", () => {
  const plan = buildReeditPlan({
    source: licensed,
    targetDurationSeconds: 15,
    transcriptSegments: [
      { id: "hook", start: 0, end: 4, text: "Why did the rescue team enter the building?", signals: { hook: 8, curiosity: 8, payoff: 1, clarity: 8 } },
      { id: "tension", start: 4, end: 8, text: "But the main staircase suddenly collapsed.", signals: { hook: 2, curiosity: 3, emotion: 7, payoff: 1, clarity: 8 } },
      { id: "payoff", start: 8, end: 12, text: "In the end, the team escaped through a side exit.", signals: { hook: 1, curiosity: 2, emotion: 4, payoff: 7, clarity: 8 } }
    ]
  });
  assert.deepEqual(plan.editorialQuality.beatRoles.map(item => item.role), ["hook", "tension", "payoff"]);
  assert.equal(plan.editorialQuality.storyArcCoverage, 3);
});

test("narrative structure requires hook, concrete obstacle and outcome in chronological order", () => {
  const plan = buildReeditPlan({
    source: licensed,
    targetDurationSeconds: 15,
    transcriptSegments: [
      { id: "hook", start: 0, end: 4, text: "What happened when the crew entered the tunnel?", signals: { hook: 9, curiosity: 9, payoff: 1, clarity: 9 } },
      { id: "tension", start: 4, end: 8, text: "But the tunnel suddenly collapsed behind them.", signals: { hook: 2, curiosity: 2, emotion: 7, payoff: 1, clarity: 9 } },
      { id: "payoff", start: 8, end: 12, text: "Against all odds, they made it out through a side passage.", signals: { hook: 1, curiosity: 2, emotion: 4, payoff: 1, clarity: 9 } }
    ]
  });
  assert.deepEqual(plan.editorialQuality.beatRoles.map(item => item.role), ["hook", "tension", "payoff"]);
  assert.equal(plan.editorialQuality.narrativeStructure.status, "ordered_arc_detected");
  assert.deepEqual(plan.editorialQuality.narrativeStructure.sequence, ["hook", "tension", "payoff"]);
  assert.equal(plan.editorialQuality.narrativeStructure.method, "conservative_lexical_sequence_heuristic");
});

test("a contrast word alone does not prove a tension beat or complete story arc", () => {
  const plan = buildReeditPlan({
    source: licensed,
    targetDurationSeconds: 10,
    transcriptSegments: [
      { id: "hook", start: 0, end: 3, text: "Why did they choose this route?", signals: { hook: 9, curiosity: 9, clarity: 9 } },
      { id: "contrast", start: 3, end: 6, text: "But the route was longer than expected.", signals: { hook: 6, curiosity: 6, emotion: 4, payoff: 1, clarity: 10 } },
      { id: "context", start: 6, end: 9, text: "The journey took another hour.", signals: { hook: 6, curiosity: 6, emotion: 4, payoff: 1, clarity: 10 } }
    ]
  });
  assert.equal(plan.editorialQuality.beatRoles[1].role, "context");
  assert.equal(plan.editorialQuality.narrativeStructure.status, "no_ordered_arc_detected");
});

test("a question is a hook, while incidental result wording is not automatically payoff", () => {
  const plan = buildReeditPlan({
    source: licensed,
    targetDurationSeconds: 10,
    transcriptSegments: [
      { id: "question", start: 0, end: 4, text: "How did the team get inside?", signals: { hook: 10, curiosity: 10, payoff: 1, clarity: 10 } },
      { id: "incidental-result", start: 4, end: 8, text: "They recorded a result from the first test.", signals: { hook: 1, curiosity: 1, payoff: 1, clarity: 10 } }
    ]
  });
  assert.equal(plan.editorialQuality.beatRoles[0].role, "hook");
  assert.equal(plan.editorialQuality.beatRoles[1].role, "context");
});

test("an explanatory sentence containing the word why is not misclassified as a hook", () => {
  const plan = buildReeditPlan({
    source: licensed,
    targetDurationSeconds: 10,
    transcriptSegments: [
      { id: "explanation", start: 0, end: 4, text: "That's why the safety procedure is important.", signals: { hook: 6, curiosity: 6, emotion: 5, payoff: 6, clarity: 10 } },
      { id: "detail", start: 4, end: 8, text: "The procedure keeps everyone away from danger.", signals: { hook: 6, curiosity: 6, emotion: 5, payoff: 6, clarity: 10 } }
    ]
  });
  assert.deepEqual(plan.editorialQuality.beatRoles.map(item => item.role), ["context", "context"]);
});

test("explanatory that's why statement is not promoted to a hook by high lexical scores", () => {
  const plan = buildReeditPlan({
    source: licensed,
    targetDurationSeconds: 10,
    transcriptSegments: [
      { id: "explanatory", start: 0, end: 4, text: "That's why these children are practicing to duck and cover.", signals: { hook: 9, curiosity: 9, payoff: 2, clarity: 9 } },
      { id: "context", start: 4, end: 8, text: "They practice the same procedure at school.", signals: { hook: 2, curiosity: 2, payoff: 1, clarity: 9 } }
    ]
  });
  assert.equal(plan.editorialQuality.beatRoles[0].role, "context");
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

test("compilation refuses to exceed its requested duration", () => {
  const clip = { sourceUrl: "https://media.example/clip.mp4", rightsStatus: "permission_granted", rightsEvidenceReference: "permission-2", allowedPlatforms: ["youtube_shorts"], start: 0, end: 20 };
  const plan = buildCompilationPlan({ introCommentary: "Intro", outroCommentary: "Outro", targetDurationSeconds: 30, clips: [{ ...clip, sourceId: "one" }, { ...clip, sourceId: "two" }] });
  assert.equal(plan.status, "blocked_duration");
  assert.deepEqual(plan.sequence, []);
});

 
test("re-edit does not invent a hook overlay when no candidate contains a genuine curiosity cue", () => {
  const plan = buildReeditPlan({
    source: licensed,
    targetDurationSeconds: 15,
    transcriptSegments: [{
      id: "statement", start: 10, end: 13, text: "The demonstration continued as expected.",
      signals: { hook: 2, curiosity: 2, emotion: 10, payoff: 10, clarity: 8 }
    }]
  });
  assert.equal(plan.status, "edit_plan_ready");
  assert.equal(plan.hookOverlay, null);
});
