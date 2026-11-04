import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

test("repurpose CLI produces an MP4, thumbnail, transcript evidence and posting package", { skip: !hasFfmpeg }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "repurpose-cli-e2e-"));
  try {
    const sourcePath = join(dir, "source.mp4");
    const outputPath = join(dir, "short.mp4");
    const inputPath = join(dir, "request.json");
    const resultPath = join(dir, "result.json");
    const media = spawnSync("ffmpeg", [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", "testsrc=size=360x640:rate=24:duration=8",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=8",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", sourcePath
    ]);
    assert.equal(media.status, 0, media.stderr?.toString());
    const transcriptWords = [
      ["Why", 0, 0.4], ["did", 0.4, 0.8], ["this", 0.8, 1.2], ["happen?", 1.2, 2.0], ["This", 2.0, 2.2], ["is", 2.2, 2.4], ["incredible!", 2.4, 2.8],
      ["Why", 3, 3.2], ["is", 3.2, 3.4], ["the", 3.4, 3.6], ["result", 3.6, 4], ["so", 4, 4.2], ["incredible?", 4.2, 4.7], ["The", 4.7, 4.9], ["result", 4.9, 5.1], ["was", 5.1, 5.3], ["incredible!", 5.3, 5.8]
    ].map(([word, start, end]) => ({ word, start, end }));
    await writeFile(inputPath, JSON.stringify({
      sourceLocalPath: sourcePath,
      outputPath,
      source: {
        sourceUrl: "https://media.example/owned-source.mp4",
        title: "Original source title",
        creator: "Original creator",
        rightsStatus: "owned_by_user",
        rightsEvidenceReference: "test-fixture-owned-source-record",
        allowedPlatforms: ["youtube_shorts"]
      },
      transcriptWords,
      mediaAnalysis: false,
      targetDurationSeconds: 30,
      platform: "youtube_shorts"
    }));
    const run = spawnSync(process.execPath, ["src/clips/repurpose-cli.js", inputPath, resultPath], { encoding: "utf8", timeout: 180_000 });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    assert.equal(result.status, "completed");
    assert.equal(result.rendered.videoCodec, "h264");
    assert.equal(result.rendered.width, 1080);
    assert.equal(result.rendered.height, 1920);
    assert.equal(result.postingPackage.status, "editorial_review_required");
    assert.equal(result.postingPackage.editorialApproval.status, "review_required");
    assert.equal(result.postingPackage.editorialApproval.approved, false);
    assert.equal(result.editorialApproval.status, "review_required");
    assert.equal(result.postingPackage.manualPublishingApprovalRequired, true);
    assert.ok(result.postingPackage.platformPackages.youtube_shorts.title);
    assert.ok(result.postingPackage.platformPackages.youtube_shorts.description);
    assert.equal(result.postingPackage.platformPackages.tiktok, undefined);
    assert.ok(result.postingPackage.thumbnailPath);
    assert.ok(result.thumbnailPath);
    assert.ok(Number.isFinite(result.thumbnailTimeSeconds));
    assert.ok(result.thumbnailTimeSeconds >= 0 && result.thumbnailTimeSeconds <= result.rendered.durationSeconds);
    await stat(outputPath);
    await stat(result.postingPackage.thumbnailPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
