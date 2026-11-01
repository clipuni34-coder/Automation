import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDiscoveryDossiers, writeDiscoveryDossiers } from "../src/research/discovery-dossiers.js";

test("builds cautious dossiers from high-scoring public discovery candidates", () => {
  const result = buildDiscoveryDossiers({ candidates: [
    { id: "youtube:1", title: "Trending gaming challenge", sourceUrl: "https://youtube.com/watch?v=1", platform: "youtube", score: 80, description: "A public video reference", rightsStatus: "reference_only" },
    { id: "rss:2", title: "Low score trend", sourceUrl: "https://example.org/trend", platform: "rss", score: 10 }
  ] }, { generatedAt: "2026-11-01T12:00:00.000Z" });
  assert.equal(result.length, 1);
  assert.equal(result[0].researchStatus, "discovery_metadata_only");
  assert.equal(result[0].evidence[0].verification, "unverified_search_result");
  assert.equal(result[0].evidence[0].rightsStatus, "reference_only");
  assert.match(result[0].summary, /not independently fact-checked/);
});

test("deduplicates topics and writes safe, deterministic dossier filenames", async () => {
  const dir = await mkdtemp(join(tmpdir(), "discovery-dossiers-"));
  try {
    const dossiers = buildDiscoveryDossiers({ candidates: [
      { id: "one", title: "Same viral topic", topicKey: "same", sourceUrl: "https://example.org/1", score: 60 },
      { id: "two", title: "Same viral topic rephrased", topicKey: "same", sourceUrl: "https://example.org/2", score: 55 }
    ] });
    assert.equal(dossiers.length, 1);
    const files = await writeDiscoveryDossiers(dossiers, dir);
    assert.equal(files.length, 1);
    const saved = JSON.parse(await readFile(files[0], "utf8"));
    assert.equal(saved.candidateId, "one");
    assert.match(files[0], /research-same-viral-topic-[a-f0-9]{8}\.json$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
