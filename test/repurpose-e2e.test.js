import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildTranscriptCandidates } from "../src/clips/transcript-candidates.js";
import { analyzeMediaSignals } from "../src/clips/media-signals.js";
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
      ["Why", 0, 0.3], ["did", 0.3, 0.6], ["this", 0.6, 0.9], ["happen?", 0.9, 1.5],
      ["This", 1.5, 1.8], ["is", 1.8, 2.0], ["incredible!", 2.0, 2.8],
      ["Why", 4.0, 4.3], ["is", 4.3, 4.5], ["the", 4.5, 4.7], ["result", 4.7, 5.0],
      ["so", 5.0, 5.2], ["incredible?", 5.2, 5.7], ["The", 5.7, 5.9], ["result", 5.9, 6.1], ["was", 6.1, 6.3], ["incredible!", 6.3, 6.8]
    ].map(([word, start, end]) => ({ word, start, end }));
    const mediaSignals = analyzeMediaSignals(sourcePath, { durationSeconds: 8 });
    assert.equal(mediaSignals.engine, "ffmpeg");
    assert.equal(mediaSignals.audioPresent, true);
    assert.ok(Array.isArray(mediaSignals.sceneChanges));
    const candidates = buildTranscriptCandidates(transcriptWords, { minSeconds: 1.5, mediaSignals });
    assert.ok(candidates.every((candidate) => Number.isFinite(candidate.signals.visualActivity)));
    assert.equal(candidates.length, 2);

    const result = await runAuthorizedReedit({
      sourceLocalPath: sourcePath,
      outputPath,
      source: {
        sourceUrl: "https://media.example/owned-source.mp4",
        title: "Synthetic authorised test footage",
        durationSeconds: 8,
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
    assert.equal(result.plan.rights.status, "declared_not_independently_verified");
    assert.equal(result.plan.rights.verificationStatus, "declaration_only");
    assert.ok(result.plan.editDecisionList.length >= 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
