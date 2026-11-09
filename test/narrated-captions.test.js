import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSpeechAlignedCaptionCues, placeCaptionCues, buildAssDocument, validateOpeningHookText, estimatedCaptionWidth, MAX_CAPTION_WORDS, MAX_CAPTION_CHARS, CAPTION_X, CAPTION_Y } from "../src/production/narrated-captions.js";
import { validateVisualHookReview, validateNarrationWindowBounds, buildCreativeReviewChecklist } from "../src/production/narrated-plan.js";
import { narratedRequeueDecision, isTransientProductionOutcome } from "../src/engine/retry-policy.js";

const SCRIPT = "A playful seal sees the diver. It circles around the fins. Then the visitor swims away.";
function transcript(script = SCRIPT) {
  const words = script.split(/\s+/).map((word, i) => ({ word, start: Number((0.2 + i * 0.4).toFixed(2)), end: Number((0.48 + i * 0.4).toFixed(2)), probability: 0.95 }));
  return { status: "transcribed", engine: "faster-whisper", model: "base", language: "en", droppedWordCount: 0, words };
}
const build = (t = transcript(), script = SCRIPT, durationSeconds = 12) => buildSpeechAlignedCaptionCues({ script, transcription: t, durationSeconds });

function seed() {
  return {
    id: "clip", sourceUrl: "https://upload.wikimedia.org/clip.webm", productionMode: "narrated", window: { startSeconds: 7, seconds: 16 },
    postingTitle: "A playful seal moment", hookText: "A playful seal sees the diver.", visualSubject: "seal",
    storyBeats: { hook: "A seal sees the diver.", development: "The seal circles the fins.", payoff: "The seal swims away." },
    narrationScript: "A playful seal sees the diver. It circles around the fins and pauses for a moment. The curious visitor takes another look before it finally swims away."
  };
}
function review(c = seed()) {
  return { status: "editorial_reviewed", sourceUrl: c.sourceUrl, sourceSha256: "a".repeat(64), windowStartSeconds: 7, firstActionSourceSeconds: 7.4, reviewedThroughSourceSeconds: 8.75, onScreenText: "A playful seal", visualAction: "The seal turns toward and approaches the diver.", reviewMethod: "Eight source frames reviewed at quarter-second intervals.", reviewedBy: "Assistant sampled-frame editorial review" };
}

test("short cues use real word onsets and endings rather than spreading across total audio", () => {
  const result = build();
  assert.equal(result.status, "aligned");
  assert.equal(result.cues[0].start, 0.2);
  assert.equal(result.cues.at(-1).end, transcript().words.at(-1).end);
  assert.ok(result.cues.at(-1).end < 12);
  assert.equal(result.cues[0].hook, true);
  assert.ok(result.cues.length > 3);
  for (const cue of result.cues) {
    assert.ok(cue.words.length <= MAX_CAPTION_WORDS);
    assert.ok(cue.text.length <= MAX_CAPTION_CHARS);
    assert.ok(estimatedCaptionWidth(cue.text) <= 740);
    assert.equal(cue.start, cue.words[0].start);
    assert.equal(cue.end, cue.words.at(-1).end);
  }
});

test("the reviewed on-screen hook appears immediately while word highlights wait for real speech", () => {
  const heard = transcript();
  const result = buildSpeechAlignedCaptionCues({ script: SCRIPT, transcription: heard, durationSeconds: 12, openingHookText: "A playful seal" });
  assert.equal(result.status, "aligned");
  const hook = result.cues[0];
  assert.equal(hook.visualHook, true); assert.equal(hook.start, 0);
  assert.equal(hook.speechStart, heard.words[0].start); assert.equal(hook.words[0].start, heard.words[0].start);
  const ass = buildAssDocument(result.cues.map((c) => ({ ...c, position: "top" })));
  assert.match(ass, /Style: Hook,DejaVu Sans,76/);
  assert.match(ass, /Dialogue: 0,0:00:00\.00/);
  assert.match(ass, /Dialogue: 1,0:00:00\.20/);
  assert.doesNotMatch(ass, /Dialogue: 1,0:00:00\.00/);
  assert.equal(validateOpeningHookText(SCRIPT, "A random seal").valid, false);
  assert.equal(validateOpeningHookText(SCRIPT, "A playful seal sees the diver").valid, false);
});

test("a five-word reviewed hook wraps cleanly to two lines without duplicating its caption", () => {
  const script = "One puppy has the bed. Another puppy circles the cushion. Both puppies share the bed.";
  const result = buildSpeechAlignedCaptionCues({ script, transcription: transcript(script), durationSeconds: 12, openingHookText: "One puppy has the bed." });
  assert.equal(result.status, "aligned");
  assert.equal(result.cues[0].lineBreakAfter, 3);
  assert.equal(result.cues[0].words.length, 5);
  assert.equal(result.cues[1].start, transcript(script).words[5].start);
  const ass = buildAssDocument(result.cues);
  assert.ok(ass.includes("One puppy has\\Nthe bed."));
  assert.equal((ass.match(/Dialogue: 0,0:00:00\.00/g) ?? []).length, 1);
});

