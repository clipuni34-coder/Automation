import test from "node:test";
import assert from "node:assert/strict";
import { splitScriptSentences, buildCaptionCues, buildAssDocument, validateNarratedEntry } from "../src/production/narrated-plan.js";
import { computeQualityAudit } from "../scripts/candidate-utils.mjs";

const SCRIPT = "Meet Chiitan, the fearless mascot who never gives up. The plan starts with total confidence. The landing has other ideas entirely. But every fall gets an instant comeback. Fall spectacularly, get up immediately, and always go again.";

test("caption cues cover the full narration with a flagged hook cue", () => {
  const cues = buildCaptionCues(SCRIPT, 18);
  assert.equal(cues.length, 5);
  assert.equal(cues[0].hook, true);
  assert.ok(Math.abs(cues.at(-1).end - 18) < 0.05);
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].start >= cues[i - 1].end - 0.05);
  const ass = buildAssDocument(cues, { title: "t" });
  assert.match(ass, /Style: Hook/);
  assert.match(ass, /Dialogue: 0,0:00:00\.00/);
});

test("narrated entry validation enforces a complete story plan", () => {
  assert.equal(validateNarratedEntry({ productionMode: "narrated", narrationScript: SCRIPT, postingTitle: "A proper title here", hookText: "A planned hook line" }).valid, true);
  assert.equal(validateNarratedEntry({ productionMode: "narrated", narrationScript: "Too short.", postingTitle: "A proper title here", hookText: "A planned hook line" }).valid, false);
  assert.equal(validateNarratedEntry({ productionMode: "excerpt", narrationScript: SCRIPT, postingTitle: "A proper title here", hookText: "A planned hook line" }).valid, false);
});

test("quality audit holds weak hooks and missing payoffs, passes strong stories", () => {
  const weak = computeQualityAudit({ editDecisionList: [{ score: 3.2 }, { score: 6 }, { score: 3.9 }] });
  assert.equal(weak.passed, false);
  assert.ok(weak.reasons.some((r) => /hook/i.test(r)));
  assert.ok(weak.reasons.some((r) => /payoff/i.test(r)));
  const strong = computeQualityAudit({ editorialQuality: { selectedDurationSeconds: 14 }, editDecisionList: [{ score: 7.1, caption: "Why does water float here?" }, { score: 6.4, caption: "Watch what happens next" }, { score: 6.8, caption: "That is the surprising answer" }] });
  assert.equal(strong.passed, true);
  assert.equal(strong.hookScore, 7.1);
  assert.equal(strong.payoffScore, 6.8);
});

test("quality audit rejects the two real failure shapes found in the launch audit", () => {
  // Real shape 1: a single 4.7s question with no answer (Don Pettit launch video).
  const single = computeQualityAudit({ editorialQuality: { selectedDurationSeconds: 4.7 }, editDecisionList: [{ score: 6.22, caption: "What do you do for fun in the International Space Station and do you play video games?" }] });
  assert.equal(single.passed, false);
  assert.ok(single.reasons.some((r) => /Only one moment/.test(r)));
  assert.ok(single.reasons.some((r) => /too short/.test(r)));
  // Real shape 2: radio-check chatter as the hook (Pennsylvania launch video).
  const chatter = computeQualityAudit({ editorialQuality: { selectedDurationSeconds: 6.36 }, editDecisionList: [{ score: 6.27, caption: "Station, this is Houston, are you ready for the event?" }, { score: 6.23, caption: "Station, this is Houston ACR, how do you hear us?" }, { score: 6.27, caption: "I hear you loud and clear, how me?" }] });
  assert.equal(chatter.passed, false);
  assert.ok(chatter.reasons.some((r) => /procedural communications/.test(r)));
});

test("overlay correction: edge bands reframe, large/central/dual overlays hold", async () => {
  const { decideOverlayCorrection } = await import("../src/production/narrated-plan.js");
  assert.equal(decideOverlayCorrection({ status: "ok", overlays: [] }).action, "none");
  const reframe = decideOverlayCorrection({ status: "ok", overlays: [{ band: "top", fraction: 0.2 }] });
  assert.equal(reframe.action, "reframe"); assert.equal(reframe.band, "top");
  assert.equal(decideOverlayCorrection({ status: "ok", overlays: [{ band: "top", fraction: 0.2 }, { band: "bottom", fraction: 0.2 }] }).action, "hold");
  assert.equal(decideOverlayCorrection({ status: "insufficient_frames", overlays: [] }).action, "hold");
});
