import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assessContentDistinctness, hasPublishedFingerprint, readContentHistory, recordPublishedContent } from "../src/strategy/content-history.js";

test("distinguishes original scripts from near-duplicate recent uploads", () => {
  const first = assessContentDistinctness("A strange animal discovers a hidden tunnel beneath the city.");
  assert.equal(first.distinct, true);
  const similar = assessContentDistinctness("A strange animal discovers a hidden tunnel beneath the city today.", [{ scriptTokens: first.scriptTokens, fingerprint: first.fingerprint }]);
  assert.equal(similar.distinct, false);
  assert.equal(similar.reason, "too_similar_to_recent_upload");
  const different = assessContentDistinctness("Five clever cooking tricks make crispy potatoes with no oil.", [{ scriptTokens: first.scriptTokens, fingerprint: first.fingerprint }]);
  assert.equal(different.distinct, true);
});

test("records successful uploads per channel without duplicating video IDs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "channel-content-history-"));
  const path = join(dir, "history.json");
  try {
    await recordPublishedContent(path, { channelId: "UC1", videoId: "video1", fingerprint: "hash1", scriptTokens: ["one","two"] });
    await recordPublishedContent(path, { channelId: "UC1", videoId: "video1", fingerprint: "hash1", scriptTokens: ["one","two"] });
    await recordPublishedContent(path, { channelId: "UC2", videoId: "video1", fingerprint: "hash2", scriptTokens: ["three"] });
    const history = await readContentHistory(path);
    assert.equal(history.uploads.length, 2);
    assert.deepEqual([...new Set(history.uploads.map(item => item.channelId))].sort(), ["UC1", "UC2"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("detects fingerprints already published to a specific channel", () => {
  const history = { uploads: [{ channelId: "UC1", fingerprint: "hash1" }] };
  assert.equal(hasPublishedFingerprint(history, "UC1", "hash1"), true);
  assert.equal(hasPublishedFingerprint(history, "UC2", "hash1"), false);
  assert.equal(hasPublishedFingerprint(history, "UC1", "hash2"), false);
});
