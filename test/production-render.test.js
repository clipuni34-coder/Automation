import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildAss, renderShortVideo } from "../src/production/render.js";
import { generateOriginalGraphic } from "../src/production/visuals.js";

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

test("renderer can encode the generated local PPM fallback graphic", { skip: !hasFfmpeg }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "automation-ppm-render-"));
  try {
    const graphic = await generateOriginalGraphic({ outputPath: join(dir, "scene.png"), sceneIndex: 2 });
    const audioPath = join(dir, "voice.wav");
    const outputPath = join(dir, "ppm-short.mp4");
    const audio = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "pcm_s16le", audioPath]);
    assert.equal(audio.status, 0, audio.stderr?.toString());
    const result = await renderShortVideo({
      outputPath, audioPath,
      scenes: [{ imagePath: graphic.path, start: 0, end: 2, caption: "Fallback visual render test.", sourceType: "original_graphic" }]
    });
    assert.equal(result.status, "rendered");
    assert.equal(result.width, 1080);
    assert.equal(result.height, 1920);
    assert.equal(result.visualQuality.rendered.status, "passed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("renderer accepts licensed real video footage as a scene", { skip: !hasFfmpeg }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "automation-video-render-"));
  try {
    const videoPath = join(dir, "human.mp4");
    const audioPath = join(dir, "voice.wav");
    const outputPath = join(dir, "human-short.mp4");
    const video = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=24:duration=2", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath]);
    assert.equal(video.status, 0, video.stderr?.toString());
    const audio = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=520:duration=2", "-c:a", "pcm_s16le", audioPath]);
    assert.equal(audio.status, 0, audio.stderr?.toString());
    const result = await renderShortVideo({
      outputPath, audioPath,
      scenes: [{
        videoPath, start: 0, end: 2, caption: "Real human footage can be used here.",
        sourceType: "licensed_stock", sourceUrl: "https://www.pexels.com/video/example/",
        license: "Pexels License"
      }]
    });
    assert.equal(result.status, "rendered");
    assert.equal(result.width, 1080);
    assert.equal(result.height, 1920);
    assert.equal(result.videoCodec, "h264");
    assert.equal(result.audioCodec, "aac");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("renderer pads short stock footage to the planned scene duration", { skip: !hasFfmpeg }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "automation-short-footage-"));
  try {
    const videoPath = join(dir, "short-stock.mp4");
    const audioPath = join(dir, "narration.wav");
    const outputPath = join(dir, "padded.mp4");
    const video = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=24:duration=1.2", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath]);
    assert.equal(video.status, 0, video.stderr?.toString());
    const audio = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "pcm_s16le", audioPath]);
    assert.equal(audio.status, 0, audio.stderr?.toString());
    const result = await renderShortVideo({
      outputPath, audioPath,
      scenes: [{ videoPath, start: 0, end: 2, caption: "Footage is shorter than the scene.", sourceType: "licensed_stock", sourceUrl: "https://example.com/stock", license: "Test license" }]
    });
    assert.equal(result.status, "rendered");
    assert.ok(Math.abs(result.durationSeconds - 2) < 0.25, "output should match the planned two-second scene");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("renderer blocks creator footage without explicit rights evidence", async () => {
  await assert.rejects(renderShortVideo({
    audioPath: "/missing/audio.wav",
    targetPlatform: "youtube_shorts",
    scenes: [{ videoPath: "/missing/creator.mp4", start: 0, end: 2, caption: "Creator moment",
      sourceType: "creator_clip", sourceUrl: "https://example.com/video", license: "Creator permission",
      rightsStatus: "reference_only", allowedPlatforms: ["youtube_shorts"] }]
  }), /Asset rights check failed/);
});

test("renderer preserves authorized source-video audio and mixes narration", { skip: !hasFfmpeg }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "automation-source-audio-"));
  try {
    const videoPath = join(dir, "source-with-audio.mp4");
    const audioPath = join(dir, "narration.wav");
    const outputPath = join(dir, "mixed.mp4");
    const source = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=24:duration=2", "-f", "lavfi", "-i", "sine=frequency=330:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", videoPath]);
    assert.equal(source.status, 0, source.stderr?.toString());
    const narration = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=660:duration=2", "-c:a", "pcm_s16le", audioPath]);
    assert.equal(narration.status, 0, narration.stderr?.toString());
    const result = await renderShortVideo({
      outputPath, audioPath, preserveSourceAudio: true,
      scenes: [{ videoPath, sourceIn: 0.5, sourceOut: 2, start: 0, end: 1.5, caption: "Original sound retained", sourceType: "licensed_stock", sourceUrl: "https://www.pexels.com/video/example/", license: "Pexels License" }]
    });
    assert.equal(result.status, "rendered");
    assert.equal(result.sourceAudioPreserved, true);
    assert.equal(result.audioCodec, "aac");
    assert.ok(Math.abs(result.durationSeconds - 1.5) < 0.5);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test("caption layout wraps long text into readable two-line mobile cards with timed phrases", () => {
  const ass = buildAss([{ start: 0, end: 6, caption: "This is a longer sentence designed to test mobile caption wrapping and timed phrase display." }], 6);
  const dialogue = ass.split("\n").filter(line => line.startsWith("Dialogue:"));
  assert.ok(dialogue.length > 1);
  assert.ok(dialogue.some(line => line.includes("\\N")));
  assert.ok(dialogue.every(line => !line.includes("longer sentence designed to test mobile caption wrapping and timed phrase display")));
});
