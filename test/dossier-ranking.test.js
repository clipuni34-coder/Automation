import test from "node:test";
import assert from "node:assert/strict";
import { rankResearchDossiers } from "../src/creative/dossier-ranking.js";

test("ranks dossiers by discovery opportunity and evidence completeness", () => {
  const result = rankResearchDossiers([
    { path: "research-low.json", topic: "Lower score", evidence: [{}, {}] },
    { path: "research-high.json", topic: "Highest score", candidateId: "high", evidence: [{ extractedContent: "verified passage" }] }
  ], { candidates: [
    { id: "high", title: "Highest score", score: 90 },
    { title: "Lower score", score: 40 }
  ] });
  assert.equal(result[0].path, "research-high.json");
  assert.equal(result[0].opportunityScore, 90);
});

test("uses deterministic filename ordering when evidence scores tie", () => {
  const result = rankResearchDossiers([
    { path: "research-z.json", topic: "Same", evidence: [] },
    { path: "research-a.json", topic: "Same", evidence: [] }
  ], { candidates: [] });
  assert.equal(result[0].path, "research-a.json");
});
