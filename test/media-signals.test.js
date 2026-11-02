import test from "node:test";
import assert from "node:assert/strict";
import { parseSceneChanges, parseSilenceIntervals, summarizeMomentSignals } from "../src/clips/media-signals.js";

test("scene-change parser extracts strictly increasing frame timestamps", () => {
  const log = "[Parsed_showinfo] n: 1 pts_time:1.250 fmt:yuv420p\n[Parsed_showinfo] n: 2 pts_time:3.5 fmt:yuv420p\n";
  assert.deepEqual(parseSceneChanges(log), [1.25, 3.5]);
});

test("silence parser pairs intervals and closes trailing silence at media duration", () => {
  const log = "silence_start: 1.2\nsilence_end: 2.5 | silence_duration: 1.3\nsilence_start: 4.0\n";
  assert.deepEqual(parseSilenceIntervals(log, 6), [{ start: 1.2, end: 2.5 }, { start: 4, end: 6 }]);
});

test("moment signals measure scene activity and penalize silence overlap", () => {
  const signals = summarizeMomentSignals({ start: 2, end: 8 }, {
    sceneChanges: [1, 3, 5, 9],
    silenceIntervals: [{ start: 4, end: 5 }]
  });
  assert.equal(signals.sceneChangeCount, 2);
  assert.equal(signals.visualActivity, 6);
  assert.equal(signals.silenceRatio, 0.167);
  assert.equal(signals.speechContinuity, 8.33);
});

test("moment signal analysis rejects invalid time windows", () => {
  assert.throws(() => summarizeMomentSignals({ start: 4, end: 4 }, {}), /valid start and end/);
});
