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

test("standalone re-edit preserves the original offset of a bounded source excerpt", () => {
  const plan = buildReeditPlan({
    source: { ...licensed, excerptStartSeconds: 700 },
    targetDurationSeconds: 30,
    transcriptSegments: [
      { id: "hook", start: 0, end: 5, text: "Why did the crew run out of fuel?", signals: { hook: 9, curiosity: 9, clarity: 8 } },
      { id: "payoff", start: 5, end: 10, text: "They landed safely on the surface.", signals: { payoff: 9, emotion: 8, clarity: 8 } }
    ]
  });
  assert.equal(plan.source.excerptStartSeconds, 700);
  assert.equal(plan.editDecisionList[0].sourceIn, 0);
  assert.equal(plan.editDecisionList[1].sourceIn, 5);
});

test("partial semantic story windows may select a quote-validated connected excerpt without claiming a complete arc", () => {
  const transcriptSegments = [
    { id: "context", start: 10, end: 12.7, text: "We copy you on the ground.", signals: { hook: 3, emotion: 3, curiosity: 3, payoff: 3, clarity: 3 } },
    { id: "relief", start: 13, end: 15.7, text: "We're breathing again.", signals: { hook: 3, emotion: 3, curiosity: 3, payoff: 3, clarity: 3 } },
    { id: "confirmation", start: 16, end: 18.7, text: "You're looking good here.", signals: { hook: 3, emotion: 3, curiosity: 3, payoff: 3, clarity: 3 } }
  ];
  const narrativeSemanticAnalysis = {
    status: "human_review_required",
    provider: "gemini",
    momentAssessments: [
      { segmentId: "context", compellingScore: 6, confidence: 0.9, role: "context", selfContained: false, evidenceValidated: true, evidence: "We copy you on the ground." },
      { segmentId: "relief", compellingScore: 8, confidence: 0.9, role: "tension", selfContained: true, evidenceValidated: true, evidence: "We're breathing again." },
      { segmentId: "confirmation", compellingScore: 7, confidence: 0.9, role: "payoff", selfContained: true, evidenceValidated: true, evidence: "You're looking good here." }
    ],
    transitions: [
      { fromSegmentId: "context", toSegmentId: "relief", relationship: "connected", confidence: 0.9, evidenceSegmentId: "context", evidenceValidated: true, evidence: "We copy you on the ground." },
      { fromSegmentId: "relief", toSegmentId: "confirmation", relationship: "connected", confidence: 0.9, evidenceSegmentId: "relief", evidenceValidated: true, evidence: "We're breathing again." }
    ],
    storyWindow: { arcStatus: "partial", segmentIds: ["context", "relief", "confirmation"], confidence: 0.6, evidenceValidated: false, summary: "A short connected reaction excerpt.", rationale: "The larger story context is not included." }
  };
  const plan = buildReeditPlan({
    source: { ...licensed, excerptStartSeconds: 700 },
    targetDurationSeconds: 45,
    transcriptSegments,
    narrativeSemanticAnalysis
  });
  assert.equal(plan.status, "edit_plan_ready");
  assert.equal(plan.editorialQuality.selectionStrategy, "semantic_connected_excerpt");
  assert.deepEqual(plan.editDecisionList.map(item => item.segmentId), ["context", "relief", "confirmation"]);
  assert.ok(plan.editorialQuality.averageSelectedScore >= 5.5);
  assert.equal(plan.editorialQuality.semanticStoryWindow.arcStatus, "partial");
  assert.equal(plan.editorialQuality.semanticStoryWindow.qualified, true);
  assert.match(plan.editorialNotes.join(" "), /not a claim that the full story arc is present/);
  assert.equal(plan.hookOverlay.segmentId, "relief");
});

