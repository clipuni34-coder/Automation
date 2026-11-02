import test from "node:test";
import assert from "node:assert/strict";
import { buildTranscriptCandidates } from "../src/clips/transcript-candidates.js";

test("word timestamps become chronological moments with visible heuristic scores", () => {
  const words = [
    { word: "Wait", start: 0, end: 0.4 },
    { word: "until", start: 0.4, end: 0.8 },
    { word: "you", start: 0.8, end: 1.0 },
    { word: "see", start: 1.0, end: 1.3 },
    { word: "what", start: 1.3, end: 1.6 },
    { word: "happens", start: 1.6, end: 2.2 },
    { word: "next.", start: 2.2, end: 2.8 },
    { word: "The", start: 3.0, end: 3.2 },
    { word: "result", start: 3.2, end: 3.6 },
    { word: "was", start: 3.6, end: 3.8 },
    { word: "incredible!", start: 3.8, end: 4.8 }
  ];
  const moments = buildTranscriptCandidates(words);
  assert.equal(moments.length, 2);
  assert.equal(moments[0].text, "Wait until you see what happens next.");
  assert.equal(moments[0].start, 0);
  assert.equal(moments[0].end, 2.8);
  assert.ok(moments[0].signals.hook >= 6);
  assert.ok(moments[1].signals.emotion >= 7);
  assert.equal(moments[0].scoringMethod, "local_lexical_heuristic");
  assert.equal(moments[0].words.length, 7);
});

test("candidate builder rejects invalid and out-of-order word timings", () => {
  assert.throws(() => buildTranscriptCandidates([]), /non-empty/);
  assert.throws(() => buildTranscriptCandidates([{ word: "bad", start: 2, end: 1 }]), /invalid/);
  assert.throws(() => buildTranscriptCandidates([
    { word: "later", start: 2, end: 2.5 },
    { word: "earlier", start: 1, end: 1.5 }
  ]), /chronological/);
});

test("candidate builder does not silently create sub-minimum fragments", () => {
  assert.throws(() => buildTranscriptCandidates([
    { word: "Too", start: 0, end: 0.2 },
    { word: "short.", start: 0.2, end: 0.5 }
  ]), /minimum duration/);
});

test("long passages are split into bounded candidate windows", () => {
  const words = Array.from({ length: 30 }, (_, index) => ({
    word: "word" + index, start: index, end: index + 0.5
  }));
  const moments = buildTranscriptCandidates(words, { maxSeconds: 6, maxWords: 8 });
  assert.ok(moments.length >= 4);
  assert.ok(moments.every(moment => moment.end - moment.start <= 7));
});