test("real cached Whisper timings of the published Chiitan narration align without fabricating proper-name timestamps", async () => {
  // A read-only transcript of archived output, not a new or edited upload.
  const recognized = JSON.parse(await readFile("test/fixtures/chiitan-whisper-base.json", "utf8"));
  const seeds = JSON.parse(await readFile("config/primeplug-candidates.json", "utf8"));
  const script = seeds.find((s) => s.id === "chiitan-mascot-fails").narrationScript;
  const result = build(recognized, script, 24.92);
  assert.equal(result.status, "aligned");
  assert.equal(result.metrics.plannedWords, 54);
  assert.equal(result.metrics.approximateWords, 2); // "Me"/"Meet" and "Chiton"/"Chiitan"
  assert.equal(result.cues.flatMap((c) => c.words)[1].start, recognized.words[1].start);
  assert.equal(result.cues.flatMap((c) => c.words)[1].text, "Chiitan,");
  assert.ok(result.cues.length >= 15);
});

test("a missing, shortened, reordered, inaccurate or malformed transcript fails closed", () => {
  assert.equal(build(null).status, "hold");
  assert.equal(build({ ...transcript(), droppedWordCount: 1 }).status, "hold");
  const shorter = transcript(); shorter.words.splice(4, 1); assert.match(build(shorter).reason, /word counts differ/);
  const extra = transcript(); extra.words.push({ word: "extra", start: 6.4, end: 6.5 }); assert.equal(build(extra).status, "hold");
  const wrong = transcript(); wrong.words[2].word = "spaceship"; assert.match(build(wrong).reason, /does not match/);
  const reversed = transcript(); [reversed.words[0], reversed.words[1]] = [reversed.words[1], reversed.words[0]]; assert.equal(build(reversed).status, "hold");
  const badTime = transcript(); badTime.words[2].start = 100; assert.match(build(badTime).reason, /timestamp/);
  const overlap = transcript(); overlap.words[1].start = 0.21; assert.match(build(overlap).reason, /timestamp/);
  const low = transcript(); low.words[2].probability = 0.01; assert.match(build(low).reason, /confidence/);
  const manyFuzzy = transcript(); for (let i = 0; i < 5; i++) manyFuzzy.words[i].word = manyFuzzy.words[i].word.replace(/[aeiou]/i, "x"); assert.equal(build(manyFuzzy).status, "hold");
});

test("negations, short words and numbers must match exactly rather than accepting semantic reversals", () => {
  const script = "The seal is not afraid. It never leaves the diver.";
  const negation = transcript(script); negation.words[3].word = "now";
  assert.match(build(negation, script).reason, /short, negative or numeric/);
  const never = transcript(script); never.words[6].word = "ever";
  assert.match(build(never, script).reason, /short, negative or numeric/);
  const numeric = transcript("The seal has two fins."); numeric.words[3].word = "too";
  assert.match(build(numeric, "The seal has two fins.").reason, /short, negative or numeric/);
});

test("a single phonetic error can keep planned spelling while retaining its real timestamp", () => {
  const heard = transcript(); heard.words[2].word = "seel";
  const result = build(heard);
  assert.equal(result.status, "aligned");
  const aligned = result.cues.flatMap((c) => c.words)[2];
  assert.equal(aligned.text, "seal"); assert.equal(aligned.recognitionMatch, "approximate");
  assert.equal(aligned.start, heard.words[2].start); assert.equal(aligned.end, heard.words[2].end);
});

test("caption bands choose away from the tracked motion peak without claiming subject-bound certainty", () => {
  const cues = [
    { text: "First cue", start: 0, end: 1, words: [] },
    { text: "Second cue", start: 2, end: 3, words: [] }
  ];
  const track = { samples: [
    { t: 0.5, peakX: 0.5, peakY: 0.25, prominence: 2 },
    { t: 2.5, peakX: 0.5, peakY: 0.69, prominence: 2 }
  ] };
  const framingPlan = { beats: [{ startSeconds: 0, seconds: 4, mode: "crop", widthFraction: 0.5 }] };
  const placed = placeCaptionCues(cues, { track, framingPlan, sourceWidth: 1080, sourceHeight: 1920 });
  assert.deepEqual(placed.cues.map((c) => c.position), ["lower", "top"]);
  assert.equal(placed.metrics.method, "motion_peak_heuristic_not_subject_bounds");
  assert.equal(placed.metrics.humanReviewRequired, true);
  assert.equal(placed.metrics.unmeasuredCues, 0);
  const missing = placeCaptionCues(cues, { track: { samples: [] }, framingPlan, sourceWidth: 1080, sourceHeight: 1920 });
  assert.equal(missing.metrics.unmeasuredCues, 2);
  assert.equal(missing.cues[0].placementEvidence, "unmeasured");
  assert.ok(CAPTION_X > 160 && CAPTION_X < 540 && CAPTION_Y.top >= 300 && CAPTION_Y.lower <= 1400);
});

