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
      ["Why", 0, 0.4], ["does", 0.4, 0.8], ["this", 0.8, 1.2], ["happen?", 1.2, 2.4],
      ["Here", 3, 3.4], ["is", 3.4, 3.7], ["the", 3.7, 4], ["answer.", 4, 5.4]
    ].map(([word, start, end]) => ({ word, start, end }));
    await writeFile(inputPath, JSON.stringify({
      sourceLocalPath: sourcePath,
      outputPath,
      source: {
        sourceUrl: "https://media.example/owned-source.mp4",
        title: "Original source title",
        creator: "Original creator",
        rightsStatus: "owned_by_user",
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
    assert.equal(result.postingPackage.status, "draft");
    assert.equal(result.postingPackage.manualPublishingApprovalRequired, true);
    assert.ok(result.postingPackage.platformPackages.youtube_shorts.title);
    assert.ok(result.postingPackage.platformPackages.youtube_shorts.description);
    assert.equal(result.postingPackage.platformPackages.tiktok, undefined);
    assert.ok(result.postingPackage.thumbnailPath);
    await stat(outputPath);
    await stat(result.postingPackage.thumbnailPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
