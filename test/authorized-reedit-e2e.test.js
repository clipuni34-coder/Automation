import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runAuthorizedReedit } from "../src/clips/authorized-reedit.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

test("authorized source re-edit runs from timed transcript through real vertical MP4", { skip: !hasFfmpeg }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "authorized-reedit-e2e-"));
  try {
    const sourceLocalPath = join(dir, "source.mp4");
    const outputPath = join(dir, "re-edited.mp4");
    const source = spawnSync("ffmpeg", ["-y", "-v", "error",
      "-f", "lavfi", "-i", "testsrc=size=480x640:rate=24:duration=8",
      "-f", "lavfi", "-i", "sine=frequency=330:duration=8",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", sourceLocalPath
    ]);
    assert.equal(source.status, 0, source.stderr?.toString());
    const result = await runAuthorizedReedit({
      sourceLocalPath,
      outputPath,
      platform: "youtube_shorts",
      source: {
        sourceUrl: "https://creator.example/authorized/source.mp4",
        title: "Authorized fixture",
        creator: "Test creator",
        durationSeconds: 8,
        rightsStatus: "permission_granted",
        rightsEvidenceReference: "fixture-consent-record",
        allowedPlatforms: ["youtube_shorts"]
      },
      targetDurationSeconds: 5,
      transcriptSegments: [
        { id: "setup", start: 0, end: 2, text: "The story starts here", signals: { hook: 8, emotion: 8, curiosity: 8, payoff: 8, clarity: 8 } },
        { id: "payoff", start: 4, end: 7, text: "And then the unexpected payoff happens", signals: { hook: 9, emotion: 9, curiosity: 9, payoff: 10, clarity: 9 } }
      ]
    });
    assert.equal(result.status, "completed");
    assert.equal(result.plan.status, "edit_plan_ready");
    assert.deepEqual(result.plan.editDecisionList.map(item => item.segmentId), ["setup", "payoff"]);
    assert.equal(result.plan.openingHook.segmentId, "setup");
    assert.equal(result.rendered.width, 1080);
    assert.equal(result.rendered.height, 1920);
    assert.equal(result.rendered.videoCodec, "h264");
    assert.equal(result.rendered.audioCodec, "aac");
    assert.equal(result.rendered.sourceAudioPreserved, true);
    const stat = await readFile(outputPath);
    assert.ok(stat.length > 10000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test("weak but technically renderable edits are held before FFmpeg rendering", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weak-editorial-reedit-"));
  try {
    const sourceLocalPath = join(dir, "source.mp4");
    await writeFile(sourceLocalPath, "fixture source");
    let renderCalled = false;
    const result = await runAuthorizedReedit({
      sourceLocalPath,
      outputPath: join(dir, "should-not-exist.mp4"),
      source: {
        sourceUrl: "https://creator.example/authorized/weak.mp4",
        durationSeconds: 10,
        rightsStatus: "permission_granted",
        rightsEvidenceReference: "fixture-consent-record",
        allowedPlatforms: ["youtube_shorts"]
      },
      targetDurationSeconds: 8,
      transcriptSegments: [
        { id: "weak-one", start: 0, end: 3, text: "A routine opening statement.", signals: { hook: 2, emotion: 2, curiosity: 2, payoff: 2, clarity: 5 } },
        { id: "weak-two", start: 4, end: 7, text: "The same routine statement continues.", signals: { hook: 2, emotion: 2, curiosity: 2, payoff: 2, clarity: 5 } }
      ]
    }, {
      render: async () => { renderCalled = true; throw new Error("renderer must not be called"); }
    });
    assert.equal(result.status, "editorial_review_required");
    assert.equal(result.rendered, null);
    assert.equal(result.outputPath, null);
    assert.equal(result.plan.editorialQuality.status, "below_render_threshold");
    assert.equal(result.plan.editorialQuality.minimumRenderScore, 5.5);
    assert.equal(result.plan.rights.status, "not_editorially_qualified");
    assert.equal(renderCalled, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reference-only discovered videos stay analysis-only and are never rendered", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reference-only-reedit-"));
  try {
    const sourceLocalPath = join(dir, "reference.mp4");
    await writeFile(sourceLocalPath, "not rendered");
    const result = await runAuthorizedReedit({
      sourceLocalPath,
      outputPath: join(dir, "blocked.mp4"),
      source: {
        sourceUrl: "https://youtube.com/watch?v=reference-only",
        durationSeconds: 20,
        rightsStatus: "reference_only"
      },
      transcriptSegments: [{ start: 1, end: 3, text: "A moment", signals: { hook: 9 } }]
    });
    assert.equal(result.status, "analysis_only");
    assert.equal(result.rendered, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
