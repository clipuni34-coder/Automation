import test from "node:test";
import assert from "node:assert/strict";
import { analyzeContextualStory } from "../src/creative/contextual-story.js";
import { buildReeditPlan } from "../src/creative/reedit.js";

test("contextual story links a multi-chunk setup, obstacle, response and outcome", () => {
  const segments = [
    { id: "setup", start: 0, end: 4, text: "The lighthouse keeper watched the storm approach the coast." },
    { id: "obstacle", start: 5, end: 9, text: "The storm struck the coast and damaged the lighthouse radio." },
    { id: "response", start: 10, end: 14, text: "The lighthouse keeper used the emergency signal after that." },
    { id: "outcome", start: 15, end: 19, text: "The emergency signal guided boats away from the storm and coast." }
  ];
  const result = analyzeContextualStory(segments);
  assert.equal(result.status, "mostly_linked_sequence");
  assert.equal(result.linkedAdjacentPairs, 3);
  assert.equal(result.longestConnectedRun, 4);
  assert.ok(result.transitions.every(item => item.sharedTerms.length >= 2 || item.connectiveCue));
});

test("contextual story does not connect unrelated chunks just because each contains generic dramatic words", () => {
  const result = analyzeContextualStory([
    { id: "a", start: 0, end: 3, text: "The actor revealed a secret during the interview." },
    { id: "b", start: 4, end: 7, text: "A volcano erupted near the village after midnight." },
    { id: "c", start: 8, end: 11, text: "The football team celebrated a victory in the stadium." }
  ]);
  assert.equal(result.status, "disconnected_sequence");
  assert.equal(result.linkedAdjacentPairs, 0);
  assert.equal(result.disconnectedBoundaries.length, 2);
});

test("a transition word by itself is not enough to establish contextual continuity", () => {
  const result = analyzeContextualStory([
    { id: "a", start: 0, end: 3, text: "A scientist studied distant galaxies." },
    { id: "b", start: 4, end: 7, text: "After that, the chef prepared dinner." }
  ]);
  assert.equal(result.transitions[0].linked, false);
  assert.equal(result.transitions[0].basis, "insufficient_shared_context");
});

test("contextual story analysis sorts chunks chronologically before linking", () => {
  const result = analyzeContextualStory([
    { id: "second", start: 5, end: 8, text: "The rescue boat reached the storm damaged harbour." },
    { id: "first", start: 1, end: 4, text: "The storm damaged the harbour and trapped the rescue boat." }
  ]);
  assert.equal(result.transitions[0].fromSegmentId, "first");
  assert.equal(result.transitions[0].toSegmentId, "second");
  assert.equal(result.transitions[0].linked, true);
});

test("an ordered hook-tension-payoff sequence is not context-qualified when its beats are disconnected", () => {
  const plan = buildReeditPlan({
    source: {
      sourceUrl: "https://creator.example/disconnected-story.mp4",
      durationSeconds: 30,
      rightsStatus: "permission_granted",
      rightsEvidenceReference: "test-consent",
      allowedPlatforms: ["youtube_shorts"]
    },
    platform: "youtube_shorts",
    targetDurationSeconds: 20,
    transcriptSegments: [
      { id: "hook", start: 0, end: 4, text: "Why did the astronomer study distant galaxies?", signals: { hook: 9, curiosity: 9, clarity: 9 } },
      { id: "tension", start: 5, end: 9, text: "The hiker became trapped in a desert canyon.", signals: { emotion: 9, clarity: 9 } },
      { id: "payoff", start: 10, end: 14, text: "The chef finally escaped the flooded kitchen.", signals: { payoff: 9, clarity: 9 } }
    ]
  });
  assert.equal(plan.editorialQuality.narrativeStructure.status, "ordered_arc_detected");
  assert.equal(plan.editorialQuality.narrativeStructure.contextualContinuityQualification.qualified, false);
  assert.equal(plan.editorialQuality.narrativeStructure.contextualContinuityQualification.status, "beat_sequence_has_disconnected_context");
  assert.equal(plan.editorialQuality.narrativeStructure.contextualContinuityQualification.disconnectedTransitions.length, 2);
});

test("re-edit plan exposes contextual evidence and keeps the human-review story caveat", () => {
  const plan = buildReeditPlan({
    source: {
      sourceUrl: "https://creator.example/video.mp4",
      durationSeconds: 30,
      rightsStatus: "permission_granted",
      rightsEvidenceReference: "test-consent",
      allowedPlatforms: ["youtube_shorts"]
    },
    platform: "youtube_shorts",
    targetDurationSeconds: 20,
    transcriptSegments: [
      { id: "hook", start: 0, end: 4, text: "Why did the lighthouse keeper watch the storm?", signals: { hook: 9, curiosity: 9, clarity: 8 } },
      { id: "tension", start: 5, end: 9, text: "The storm damaged the lighthouse radio and trapped the keeper.", signals: { emotion: 8, clarity: 8 } },
      { id: "payoff", start: 10, end: 14, text: "The keeper used the emergency signal and guided boats away from the storm.", signals: { payoff: 9, clarity: 9 } }
    ]
  });
  assert.ok(plan.editorialQuality.contextualStoryAnalysis);
  assert.equal(plan.editorialQuality.contextualStoryAnalysis.segmentCount, 3);
  assert.ok(plan.editorialQuality.narrativeStructure.contextualContinuity);
  assert.match(plan.editorialQuality.contextualStoryAnalysis.limitation, /does not establish semantic meaning/i);
});
