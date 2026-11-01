import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

test("ranked rights-cleared clips compile to a real vertical MP4 without paid narration", { skip: !hasFfmpeg }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "authorized-compilation-e2e-"));
  try {
    const mediaAssets = {};
    const clips = [];
    for (let index = 0; index < 2; index++) {
      const sourceId = "creator-" + index;
      const path = join(dir, sourceId + ".mp4");
      const made = spawnSync("ffmpeg", ["-y", "-v", "error",
        "-f", "lavfi", "-i", `testsrc=size=480x640:rate=24:duration=3, hue=h=${index * 45}`,
        "-f", "lavfi", "-i", `sine=frequency=${330 + index * 110}:duration=3`,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path
      ]);
      assert.equal(made.status, 0, made.stderr?.toString());
      const sourceUrl = `https://creator.example/${sourceId}.mp4`;
      mediaAssets[sourceId] = { path, sourceUrl };
      clips.push({
        sourceId, sourceUrl, creator: "Creator " + index,
        rightsStatus: "permission_granted",
        rightsEvidenceReference: "permission-fixture-" + index,
        allowedPlatforms: ["youtube_shorts"],
        start: 0.25, end: 2.25, score: index ? 9 : 5
      });
    }
    const inputPath = join(dir, "compilation.json");
    const outputPath = join(dir, "ranked-compilation.mp4");
    await writeFile(inputPath, JSON.stringify({
      title: "Top two moments",
      introCommentary: "Two moments you need to see",
      outroCommentary: "Which moment wins",
      targetDurationSeconds: 8,
      clips, mediaAssets, outputPath
    }));
    const run = spawnSync(process.execPath, ["src/clips/compilation-cli.js", inputPath], { encoding: "utf8", timeout: 180000 });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const result = JSON.parse(await readFile(inputPath.replace(/\.json$/i, ".compilation-plan.json"), "utf8"));
    assert.equal(result.status, "compilation_plan_ready");
    assert.equal(result.sequence[0].sourceId, "creator-1");
    assert.equal(result.rendered.status, "rendered");
    assert.equal(result.rendered.width, 1080);
    assert.equal(result.rendered.height, 1920);
    assert.equal(result.rendered.videoCodec, "h264");
    assert.equal(result.rendered.audioCodec, "aac");
    assert.equal(result.rendered.sourceAudioPreserved, true);
    assert.ok((await readFile(outputPath)).length > 10000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
