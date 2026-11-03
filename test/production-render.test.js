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

test("opening hook overlay wraps into readable lines inside the vertical frame", () => {
  const ass = buildAss([{ start: 0, end: 8, caption: "Opening dialogue", hookOverlayText: "That is why these children are practicing to duck and cover at school." }], 8);
  const hook = ass.split("\n").find(line => line.includes(",Hook,"));
  assert.ok(hook, "hook overlay should be rendered");
  assert.ok(hook.includes("\\N"), "long hook text should wrap to multiple lines");
  assert.ok(hook.includes("That is why these children"));
  assert.ok(ass.includes("Style: Hook,DejaVu Sans,60,"));
});

test("word-timed captions render timed karaoke groups instead of scene-wide static captions", () => {
  const ass = buildAss([{
    start: 2, end: 5, caption: "Fallback caption",
    wordTimings: [
      { text: "Wait", start: 0.25, end: 0.5 },
      { text: "for", start: 0.5, end: 0.7 },
      { text: "it", start: 0.7, end: 1.0 }
    ]
  }], 5);
  const dialogue = ass.split("\n").filter(line => line.startsWith("Dialogue:"));
  assert.equal(dialogue.length, 1);
  assert.ok(dialogue[0].includes("0:00:02.25"));
  assert.ok(dialogue[0].includes("0:00:03.00"));
  assert.ok(dialogue[0].includes("{\\\\k25}Wait"));
  assert.ok(dialogue[0].includes("{\\\\k20}for"));
  assert.ok(dialogue[0].includes("{\\\\k30}it"));
  assert.ok(!dialogue[0].includes("Fallback caption"));
});

test("renderer applies punch-in crop and word-timed captions to authorized source footage", { skip: !hasFfmpeg }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "automation-viral-edit-"));
  try {
    const videoPath = join(dir, "source.mp4");
    const audioPath = join(dir, "audio.wav");
    const outputPath = join(dir, "edited.mp4");
    const source = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=24:duration=2", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath]);
    assert.equal(source.status, 0, source.stderr?.toString());
    const audio = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "pcm_s16le", audioPath]);
    assert.equal(audio.status, 0, audio.stderr?.toString());
    const result = await renderShortVideo({
      outputPath, audioPath,
      scenes: [{
        videoPath, start: 0, end: 2, caption: "Fallback only",
        wordTimings: [{ text: "Watch", start: 0.1, end: 0.45 }, { text: "this", start: 0.45, end: 0.8 }],
        punchIn: true,
        sourceType: "licensed_stock", sourceUrl: "https://example.org/source.mp4", license: "Test license"
      }]
    });
    assert.equal(result.status, "rendered");
    assert.equal(result.width, 1080);
    assert.equal(result.height, 1920);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
