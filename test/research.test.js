import test from "node:test";
import assert from "node:assert/strict";
import { searchTopic } from "../src/research/tavily.js";
import { buildResearchDossier } from "../src/research/dossier.js";

test("research search fails closed when no API key is configured", async () => {
  const result = await searchTopic({ query: "ocean science", apiKey: "" });
  assert.equal(result.status, "not_configured");
  assert.deepEqual(result.results, []);
});

test("research search normalizes results and rejects unsafe/non-URL links", async () => {
  const fetchImpl = async (_url, options) => {
    assert.equal(options.method, "POST");
    return { ok: true, json: async () => ({ results: [
      { title: "Good source", url: "https://example.org/story", content: "Evidence excerpt", score: 0.9 },
      { title: "Bad scheme", url: "javascript:alert(1)", content: "bad" },
      { title: "Malformed", url: "not a url" }
    ] }) };
  };
  const result = await searchTopic({ query: "ocean science", apiKey: "test-key", fetchImpl });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].url, "https://example.org/story");
});

test("dossier preserves source provenance and never labels search excerpts verified", async () => {
  const dossier = await buildResearchDossier({
    topic: "Why octopuses change colour",
    reference: { id: "youtube:1", title: "Octopus video", sourceUrl: "https://youtube.com/watch?v=1" },
    search: async () => ({ status: "ok", results: [
      { title: "Research paper", url: "https://example.org/paper", content: "Abstract excerpt", publishedAt: "2025-01-01", score: 0.8 }
    ] })
  });
  assert.equal(dossier.evidence[0].verification, "unverified_search_excerpt");
  assert.equal(dossier.reference.id, "youtube:1");
  assert.equal(dossier.editorial.status, "awaiting_editorial_reasoning");
  assert.ok(dossier.safeguards.some((item) => item.includes("Verify every factual claim")));
});
