import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateProbe, probeVideo, qcAndRepair } from "../src/production/qc-repair.js";

const run = promisify(execFile);
const ffmpegAvailable = await run("ffmpeg", ["-version"]).then(() => true).catch(() => false);

test("evaluateProbe enforces the Shorts delivery spec", () => {
  assert.equal(evaluateProbe({ width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", hasAudio: true, fps: 30, durationSeconds: 12, sizeBytes: 100 }).passed, true);
  const bad = evaluateProbe({ width: 640, height: 360, videoCodec: "mpeg4", audioCodec: null, hasAudio: false, fps: 30, durationSeconds: 12, sizeBytes: 100 });
  assert.equal(bad.passed, false);
  assert.ok(bad.failures.length >= 3);
});

test("qcAndRepair repairs a wrong-resolution silent render to spec", { skip: !ffmpegAvailable }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "qc-"));
  const bad = join(dir, "bad.mp4");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=3", "-c:v", "libx264", bad]);
  const before = await probeVideo(bad);
  assert.equal(evaluateProbe(before).passed, false);
  const result = await qcAndRepair(bad, {});
  assert.equal(result.status, "passed_after_repair");
  assert.equal(result.repaired, true);
  const after = await probeVideo(bad);
  assert.deepEqual([after.width, after.height, after.videoCodec, after.audioCodec], [1080, 1920, "h264", "aac"]);
  assert.ok((await stat(bad)).size > 0);
});
