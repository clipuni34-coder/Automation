import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runEndToEnd } from "../src/pipeline/e2e.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const WORDS = [
  ["Why", 0, 0.3], ["did", 0.3, 0.6], ["this", 0.6, 0.9], ["happen?", 0.9, 1.5],
  ["This", 1.5, 1.8], ["is", 1.8, 2.0], ["incredible!", 2.0, 2.8],
  ["Why", 4.0, 4.3], ["is", 4.3, 4.5], ["the", 4.5, 4.7], ["result", 4.7, 5.0],
  ["so", 5.0, 5.2], ["incredible?", 5.2, 5.7], ["The", 5.7, 5.9], ["result", 5.9, 6.1], ["was", 6.1, 6.3], ["incredible!", 6.3, 6.8]
].map(([word, start, end]) => ({ word, start, end }));

async function makeSource(dir) {
  const sourcePath = join(dir, "source.mp4");
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=24:duration=8",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=8", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", sourcePath]);
  assert.equal(r.status, 0, r.stderr?.toString());
  return sourcePath;
}
const baseSource = { sourceUrl: "https://media.example/owned.mp4", title: "Fixture", durationSeconds: 8, rightsStatus: "owned_by_user", rightsEvidenceReference: "fixture-record", allowedPlatforms: ["youtube_shorts"] };

test("e2e: rights-cleared strong footage completes all stages, upload blocked without approval", { skip: !hasFfmpeg }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "e2e-"));
  try {
    const result = await runEndToEnd({ sourceLocalPath: await makeSource(dir), outputPath: join(dir, "short.mp4"), source: baseSource, transcriptWords: WORDS, targetDurationSeconds: 15 }, { env: {} });
    assert.equal(result.status, "completed");
    assert.deepEqual(result.stages.map((s) => s.name), ["rights_gate", "transcription", "clip_selection_and_render", "quality_control", "posting_package", "youtube_upload_private"]);
    assert.ok(["passed", "passed_after_repair"].includes(result.stages[3].status));
    assert.equal(result.rendered.probe.width, 1080);
    assert.equal(result.rendered.probe.height, 1920);
    assert.equal(result.postingPackage.manualPublishingApprovalRequired, true);
    assert.equal(result.upload.status, "blocked");
    assert.ok(result.upload.reasons.some((r) => /Human approval/.test(r)));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("e2e: footage without rights evidence is rejected before rendering", async () => {
  const result = await runEndToEnd({ sourceLocalPath: "/nonexistent.mp4", outputPath: "/tmp/x.mp4", source: { ...baseSource, rightsStatus: "unknown", rightsEvidenceReference: "" }, transcriptWords: WORDS }, { env: {} });
  assert.equal(result.status, "rejected_rights");
  assert.equal(result.stages.length, 1);
  assert.equal(result.upload.status, "not_attempted");
});

test("e2e: weak footage is held, not rendered or packaged", { skip: !hasFfmpeg }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "e2e-weak-"));
  try {
    const weak = [["um", 0, 0.4], ["stuff", 0.4, 0.9], ["happened", 0.9, 1.6], ["somewhere.", 1.6, 2.4], ["more", 3, 3.4], ["things", 3.4, 3.9], ["occurred", 3.9, 4.6], ["then.", 4.6, 5.2]].map(([word, start, end]) => ({ word, start, end }));
    const result = await runEndToEnd({ sourceLocalPath: await makeSource(dir), outputPath: join(dir, "short.mp4"), source: baseSource, transcriptWords: weak, targetDurationSeconds: 15 }, { env: {} });
    assert.equal(result.status, "held_weak_footage");
    assert.equal(result.postingPackage, null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("e2e: private upload runs only with approval + credentials + uploader, and must confirm private", { skip: !hasFfmpeg }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "e2e-up-"));
  try {
    const env = { YOUTUBE_CLIENT_ID: "id", YOUTUBE_REFRESH_TOKEN: "rt", YOUTUBE_EXPECTED_CHANNEL_ID: "UC1" };
    let called = 0;
    const result = await runEndToEnd(
      { sourceLocalPath: await makeSource(dir), outputPath: join(dir, "short.mp4"), source: baseSource, transcriptWords: WORDS, targetDurationSeconds: 15, uploadRequested: true, humanApproved: true },
      { env, uploader: async () => { called++; return { videoId: "abc123", privacyStatus: "private", watchUrl: "https://www.youtube.com/watch?v=abc123" }; } });
    assert.equal(called, 1);
    assert.equal(result.upload.status, "uploaded_private");
    assert.equal(result.upload.videoId, "abc123");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
