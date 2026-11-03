import test from "node:test";
import assert from "node:assert/strict";
import { selectThumbnailTime } from "../src/production/thumbnail.js";

test("thumbnail frame comes from the strongest selected moment, not the opening slate", () => {
  const plan = { editDecisionList: [
    { sourceIn: 0, sourceOut: 3, score: 4.2 },
    { sourceIn: 30, sourceOut: 34, score: 8.7 },
    { sourceIn: 60, sourceOut: 63, score: 5.1 }
  ] };
  assert.equal(selectThumbnailTime(plan, 10), 5);
});

test("thumbnail frame remains within the rendered video", () => {
  const plan = { editDecisionList: [{ sourceIn: 0, sourceOut: 20, score: 9 }] };
  assert.equal(selectThumbnailTime(plan, 4), 3.85);
});

test("thumbnail selection safely falls back when there are no valid moments", () => {
  assert.equal(selectThumbnailTime({ editDecisionList: [] }, 8), 0);
  assert.equal(selectThumbnailTime({}, 8), 0);
});
