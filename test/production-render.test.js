import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { renderShortVideo } from "../src/production/render.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

test("renderer rejects assets without an approved source type or license provenance", async () => {
  await assert.rejects(renderShortVideo({
    audioPath: "/missing/audio.wav",
    scenes: [{ imagePath: "/missing/image.png", start: 0, end: 2, caption: "Test" }]
  }), /unapproved or missing asset sourceType/);
});

test("renderer rejects overlapping or gapped scene timelines", async () => {
  await assert.rejects(renderShortVideo({
    audioPath: "/missing/audio.wav",
    scenes: [
      { imagePath: "/missing/one.png", start: 0, end: 1, sourceType: "original_graphic" },
      { imagePath: "/missing/two.png", start: 1.2, end: 2, sourceType: "original_graphic" }
    ]
  }), /contiguous/);
});

test("renderer creates and independently probes a vertical H.264/AAC MP4", { skip: !hasFfmpeg }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "automation-render-"));
  try {
    const imagePath = join(dir, "scene.png");
    const audioPath = join(dir, "voice.wav");
    const outputPath = join(dir, "short.mp4");
    const image = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=navy:s=360x640", "-frames:v", "1", imagePath]);
    assert.equal(image.status, 0, image.stderr?.toString());
    const audio = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "pcm_s16le", audioPath]);
    assert.equal(audio.status, 0, audio.stderr?.toString());
    const result = await renderShortVideo({
      outputPath,
      audioPath,
      scenes: [{
        imagePath, start: 0, end: 2, caption: "An original test scene.",
        sourceType: "original_graphic"
      }]
    });
    assert.equal(result.status, "rendered");
    assert.equal(result.width, 1080);
    assert.equal(result.height, 1920);
    assert.equal(result.videoCodec, "h264");
    assert.equal(result.audioCodec, "aac");
    assert.equal(result.scenes, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