test("finds a two-moment connected landing-and-reaction excerpt outside the model's partial story window", () => {
  const transcriptSegments = [
    { id: "landing", start: 24.56, end: 32, text: "Roger, Tranquility, we copy you on the ground. We're breathing again, thanks a lot, hey.", signals: { hook: 0, emotion: 2, curiosity: 0, payoff: 1, clarity: 8 } },
    { id: "reaction", start: 32.5, end: 36, text: "You're looking good here.", signals: { hook: 1, emotion: 2, curiosity: 1, payoff: 1, clarity: 8 } }
  ];
  const narrativeSemanticAnalysis = {
    status: "human_review_required",
    provider: "gemini",
    momentAssessments: [
      { segmentId: "landing", compellingScore: 9, confidence: 0.95, role: "payoff", selfContained: true, evidenceValidated: true, evidence: "we copy you on the ground" },
      { segmentId: "reaction", compellingScore: 6, confidence: 0.8, role: "context", selfContained: true, evidenceValidated: true, evidence: "You're looking good here." }
    ],
    transitions: [
      { fromSegmentId: "landing", toSegmentId: "reaction", relationship: "connected", confidence: 0.9, evidenceSegmentId: "reaction", evidenceValidated: true, evidence: "You're looking good here." }
    ],
    storyWindow: { arcStatus: "partial", segmentIds: ["unrelated-1", "unrelated-2", "unrelated-3"], confidence: 0.6, evidenceValidated: false, summary: "The model selected an unrelated partial window." }
  };
  const plan = buildReeditPlan({
    source: { ...licensed, excerptStartSeconds: 700 },
    targetDurationSeconds: 45,
    transcriptSegments,
    narrativeSemanticAnalysis
  });
  assert.equal(plan.status, "edit_plan_ready");
  assert.equal(plan.editorialQuality.selectionStrategy, "semantic_connected_excerpt");
  assert.deepEqual(plan.editDecisionList.map(item => item.segmentId), ["landing", "reaction"]);
  assert.ok(plan.editorialQuality.averageSelectedScore >= 5.5);
  assert.equal(plan.editorialQuality.semanticStoryWindow.arcStatus, "partial");
  assert.equal(plan.editorialQuality.semanticStoryWindow.qualified, true);
  assert.match(plan.editorialNotes.join(" "), /not a claim that the full story arc is present/);
});

