import test from "node:test";
import assert from "node:assert/strict";
import { buildTranscriptCandidates } from "../src/clips/transcript-candidates.js";
import { buildReeditPlan } from "../src/creative/reedit.js";

const words = [
  { word: "Why", start: 0, end: 0.4 },
  { word: "does", start: 0.4, end: 0.8 },
  { word: "this", start: 0.8, end: 1.1 },
  { word: "happen?", start: 1.1, end: 2.4 },
  { word: "Here", start: 5, end: 5.4 },
  { word: "is", start: 5.4, end: 5.7 },
  { word: "the", start: 5.7, end: 6 },
  { word: "answer.", start: 6, end: 7.4 }
];

test("transcript candidates include visual activity and speech continuity when media analysis is supplied", () => {
  const candidates = buildTranscriptCandidates(words, {
    mediaSignals: {
      sceneChanges: [0.9, 1.8, 6.5],
      silenceIntervals: [{ start: 1.5, end: 2 }, { start: 6.2, end: 7 }]
    }
  });
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].signals.sceneChangeCount, 2);
  assert.equal(candidates[0].signals.visualActivity, 6);
  assert.equal(candidates[0].signals.silenceRatio, 0.208);
  assert.equal(candidates[0].signals.speechContinuity, 7.92);
});

test("re-edit planner uses media signals as a modest tie-breaker without overriding stronger editorial signals", () => {
  const common = { hook: 8, emotion: 8, curiosity: 8, payoff: 8, clarity: 8 };
  const plan = buildReeditPlan({
    source: {
      sourceUrl: "https://example.org/owned.mp4",
      durationSeconds: 20,
      rightsStatus: "owned_by_user",
      allowedPlatforms: ["youtube_shorts"]
    },
    transcriptSegments: [
      { id: "low-activity", start: 0, end: 5, text: "A complete explanation.", signals: { ...common, visualActivity: 2, speechContinuity: 6 } },
      { id: "high-activity", start: 10, end: 15, text: "A complete explanation.", signals: { ...common, visualActivity: 10, speechContinuity: 10 } }
    ],
    targetDurationSeconds: 15
  });
  assert.equal(plan.openingHook.segmentId, "high-activity");
});
