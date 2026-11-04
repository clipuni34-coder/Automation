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
  const moments = buildTranscriptCandidates(words, { minSeconds: 1.5 });
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


test("ordinary so/because language is not misclassified as an editorial payoff", () => {
  const words = [
    { word: "I", start: 0, end: 0.2 },
    { word: "did", start: 0.2, end: 0.5 },
    { word: "that", start: 0.5, end: 0.8 },
    { word: "so", start: 0.8, end: 1.0 },
    { word: "we", start: 1.0, end: 1.2 },
    { word: "could", start: 1.2, end: 1.5 },
    { word: "finish.", start: 1.5, end: 2.1 },
    { word: "I", start: 3, end: 3.2 },
    { word: "stayed", start: 3.2, end: 3.6 },
    { word: "because", start: 3.6, end: 4.0 },
    { word: "it", start: 4.0, end: 4.2 },
    { word: "mattered.", start: 4.2, end: 4.9 },
    { word: "The", start: 6, end: 6.2 },
    { word: "result", start: 6.2, end: 6.6 },
    { word: "was", start: 6.6, end: 6.9 },
    { word: "unexpected.", start: 6.9, end: 7.8 }
  ];
  const moments = buildTranscriptCandidates(words, { minSeconds: 1.5 });
  assert.equal(moments.length, 3);
  assert.equal(moments[0].signals.payoff, 1);
  assert.equal(moments[1].signals.payoff, 1);
  assert.equal(moments[2].signals.payoff, 7);
});


test("explanatory that's why language is not scored as a curiosity hook", () => {
  const words = [
    { word: "That's", start: 0, end: 0.3 },
    { word: "why", start: 0.3, end: 0.6 },
    { word: "these", start: 0.6, end: 0.9 },
    { word: "children", start: 0.9, end: 1.3 },
    { word: "are", start: 1.3, end: 1.5 },
    { word: "practicing.", start: 1.5, end: 2.2 }
  ];
  const [candidate] = buildTranscriptCandidates(words);
  assert.equal(candidate.signals.hook, 2);
  assert.equal(candidate.signals.curiosity, 0);
});


test("short adjacent sentences merge until they form a usable timed moment", () => {
  const words = [
    { word: "Eagle.", start: 0, end: 0.3 },
    { word: "Tranquility.", start: 0.5, end: 1.0 },
    { word: "We", start: 1.2, end: 1.4 },
    { word: "copy", start: 1.4, end: 1.6 },
    { word: "you", start: 1.6, end: 1.8 },
    { word: "on", start: 1.8, end: 2.0 },
    { word: "the", start: 2.0, end: 2.2 },
    { word: "ground.", start: 2.2, end: 2.5 },
    { word: "You", start: 2.7, end: 2.9 },
    { word: "got", start: 2.9, end: 3.1 },
    { word: "a", start: 3.1, end: 3.2 },
    { word: "bunch", start: 3.2, end: 3.5 },
    { word: "of", start: 3.5, end: 3.6 },
    { word: "guys", start: 3.6, end: 3.9 },
    { word: "about", start: 3.9, end: 4.1 },
    { word: "to", start: 4.1, end: 4.2 },
    { word: "turn", start: 4.2, end: 4.4 },
    { word: "blue.", start: 4.4, end: 4.8 }
  ];
  const moments = buildTranscriptCandidates(words, { minSeconds: 2, maxPauseSeconds: 1.5 });
  assert.equal(moments.length, 2);
  assert.equal(moments[0].text, "Eagle. Tranquility. We copy you on the ground.");
  assert.equal(moments[0].start, 0);
  assert.equal(moments[0].end, 2.5);
  assert.equal(moments[1].text, "You got a bunch of guys about to turn blue.");
  assert.equal(moments[1].start, 2.7);
  assert.equal(moments[1].end, 4.8);
});

test("short sentence fragments separated by a long silence are not merged", () => {
  const words = [
    { word: "Eagle.", start: 0, end: 0.3 },
    { word: "We", start: 4, end: 4.2 },
    { word: "copy", start: 4.2, end: 4.4 },
    { word: "you", start: 4.4, end: 4.6 },
    { word: "on", start: 4.6, end: 4.8 },
    { word: "the", start: 4.8, end: 5.0 },
    { word: "ground.", start: 5.0, end: 5.3 },
    { word: "You", start: 5.5, end: 5.7 },
    { word: "got", start: 5.7, end: 5.9 },
    { word: "there.", start: 5.9, end: 6.3 }
  ];
  const moments = buildTranscriptCandidates(words, { minSeconds: 2, maxPauseSeconds: 1.5 });
  assert.equal(moments.length, 1);
  assert.equal(moments[0].text, "We copy you on the ground. You got there.");
  assert.equal(moments[0].start, 4);
});


test("does not discard a short payoff when the next word crosses the minimum-duration boundary", () => {
  const words = [
    { word: "Tranquility.", start: 0, end: 0.44 },
    { word: "We", start: 0.74, end: 0.9 },
    { word: "copy", start: 0.9, end: 1.05 },
    { word: "you", start: 1.05, end: 1.2 },
    { word: "on", start: 1.2, end: 1.3 },
    { word: "the", start: 1.3, end: 1.4 },
    { word: "ground.", start: 1.4, end: 1.76 },
    { word: "You", start: 2.06, end: 2.2 },
    { word: "got", start: 2.2, end: 2.4 },
    { word: "there.", start: 2.4, end: 2.7 }
  ];
  const moments = buildTranscriptCandidates(words, { minSeconds: 2 });
  assert.equal(moments.length, 1);
  assert.equal(moments[0].text, "Tranquility. We copy you on the ground. You got there.");
  assert.equal(moments[0].start, 0);
  assert.equal(moments[0].end, 2.7);
});


test("scores explicit landing confirmation and relief as outcome and emotion signals", () => {
  const words = [
    { word: "We", start: 0, end: 0.2 },
    { word: "copy", start: 0.2, end: 0.5 },
    { word: "you", start: 0.5, end: 0.7 },
    { word: "on", start: 0.7, end: 0.9 },
    { word: "the", start: 0.9, end: 1.1 },
    { word: "ground.", start: 1.1, end: 2.4 },
    { word: "We're", start: 2.7, end: 3.0 },
    { word: "breathing", start: 3.0, end: 3.5 },
    { word: "again.", start: 3.5, end: 5.0 }
  ];
  const moments = buildTranscriptCandidates(words, { minSeconds: 2 });
  assert.equal(moments.length, 2);
  assert.ok(moments[0].signals.payoff >= 7);
  assert.ok(moments[1].signals.payoff >= 7);
  assert.ok(moments[1].signals.emotion >= 7);
  assert.match(moments[0].text, /on the ground/);
  assert.match(moments[1].text, /breathing again/);
});
