import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildTranscriptCandidates } from "../src/clips/transcript-candidates.js";
import { runAuthorizedReedit } from "../src/clips/authorized-reedit.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

test("authorized repurposing pipeline scores timed words and renders original source footage", { skip: !hasFfmpeg }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "automation-repurpose-e2e-"));
  try {
    const sourcePath = join(dir, "source.mp4");
    const outputPath = join(dir, "repurposed.mp4");
    const source = spawnSync("ffmpeg", [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", "testsrc=size=360x640:rate=24:duration=8",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=8",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", sourcePath
    ]);
    assert.equal(source.status, 0, source.stderr?.toString());

    const transcriptWords = [
      ["Wait", 0, 0.4], ["until", 0.4, 0.8], ["you", 0.8, 1.0],
      ["see", 1.0, 1.3], ["what", 1.3, 1.6], ["happens", 1.6, 2.2],
      ["next.", 2.2, 2.8],
      ["The", 4.0, 4.3], ["result", 4.3, 4.8], ["was", 4.8, 5.1],
      ["incredible!", 5.1, 6.2]
    ].map(([word, start, end]) => ({ word, start, end }));
    const candidates = buildTranscriptCandidates(transcriptWords, { minSeconds: 1.5 });
    assert.equal(candidates.length, 2);

    const result = await runAuthorizedReedit({
      sourceLocalPath: sourcePath,
      outputPath,
      source: {
        sourceUrl: "https://media.example/owned-source.mp4",
        title: "Synthetic authorised test footage",
        rightsStatus: "owned_by_user",
        allowedPlatforms: ["youtube_shorts"]
      },
      transcriptSegments: candidates,
      targetDurationSeconds: 15
    });
    assert.equal(result.status, "completed");
    assert.equal(result.rendered.videoCodec, "h264");
    assert.equal(result.rendered.audioCodec, "aac");
    assert.equal(result.rendered.width, 1080);
    assert.equal(result.rendered.height, 1920);
    assert.equal(result.rendered.sourceAudioPreserved, true);
    assert.equal(result.plan.rights.status, "approved");
    assert.ok(result.plan.editDecisionList.length >= 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
