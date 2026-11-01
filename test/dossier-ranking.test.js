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

test("prefers independent, substantive research over social and reference-only snippets", () => {
  const result = rankResearchDossiers([
    {
      path: "thin.json", topic: "Thin", candidateId: "thin",
      evidence: [
        { url: "https://www.youtube.com/watch?v=abc", sourceExcerpt: "short" },
        { url: "https://www.instagram.com/example", sourceExcerpt: "short" },
        { url: "https://www.reddit.com/r/example", sourceExcerpt: "short" }
      ]
    },
    {
      path: "broad.json", topic: "Broad", candidateId: "broad",
      evidence: [
        { url: "https://www.nature.com/articles/example", sourceExcerpt: "A".repeat(700), searchRelevance: 0.8 },
        { url: "https://www.bbc.com/news/example", sourceExcerpt: "B".repeat(700), searchRelevance: 0.9 },
        { url: "https://www.gov.uk/report", sourceExcerpt: "C".repeat(700), searchRelevance: 0.7 }
      ]
    }
  ], { candidates: [
    { id: "thin", score: 80 },
    { id: "broad", score: 75 }
  ] });
  assert.equal(result[0].path, "broad.json");
  assert.equal(result[0].independentPublisherCount, 3);
  assert.equal(result[0].substantiveSourceCount, 3);
  assert.match(result[0].rankingCaveat, /not independently verified/);
});

test("uses deterministic filename ordering when evidence scores tie", () => {
  const result = rankResearchDossiers([
    { path: "research-z.json", topic: "Same", evidence: [] },
    { path: "research-a.json", topic: "Same", evidence: [] }
  ], { candidates: [] });
  assert.equal(result[0].path, "research-a.json");
});