test("ASS highlights words only at their measured times, escapes controls, and rolls centiseconds correctly", () => {
  const cues = [{ text: "Here it goes", start: 59.999, end: 60.6, hook: true, position: "lower", words: [
    { text: "Here", start: 59.999, end: 60.2 }, { text: "it", start: 60.3, end: 60.4 }, { text: "goes", start: 60.4, end: 60.6 }
  ] }];
  const ass = buildAssDocument(cues, { title: "test\n[Events]" });
  assert.match(ass, /Dialogue: 0,0:01:00\.00,0:01:00\.60,Hook/);
  assert.match(ass, /Dialogue: 1,0:01:00\.30,0:01:00\.40,Hook/);
  assert.match(ass, /\\pos\(490,1325\)/);
  assert.match(ass, /\\c&H00D8FF&/);
  assert.doesNotMatch(ass, /0:00:59\.100/);
  assert.doesNotMatch(ass, /Title: test\n\[Events\]/);
  const hostile = buildAssDocument([{ text: "{\\evil}text", start: 0, end: 1, position: "top", words: [] }]);
  assert.doesNotMatch(hostile, /\{\\evil\}/);
});

test("opening evidence must match the exact source and window, cover motion and place action in two seconds", () => {
  const c = seed();
  assert.equal(validateVisualHookReview(c).valid, false);
  const good = { ...c, visualHookReview: review(c) };
  assert.equal(validateVisualHookReview(good).valid, true);
  assert.equal(validateVisualHookReview({ ...good, window: { ...good.window, startSeconds: 8 } }).valid, false);
  assert.equal(validateVisualHookReview({ ...good, sourceUrl: "https://example.org/other" }).valid, false);
  assert.equal(validateVisualHookReview({ ...good, visualHookReview: { ...good.visualHookReview, sourceSha256: "bad" } }).valid, false);
  assert.equal(validateVisualHookReview({ ...good, visualHookReview: { ...good.visualHookReview, firstActionSourceSeconds: 9.1 } }).valid, false);
  assert.equal(validateVisualHookReview({ ...good, visualHookReview: { ...good.visualHookReview, reviewedThroughSourceSeconds: 7.2 } }).valid, false);
});

test("new hook evidence reopens only a hook-specific hold, not an unchanged timing or rights hold", () => {
  const previous = seed(), current = { ...previous, visualHookReview: review(previous) };
  const job = (outcome) => ({ status: "completed", candidate: { id: previous.id, sourceUrl: previous.sourceUrl, seedManifestEntry: previous }, result: { produced: false, outcome } });
  assert.deepEqual(narratedRequeueDecision(job("held_hook_unreviewed"), current), { requeue: true, reason: "opening_review_completed" });
  assert.deepEqual(narratedRequeueDecision(job("held_hook_source_changed"), current), { requeue: true, reason: "opening_review_completed" });
  assert.equal(narratedRequeueDecision(job("held_story_timing"), current).requeue, false);
  assert.equal(narratedRequeueDecision(job("held_source_overlay"), current).requeue, false);
  assert.equal(narratedRequeueDecision(job("held_hook_unreviewed"), { ...current, visualHookReview: { ...current.visualHookReview, sourceSha256: "bad" } }).requeue, false);
});

test("15–20 seconds is advisory and a seamless loop always requires review", () => {
  assert.equal(buildCreativeReviewChecklist(17).durationStatus, "within_target");
  assert.equal(buildCreativeReviewChecklist(14.4).durationStatus, "outside_target_review");
  assert.equal(buildCreativeReviewChecklist(25).durationStatus, "outside_target_review");
  assert.equal(buildCreativeReviewChecklist(0).durationStatus, "unavailable");
  assert.equal(buildCreativeReviewChecklist(17).loopStatus, "review_required");
  assert.match(buildCreativeReviewChecklist(17).analyticsReview, /24-48 hours/);
});

test("narration must always fit the actual footage and temporary transcription outages are classified narrowly", () => {
  assert.equal(validateNarrationWindowBounds({ window: { startSeconds: 7, seconds: 15 } }, 14.9, 22).valid, true);
  assert.equal(validateNarrationWindowBounds({ window: { startSeconds: 7, seconds: 15 } }, 16, 22).valid, false);
  assert.equal(validateNarrationWindowBounds({ window: { startSeconds: 7, seconds: 15 } }, 14, 20).valid, false);
  assert.equal(validateNarrationWindowBounds({ window: { startSeconds: 7, seconds: 15 } }, 14, 0).valid, false);
  assert.equal(isTransientProductionOutcome({ status: "held_caption_alignment_unavailable", reason: "network timed out" }), true);
  assert.equal(isTransientProductionOutcome({ status: "held_caption_alignment_unavailable", reason: "Python dependency missing" }), false);
  assert.equal(isTransientProductionOutcome({ status: "held_caption_alignment", reason: "network timed out" }), false);
});
