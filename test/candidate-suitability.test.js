import test from "node:test";
import assert from "node:assert/strict";
import { assessCandidateSuitability } from "../src/strategy/candidate-suitability.js";

test("blocks complete broadcasts and existing copyrighted entertainment uploads from shortlist", () => {
  for (const title of [
    "JUEGO COMPLETO: AMÉRICA vs TOLUCA",
    "LIVE NOW: breaking event",
    "Full Episode Season 2",
    "Official Music Video - Artist",
    "The Mentalist Fan Edit"
  ]) {
    assert.equal(assessCandidateSuitability({ title, sourceUrl: "https://youtube.com/watch?v=abc", platform: "youtube" }).eligible, false, title);
  }
});

test("allows original educational topics as research leads without implying media rights", () => {
  const result = assessCandidateSuitability({
    title: "Why octopuses change colour",
    sourceUrl: "https://youtube.com/watch?v=abc",
    platform: "youtube"
  });
  assert.equal(result.eligible, true);
  assert.match(result.policy, /does not grant rights/);
});

test("rejects records without a safe HTTPS reference", () => {
  const result = assessCandidateSuitability({ title: "Science facts", sourceUrl: "javascript:alert(1)", platform: "youtube" });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("missing_safe_reference_url"));
});
