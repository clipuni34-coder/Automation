import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFeed } from "../src/discovery/sources/rss.js";
import { scoreCandidate, topicKey } from "../src/discovery/scoring.js";
import { runDiscovery } from "../src/discovery/engine.js";
import { readDiscoveryStore } from "../src/discovery/store.js";

test("RSS parser extracts RSS and Atom entries without losing links", () => {
  const rss = `<rss><channel><item><title><![CDATA[New science story]]></title><link>https://example.com/story</link><description>Useful &amp; clear</description><pubDate>Sat, 31 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>`;
  const items = parseFeed(rss, "https://example.com/feed.xml");
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "New science story");
  assert.equal(items[0].sourceUrl, "https://example.com/story");
  assert.equal(items[0].description, "Useful & clear");
});

test("topic keys normalize equivalent title word order", () => {
  assert.equal(topicKey("Brain: False Memories!"), topicKey("False memories — brain"));
});

test("first observation is explicitly low-confidence; repeated observation measures velocity", () => {
  const candidate = {
    id: "youtube:abc",
    observedAt: "2026-11-01T01:00:00.000Z",
    publishedAt: "2026-10-31T20:00:00.000Z",
    title: "Test",
    sourceUrl: "https://youtube.com/watch?v=abc",
    creator: "Channel",
    metrics: { views: 1000, likes: 50, comments: 10 }
  };
  const first = scoreCandidate(candidate, []);
  assert.equal(first.confidence, "low");
  assert.equal(first.evidence.velocityMeasured, false);
  const prior = { id: candidate.id, observedAt: "2026-11-01T00:00:00.000Z", metrics: { views: 500 } };
  const second = scoreCandidate(candidate, [prior]);
  assert.equal(second.evidence.viewsPerHour, 500);
  assert.equal(second.evidence.velocityMeasured, true);
});


test("flags a breakout candidate only after measured acceleration across three observations", () => {
  const candidate = {
    id: "youtube:breakout",
    observedAt: "2026-11-01T03:00:00.000Z",
    publishedAt: "2026-11-01T00:00:00.000Z",
    title: "A fast-growing story",
    sourceUrl: "https://youtube.com/watch?v=breakout",
    creator: "Rising creator",
    metrics: { views: 1500, likes: 90, comments: 20 }
  };
  const history = [
    { id: candidate.id, observedAt: "2026-11-01T00:00:00.000Z", metrics: { views: 1000 } },
    { id: candidate.id, observedAt: "2026-11-01T02:00:00.000Z", metrics: { views: 1200 } }
  ];
  const result = scoreCandidate(candidate, history);
  assert.equal(result.confidence, "high");
  assert.equal(result.evidence.viewsPerHour, 300);
  assert.equal(result.evidence.previousViewsPerHour, 100);
  assert.equal(result.evidence.accelerationRatio, 3);
  assert.equal(result.evidence.breakoutSignal, true);
});

test("does not claim a breakout from a single prior observation", () => {
  const candidate = {
    id: "youtube:unverified",
    observedAt: "2026-11-01T03:00:00.000Z",
    publishedAt: "2026-11-01T00:00:00.000Z",
    title: "Unverified growth",
    sourceUrl: "https://youtube.com/watch?v=unverified",
    creator: "Creator",
    metrics: { views: 5000, likes: 200, comments: 20 }
  };
  const history = [
    { id: candidate.id, observedAt: "2026-11-01T02:00:00.000Z", metrics: { views: 1000 } }
  ];
  const result = scoreCandidate(candidate, history);
  assert.equal(result.confidence, "medium");
  assert.equal(result.evidence.breakoutSignal, false);
});

test("discovery stores candidates, observations and source status", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "discovery-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const storePath = join(directory, "discovery.json");
  const now = () => new Date("2026-11-01T01:00:00.000Z");
  const result = await runDiscovery({
    storePath,
    now,
    collectors: {
      youtube: async () => ({ source: "youtube", status: "ok", items: [{
        id: "youtube:1", platform: "youtube", sourceUrl: "https://youtube.com/watch?v=1",
        title: "A new science discovery", creator: "Example", publishedAt: "2026-10-31T23:00:00Z",
        observedAt: "2026-11-01T01:00:00Z", metrics: { views: 100, likes: 5, comments: 1 }
      }] }),
      rss: async () => ({ source: "rss", status: "not_configured", items: [] })
    }
  });
  assert.equal(result.candidates.length, 1);
  const saved = await readDiscoveryStore(storePath);
  assert.equal(saved.candidates[0].id, "youtube:1");
  assert.equal(saved.observations.length, 1);
  assert.equal(saved.runs.length, 1);
});