test("partial semantic story windows do not qualify when adjacent evidence is not verified", () => {
  const transcriptSegments = [
    { id: "context", start: 10, end: 12.7, text: "We copy you on the ground.", signals: { hook: 3, emotion: 3, curiosity: 3, payoff: 3, clarity: 3 } },
    { id: "relief", start: 13, end: 15.7, text: "We're breathing again.", signals: { hook: 3, emotion: 3, curiosity: 3, payoff: 3, clarity: 3 } },
    { id: "confirmation", start: 16, end: 18.7, text: "You're looking good here.", signals: { hook: 3, emotion: 3, curiosity: 3, payoff: 3, clarity: 3 } }
  ];
  const narrativeSemanticAnalysis = {
    status: "human_review_required",
    provider: "gemini",
    momentAssessments: [
      { segmentId: "context", compellingScore: 6, confidence: 0.9, role: "context", selfContained: false, evidenceValidated: true },
      { segmentId: "relief", compellingScore: 8, confidence: 0.9, role: "tension", selfContained: true, evidenceValidated: true },
      { segmentId: "confirmation", compellingScore: 7, confidence: 0.9, role: "payoff", selfContained: true, evidenceValidated: true }
    ],
    transitions: [
      { fromSegmentId: "context", toSegmentId: "relief", relationship: "connected", confidence: 0.9, evidenceSegmentId: "context", evidenceValidated: true, evidence: "We copy you on the ground." },
      { fromSegmentId: "relief", toSegmentId: "confirmation", relationship: "uncertain", confidence: 0.4, evidenceSegmentId: null, evidenceValidated: false, evidence: "" }
    ],
    storyWindow: { arcStatus: "partial", segmentIds: ["context", "relief", "confirmation"], confidence: 0.6, evidenceValidated: false }
  };
  const plan = buildReeditPlan({ source: licensed, targetDurationSeconds: 45, transcriptSegments, narrativeSemanticAnalysis });
  assert.notEqual(plan.editorialQuality.selectionStrategy, "semantic_connected_excerpt");
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


test("high-confidence semantic moment assessment can change which source moment is selected", () => {
  const transcriptSegments = [
    { id: "early-a", start: 0, end: 8, text: "An ordinary opening detail.", signals: { hook: 5, emotion: 5, curiosity: 5, payoff: 5, clarity: 5 } },
    { id: "early-b", start: 9, end: 17, text: "Another ordinary detail.", signals: { hook: 5, emotion: 5, curiosity: 5, payoff: 5, clarity: 5 } },
    { id: "late-a", start: 30, end: 38, text: "A specific surprising discovery changed everything.", signals: { hook: 5, emotion: 5, curiosity: 5, payoff: 5, clarity: 5 } },
    { id: "late-b", start: 39, end: 47, text: "The team finally found the missing evidence.", signals: { hook: 5, emotion: 5, curiosity: 5, payoff: 5, clarity: 5 } }
  ];
  const momentAssessments = transcriptSegments.map((segment, index) => ({
    segmentId: segment.id,
    compellingScore: index >= 2 ? 9.5 : 1.5,
    confidence: 0.9, evidenceValidated: true,
    role: index === 2 ? "hook" : index === 3 ? "payoff" : "context",
    selfContained: index === 3,
    rationale: "Mocked evidence-backed semantic assessment.",
    evidence: segment.text
  }));
  const plan = buildReeditPlan({
    source: licensed,
    targetDurationSeconds: 15,
    transcriptSegments,
    narrativeSemanticAnalysis: { status: "contextually_connected", qualified: true, transitions: [], momentAssessments, momentAssessmentStatus: "complete" }
  });
  assert.ok(plan.editDecisionList.some(item => item.segmentId === "late-a" || item.segmentId === "late-b"));
  assert.equal(plan.editorialQuality.selectionStrategy, "semantic_plus_heuristic_chronological_story_window");
  assert.equal(plan.editorialQuality.semanticMomentAssessment.trustedMoments, 4);
});


test("semantic story window trims redundant edges but preserves the validated hook-to-payoff path", () => {
  const transcriptSegments = [
    { id: "pre-context", start: 0, end: 5, text: "Earlier background information was introduced.", signals: { hook: 2, curiosity: 2, clarity: 8 } },
    { id: "hook", start: 5, end: 8, text: "The bridge suddenly collapsed during the storm.", signals: { hook: 1, curiosity: 1, clarity: 9 } },
    { id: "setup", start: 8, end: 11, text: "The support cable had weakened during the storm.", signals: { clarity: 9 } },
    { id: "payoff", start: 11, end: 14, text: "Engineers rebuilt the bridge and reopened the road.", signals: { payoff: 9, clarity: 9 } },
    { id: "post-context", start: 14, end: 19, text: "The presenter then repeated the general safety message.", signals: { clarity: 7 } }
  ];
  const momentAssessments = transcriptSegments.map((segment, index) => ({
    segmentId: segment.id, compellingScore: [2, 9, 8, 9, 2][index], confidence: 0.95, evidenceValidated: true,
    role: ["context", "hook", "setup", "payoff", "context"][index],
    selfContained: false, rationale: "Evidence-backed moment assessment.", evidence: segment.text
  }));
  const transitions = transcriptSegments.slice(0, -1).map((segment, index) => ({
    fromSegmentId: segment.id, toSegmentId: transcriptSegments[index + 1].id,
    relationship: "connected", confidence: 0.9, evidenceValidated: true, explanation: "Same unfolding story.",
    evidence: transcriptSegments[index + 1].text
  }));
  const plan = buildReeditPlan({
    source: licensed, targetDurationSeconds: 15, transcriptSegments,
    narrativeSemanticAnalysis: {
      status: "contextually_connected", transitions, momentAssessments,
      storyWindow: {
        arcStatus: "complete", segmentIds: transcriptSegments.map(item => item.id),
        hookSegmentId: "hook", payoffSegmentId: "payoff",
        hookEvidence: "The bridge suddenly collapsed during the storm",
        payoffEvidence: "Engineers rebuilt the bridge and reopened the road",
        confidence: 0.95, evidenceValidated: true,
        summary: "A bridge collapses and is rebuilt.", rationale: "A complete chronological story."
      }
    }
  });
  assert.deepEqual(plan.editDecisionList.map(item => item.segmentId), ["hook", "setup", "payoff"]);
  assert.equal(plan.editorialQuality.semanticStoryWindow.trim.trimmed, true);
  assert.deepEqual(plan.editorialQuality.semanticStoryWindow.trim.selectedSegmentIds, ["hook", "setup", "payoff"]);
  assert.equal(plan.editorialQuality.semanticStoryWindow.qualified, true);
  assert.equal(plan.hookOverlay.segmentId, "hook");
});

test("validated complete semantic story window takes priority over isolated score ranking", () => {
  const transcriptSegments = [
    { id: "intro", start: 0, end: 4, text: "The presenter introduces the subject.", signals: { hook: 8, emotion: 7, curiosity: 8, payoff: 2, clarity: 8 } },
    { id: "hook", start: 5, end: 9, text: "Why did the bridge suddenly collapse?", signals: { hook: 5, emotion: 5, curiosity: 5, payoff: 5, clarity: 5 } },
    { id: "tension", start: 10, end: 14, text: "The support cable snapped during the storm.", signals: { hook: 5, emotion: 5, curiosity: 5, payoff: 5, clarity: 5 } },
    { id: "payoff", start: 15, end: 19, text: "Engineers rebuilt the bridge and reopened the road.", signals: { hook: 5, emotion: 5, curiosity: 5, payoff: 5, clarity: 5 } }
  ];
  const momentAssessments = transcriptSegments.map((segment, index) => ({
    segmentId: segment.id, compellingScore: index === 0 ? 10 : 8.5, confidence: 0.9, evidenceValidated: true,
    role: ["context", "hook", "tension", "payoff"][index], selfContained: index === 3,
    rationale: "Validated semantic story beat.", evidence: segment.text
  }));
  const plan = buildReeditPlan({
    source: licensed,
    targetDurationSeconds: 15,
    transcriptSegments,
    narrativeSemanticAnalysis: {
      status: "human_review_required",
      transitions: [
        { fromSegmentId: "intro", toSegmentId: "hook", relationship: "disconnected", confidence: 0.9 },
        { fromSegmentId: "hook", toSegmentId: "tension", relationship: "connected", confidence: 0.9, evidenceValidated: true },
        { fromSegmentId: "tension", toSegmentId: "payoff", relationship: "connected", confidence: 0.9, evidenceValidated: true }
      ],
      momentAssessments,
      storyWindow: {
        arcStatus: "complete", segmentIds: ["hook", "tension", "payoff"],
        hookSegmentId: "hook", payoffSegmentId: "payoff",
        hookEvidence: "Why did the bridge suddenly collapse",
        payoffEvidence: "rebuilt the bridge and reopened the road",
        confidence: 0.9, evidenceValidated: true,
        summary: "A bridge collapses and is rebuilt.",
        rationale: "Problem, consequence and resolution."
      }
    }
  });
  assert.deepEqual(plan.editDecisionList.map(item => item.segmentId), ["hook", "tension", "payoff"]);
  assert.equal(plan.editorialQuality.selectionStrategy, "semantic_complete_story_window");
  assert.equal(plan.editorialQuality.semanticStoryWindow.qualified, true);
  assert.equal(plan.editorialQuality.narrativeStructure.semanticContinuityQualification.qualified, true);
  assert.equal(plan.editDecisionList[0].treatment.motionTreatment, "impact_punch_in");
  assert.equal(plan.editDecisionList[1].treatment.motionTreatment, "subtle_push");
  assert.equal(plan.editDecisionList[2].treatment.motionTreatment, "settle_pullback");
});


test("editorial hold exposes ranked candidate evidence and weak signal breakdown", () => {
  const plan = buildReeditPlan({
    source: licensed,
    targetDurationSeconds: 12,
    transcriptSegments: [
      { id: "candidate-a", start: 0, end: 4, text: "The lesson begins with a general safety instruction.", signals: { hook: 1, curiosity: 1, emotion: 2, payoff: 1, clarity: 8 } },
      { id: "candidate-b", start: 5, end: 9, text: "The presenter repeats the same general instruction.", signals: { hook: 1, curiosity: 1, emotion: 1, payoff: 1, clarity: 8 } }
    ]
  });
  assert.equal(plan.status, "editorial_review_required");
  assert.equal(plan.editorialQuality.candidateDiagnostics.method, "top_five_heuristic_candidate_score_breakdown");
  assert.equal(plan.editorialQuality.candidateDiagnostics.topCandidates.length, 2);
  assert.equal(plan.editorialQuality.candidateDiagnostics.topCandidates[0].segmentId, "candidate-a");
  assert.ok(plan.editorialQuality.candidateDiagnostics.topCandidates[0].weakSignals.includes("hook"));
  assert.match(plan.editorialQuality.candidateDiagnostics.limitation, /not semantic understanding/i);
});


test("semantic connected excerpt accepts an evidence-validated setup followed by payoff beats", () => {
  const transcriptSegments = [
    { id: "setup", start: 10, end: 13, text: "We copy you on the ground.", signals: { hook: 5, emotion: 5, curiosity: 5, payoff: 5, clarity: 5 } },
    { id: "relief", start: 13.3, end: 16.3, text: "We're breathing again.", signals: { hook: 5, emotion: 5, curiosity: 5, payoff: 5, clarity: 5 } },
    { id: "confirmation", start: 16.6, end: 19.6, text: "You're looking good here.", signals: { hook: 5, emotion: 5, curiosity: 5, payoff: 5, clarity: 5 } }
  ];
  const momentAssessments = transcriptSegments.map((segment, index) => ({
    segmentId: segment.id,
    compellingScore: [7, 8, 7][index],
    confidence: 0.9,
    role: ["setup", "payoff", "payoff"][index],
    selfContained: true,
    evidenceValidated: true,
    rationale: "Evidence-backed setup and outcome moment.",
    evidence: segment.text
  }));
  const transitions = transcriptSegments.slice(0, -1).map((segment, index) => ({
    fromSegmentId: segment.id,
    toSegmentId: transcriptSegments[index + 1].id,
    relationship: "connected",
    confidence: 0.9,
    evidenceSegmentId: transcriptSegments[index + 1].id,
    evidenceValidated: true,
    evidence: transcriptSegments[index + 1].text
  }));
  const plan = buildReeditPlan({
    source: licensed,
    targetDurationSeconds: 30,
    transcriptSegments,
    narrativeSemanticAnalysis: {
      status: "human_review_required",
      provider: "gemini",
      transitions,
      momentAssessments,
      storyWindow: {
        arcStatus: "partial",
        segmentIds: ["unrelated-1", "unrelated-2", "unrelated-3"],
        confidence: 0.6,
        summary: "The model's broader partial window misses this connected excerpt."
      }
    }
  });
  assert.equal(plan.status, "edit_plan_ready");
  assert.equal(plan.editorialQuality.selectionStrategy, "semantic_connected_excerpt");
  assert.deepEqual(plan.editDecisionList.map(item => item.segmentId), ["setup", "relief", "confirmation"]);
  assert.equal(plan.editorialQuality.semanticStoryWindow.qualified, true);
});


test("hook teaser extracts the actual high-stakes phrase instead of unrelated opening words", () => {
  const plan = buildReeditPlan({
    source: licensed,
    targetDurationSeconds: 15,
    transcriptSegments: [{
      id: "landing-relief", start: 10, end: 18,
      text: "Roger, Tranquility, we copy you on the ground. You got a bunch of guys about to turn blue. We're breathing again.",
      signals: { hook: 9, curiosity: 9, emotion: 9, payoff: 9, clarity: 9 }
    }]
  });
  assert.match(plan.hookOverlay.text, /about to turn blue/i);
  assert.doesNotMatch(plan.hookOverlay.text, /roger|tranquility/i);
  assert.doesNotMatch(plan.hookOverlay.text, /breathing again/i);
});


test("a model-labelled hook without an actual hook cue cannot override a clear high-stakes teaser", () => {
  const transcriptSegments = [
    { id: "call-sign", start: 10, end: 12, text: "Tranquility.", signals: { hook: 2, curiosity: 0, emotion: 1, payoff: 1, clarity: 8 } },
    { id: "oxygen-risk", start: 12.2, end: 16, text: "You got a bunch of guys about to turn blue.", signals: { hook: 9, curiosity: 9, emotion: 9, payoff: 1, clarity: 8 } },
    { id: "relief", start: 16.2, end: 19, text: "We're breathing again.", signals: { hook: 1, curiosity: 1, emotion: 9, payoff: 9, clarity: 8 } }
  ];
  const momentAssessments = [
    { segmentId: "call-sign", compellingScore: 7, confidence: 0.9, role: "hook", selfContained: false, evidenceValidated: true, evidence: "Tranquility." },
    { segmentId: "oxygen-risk", compellingScore: 9, confidence: 0.9, role: "tension", selfContained: false, evidenceValidated: true, evidence: "about to turn blue" },
    { segmentId: "relief", compellingScore: 9, confidence: 0.9, role: "payoff", selfContained: true, evidenceValidated: true, evidence: "We're breathing again." }
  ];
  const transitions = transcriptSegments.slice(0, -1).map((segment, index) => ({
    fromSegmentId: segment.id,
    toSegmentId: transcriptSegments[index + 1].id,
    relationship: "connected",
    confidence: 0.9,
    evidenceSegmentId: transcriptSegments[index + 1].id,
    evidenceValidated: true,
    evidence: transcriptSegments[index + 1].text
  }));
  const plan = buildReeditPlan({
    source: licensed,
    targetDurationSeconds: 20,
    transcriptSegments,
    narrativeSemanticAnalysis: {
      status: "contextually_connected",
      transitions,
      momentAssessments,
      storyWindow: {
        arcStatus: "complete",
        segmentIds: ["call-sign", "oxygen-risk", "relief"],
        hookSegmentId: "call-sign",
        payoffSegmentId: "relief",
        hookEvidence: "Tranquility.",
        payoffEvidence: "We're breathing again.",
        confidence: 0.9,
        evidenceValidated: true
      }
    }
  });
  assert.equal(plan.status, "edit_plan_ready");
  assert.equal(plan.hookOverlay.segmentId, "oxygen-risk");
  assert.match(plan.hookOverlay.text, /about to turn blue/i);
});
