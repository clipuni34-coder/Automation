import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { assessStoryboardVisualQuality, inspectRenderedVisualQuality, buildVisualQualityReport } from "../src/production/visual-qc.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

test("visual storyboard review rewards distinct beats and flags repeated assets and dense captions", () => {
  const report = assessStoryboardVisualQuality({
    scenes: [
      { imagePath: "/tmp/a.png", start: 0, end: 3, caption: "A clear opening hook." },
      { imagePath: "/tmp/a.png", start: 3, end: 6, caption: "A second scene with far too many words that viewers cannot read quickly on a small phone screen." },
      { imagePath: "/tmp/c.png", start: 6, end: 9, caption: "The payoff." }
    ]
  });
  assert.equal(report.metrics.sceneCount, 3);
  assert.equal(report.metrics.repeatedAssets, 1);
  assert.ok(report.score < 100);
  assert.equal(report.status, "review");
  assert.ok(report.warnings.some(message => message.includes("reused")));
  assert.ok(report.warnings.some(message => message.includes("too long")));
});

test("visual QC treats distinct chronological ranges from one authorized creator video as separate visual beats", () => {
  const report = assessStoryboardVisualQuality({
    scenes: [
      { videoPath: "/tmp/source.mp4", sourceType: "creator_clip", sourceIn: 10, sourceOut: 14, start: 0, end: 4, caption: "Context." },
      { videoPath: "/tmp/source.mp4", sourceType: "creator_clip", sourceIn: 24, sourceOut: 28, start: 4, end: 8, caption: "Development." },
      { videoPath: "/tmp/source.mp4", sourceType: "creator_clip", sourceIn: 40, sourceOut: 44, start: 8, end: 12, caption: "Payoff." }
    ]
  });
  assert.equal(report.metrics.uniqueAssets, 3);
  assert.equal(report.metrics.repeatedAssets, 0);
  assert.equal(report.score, 100);
  assert.equal(report.status, "good");
  assert.ok(!report.warnings.some(message => message.includes("reused")));
});

test("visual storyboard review flags long static holds and all-still storyboards", () => {
  const report = assessStoryboardVisualQuality({
    scenes: [
      { imagePath: "/tmp/a.png", start: 0, end: 9, caption: "Opening." },
      { imagePath: "/tmp/b.png", start: 9, end: 18, caption: "Payoff." }
    ]
  });
  assert.ok(report.warnings.some(message => message.includes("still images")));
  assert.ok(report.warnings.some(message => message.includes("more than seven seconds")));
});

test("rendered visual inspection decodes a valid video and reports file size", { skip: !hasFfmpeg }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "visual-qc-"));
  try {
    const videoPath = join(dir, "test.mp4");
    const made = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=24:duration=3", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath]);
    assert.equal(made.status, 0, made.stderr?.toString());
    const report = await inspectRenderedVisualQuality(videoPath);
    assert.equal(report.status, "passed");
    assert.ok(report.fileBytes > 1024);
    assert.ok(report.checks.some(check => check.includes("decoded")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("visual quality report combines storyboard and encoded-video checks", { skip: !hasFfmpeg }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "visual-report-"));
  try {
    const videoPath = join(dir, "test.mp4");
    const made = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=24:duration=3", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath]);
    assert.equal(made.status, 0, made.stderr?.toString());
    const report = await buildVisualQualityReport({
      scenes: [
        { imagePath: "/tmp/a.png", start: 0, end: 1.5, caption: "Hook." },
        { videoPath: "/tmp/b.mp4", start: 1.5, end: 3, caption: "Payoff." }
      ]
    }, videoPath);
    assert.equal(report.score, 92);
    assert.equal(report.rendered.status, "passed");
    assert.ok(Array.isArray(report.limitations));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
