import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadChannels } from "../src/config/channels.js";
import { loadNicheRegistry, resolveChannelNiche } from "../src/engine/niches.js";
import { screenCandidate } from "../src/engine/scheduler.js";

test("Primeplug is the only active channel and loads the funny real-world niche", async () => {
  const channels = await loadChannels("config/channels.json");
  const registry = await loadNicheRegistry("config/niches.json");
  const active = channels.filter((c) => c.operation?.enabled === true && c.operation?.paused !== true);
  assert.equal(active.length, 1);
  assert.equal(active[0].id, "Primeplug");
  assert.equal(active[0].youtubeChannelId, "UCB7EhjM0bj2wtIBy_A_kkkg");
  assert.equal(active[0].operation.publishingMode, "private_only");
  const niche = resolveChannelNiche(active[0], registry);
  assert.equal(niche.id, "funny-moments");
  assert.match(niche.label, /Funny, Surprising/);
  for (const other of channels.filter((c) => c.id !== "Primeplug")) {
    assert.equal(other.operation.enabled, false);
    assert.equal(other.operation.paused, true);
    assert.equal(other.operation.publishingMode, "disabled");
  }
});

test("Primeplug seed candidates are rights-licensed, HTTPS and pass screening", async () => {
  const seeds = JSON.parse(await readFile("config/primeplug-candidates.json", "utf8"));
  assert.ok(seeds.length >= 3);
  for (const seed of seeds) {
    assert.ok(seed.sourceUrl.startsWith("https://upload.wikimedia.org/"), seed.id);
    const screen = screenCandidate({ sourceUrl: seed.sourceUrl, creator: seed.creator, rightsEvidenceUrl: seed.rightsEvidenceUrl, license: seed.license });
    assert.equal(screen.eligible, true, `${seed.id}: ${screen.reasons.join("; ")}`);
  }
  // Research references must never pass.
  assert.equal(screenCandidate({ sourceUrl: "https://www.youtube.com/watch?v=x", creator: "someone", researchOnly: true }).eligible, false);
});
