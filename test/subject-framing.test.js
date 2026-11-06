import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  windowFraction, planSubjectFraming, evaluateSubjectFraming, evaluateRenderedFraming,
  buildSubjectBeatFilters, cropXExpression, sampleContained, interpolateX, cropCoverage,
  controlPointsFor, MIN_CROP_COVERAGE,
} from "../src/production/subject-framing.js";

// Build a synthetic track: a subject of `width` travelling from `from` to `to`.
function travelTrack({ seconds, from = 0.15, to = 0.8, width = 0.12, fps = 8, prominence = 20, jitter = 0 }) {
  const frames = Math.round(seconds * fps);
  const samples = [];
  for (let i = 0; i < frames; i += 1) {
    const f = i / Math.max(1, frames - 1);
    const x = from + (to - from) * f + (jitter ? Math.sin(i * 1.7) * jitter : 0);
    const lo = Math.max(0, x - width / 2);
    const hi = Math.min(1, x + width / 2);
    samples.push({
      t: i / fps, peakX: x, peakY: 0.5, prominence, mass: 0.7, energy: 1000,
      spanLo: lo, spanHi: hi, coreLo: lo, coreHi: hi,
      mainX: x, mainLo: lo, mainHi: hi, mainShare: 0.7,
    });
  }
  return { status: "ok", samples, summary: { frames, fps, usableRatio: 1 } };
}

const fixedCropPlan = (seconds, aspect = 16 / 9, punch = [1, 1.25, 1]) => ({
  status: "planned",
  beats: punch.map((p, i) => {
    const wf = windowFraction(aspect, p);
    return {
      index: i, startSeconds: (i * seconds) / 3, seconds: seconds / 3, mode: "crop",
      punch: p, widthFraction: wf, windowFraction: wf, controlPoints: [{ t: 0, x: (1 - wf) / 2 }],
    };
  }),
});

test("framing: 9:16 window of a 16:9 source keeps ~32% of width; punch-in narrows it", () => {
  assert.ok(Math.abs(windowFraction(16 / 9, 1) - 0.3164) < 0.001);
  assert.ok(Math.abs(windowFraction(16 / 9, 1.25) - 0.2531) < 0.001);
});

test("framing: a travelling subject is followed with a moving window (no cut)", () => {
  const track = travelTrack({ seconds: 21, from: 0.1, to: 0.85, width: 0.12 });
  const plan = planSubjectFraming(track, { sourceAspect: 16 / 9, windowSeconds: 21 });
  const gate = evaluateSubjectFraming(track, plan);
  assert.equal(plan.status, "planned");
  assert.equal(gate.status, "pass", gate.reason);
  assert.ok(gate.metrics.containedRatio >= 0.95);
  // It should not need the full frame when the subject is only 12% wide.
  assert.ok(plan.beats.some((b) => b.widthFraction < 1), "expected a following window narrower than the full frame");
});

test("framing: the old fixed centre crop FAILS the same gate for that subject", () => {
  const track = travelTrack({ seconds: 21, from: 0.1, to: 0.85, width: 0.12 });
  const gate = evaluateSubjectFraming(track, fixedCropPlan(21));
  assert.equal(gate.status, "hold");
  assert.match(gate.reason, /Main subject inside the safe frame in only/);
  assert.ok(gate.metrics.containedRatio < 0.8);
});

test("framing: a subject spanning more than a window falls back to full width, never cut", () => {
  // Two animals far apart in every frame: no 9:16 window can hold both.
  const frames = 120;
  const samples = Array.from({ length: frames }, (_, i) => ({
    t: i / 8, peakX: 0.5, peakY: 0.5, prominence: 25, mass: 0.3, energy: 900,
    spanLo: 0.05, spanHi: 0.95, coreLo: 0.05, coreHi: 0.95,
    mainX: 0.5, mainLo: 0.05, mainHi: 0.95, mainShare: 0.4,
  }));
  const track = { status: "ok", samples, summary: { frames, fps: 8 } };
  const plan = planSubjectFraming(track, { sourceAspect: 16 / 9, windowSeconds: 15 });
  assert.ok(plan.beats.every((b) => b.widthFraction === 1 && b.mode === "contain"));
  assert.equal(evaluateSubjectFraming(track, plan).status, "pass");
});

test("framing: an untrackable window is a hold, not a pass", () => {
  const track = { status: "ok", samples: [{ t: 0, peakX: null, prominence: 0 }], summary: { frames: 1, fps: 8 } };
  const plan = planSubjectFraming(track, { sourceAspect: 16 / 9, windowSeconds: 10 });
  assert.equal(plan.status, "untrackable");
  assert.equal(evaluateSubjectFraming(track, plan).status, "untrackable");
});

test("framing: gate requires BOTH the main subject and the raw motion peak inside", () => {
  const sample = { peakX: 0.95, mainX: 0.5, mainLo: 0.45, mainHi: 0.55, prominence: 20 };
  assert.equal(sampleContained(sample, 0.3, 0.7, "crop"), false);
  assert.equal(sampleContained({ ...sample, peakX: 0.5 }, 0.3, 0.7, "crop"), true);
  assert.equal(sampleContained({ ...sample, peakX: 0.5 }, 0.0, 1.0, "contain"), true);
});

test("framing: coverage is measured per sample, not from the plan's promises", () => {
  const track = travelTrack({ seconds: 10, from: 0.2, to: 0.8, width: 0.1 });
  const wf = windowFraction(16 / 9, 1);
  const points = controlPointsFor(track.samples, 0, 10, wf);
  const cov = cropCoverage(track.samples, 0, wf, points);
  assert.ok(cov >= MIN_CROP_COVERAGE, `expected following window coverage >= ${MIN_CROP_COVERAGE}, got ${cov}`);
  const stuck = [{ t: 0, x: 0.34 }];
  assert.ok(cropCoverage(track.samples, 0, wf, stuck) < 0.5);
});

test("framing: output-side gate holds when the rendered subject sits at the edge", () => {
  const edge = {
    status: "ok",
    samples: Array.from({ length: 50 }, (_, i) => ({ t: i / 8, peakX: 0.03, prominence: 30, mainX: 0.03, mainLo: 0, mainHi: 0.06 })),
  };
  const gate = evaluateRenderedFraming(edge);
  assert.equal(gate.status, "hold");
  const centred = {
    status: "ok",
    samples: Array.from({ length: 50 }, (_, i) => ({ t: i / 8, peakX: 0.5, prominence: 30, mainX: 0.5, mainLo: 0.44, mainHi: 0.56 })),
  };
  assert.equal(evaluateRenderedFraming(centred).status, "pass");
});

test("framing: output-side gate refuses to pass an unmeasurable render", () => {
  const blank = { status: "ok", samples: [{ t: 0, peakX: null, prominence: 0 }] };
  assert.equal(evaluateRenderedFraming(blank).status, "untrackable");
});

test("framing: crop expressions interpolate and clamp inside the frame", () => {
  const points = [{ t: 0, x: 0.1 }, { t: 2, x: 0.5 }, { t: 4, x: 0.9 }];
  assert.equal(interpolateX(points, 0), 0.1);
  assert.ok(Math.abs(interpolateX(points, 1) - 0.3) < 1e-9);
  assert.ok(Math.abs(interpolateX(points, 3) - 0.7) < 1e-9);
  assert.equal(interpolateX(points, 99), 0.9);
  const expr = cropXExpression(points, 1920, 608);
  assert.match(expr, /^clip\(\(/);
  assert.match(expr, /\\,0\\,1312\)$/); // clamped to iw - crop width
});

test("framing: beat filters cover the frame or pad it, with even crop dimensions", () => {
  const track = travelTrack({ seconds: 12, from: 0.2, to: 0.7, width: 0.1 });
  const plan = planSubjectFraming(track, { sourceAspect: 16 / 9, windowSeconds: 12 });
  const filters = buildSubjectBeatFilters(plan, { sourceWidth: 1920, sourceHeight: 1080, postOverlayHeight: 1080 });
  assert.equal(filters.length, 3);
  for (const f of filters) {
    assert.equal(f.cropWidth % 2, 0);
    assert.equal(f.cropHeight % 2, 0);
    if (f.mode === "crop") {
      assert.match(f.filter, /^crop=\d+:\d+:x='clip\(/);
      assert.match(f.filter, /scale=1080:1920/);
      assert.doesNotMatch(f.filter, /boxblur/);
    } else {
      assert.match(f.filter, /boxblur=24:2/);
      assert.match(f.filter, /overlay=\(W-w\)\/2:\(H-h\)\/2/);
    }
  }
});

test("framing: tracker locates a synthetic travelling subject within 5% of frame width", { skip: !hasFfmpeg() }, () => {
  // Ground-truth fixture: a textured block crossing a static, noisy background.
  const dir = mkdtempSync(join(tmpdir(), "subj-"));
  const out = join(dir, "mover.mp4");
  execFileSync("python3", ["-c", `
import numpy as np, subprocess, sys
from PIL import Image
W,H,FPS,DUR = 320,180,25,6
rng = np.random.default_rng(3)
bg = rng.normal(150,25,(H,W,3)).clip(0,255).astype(np.uint8)
truth = []
for i in range(FPS*DUR):
    t = i/FPS
    f = bg.copy()
    cx = 0.10 + 0.70*(t/DUR)
    rw, rh = int(0.13*W), int(0.30*H)
    x0, y0 = int(cx*W-rw/2), int(0.40*H)
    f[y0:y0+rh, x0:x0+rw] = (np.array([190,120,70],float)+rng.normal(0,18,(rh,rw,3))).clip(0,255).astype(np.uint8)
    Image.fromarray(f).save(f"${dir}/f{i:05d}.png")
    truth.append(cx)
subprocess.run(["ffmpeg","-y","-v","error","-framerate",str(FPS),"-i","${dir}/f%05d.png","-c:v","libx264","-pix_fmt","yuv420p","${out}"], check=True)
print(" ".join(f"{v:.4f}" for v in truth))
`], { encoding: "utf8", timeout: 300000, stdio: ["ignore", "pipe", "ignore"] });
  const raw = execFileSync("python3", ["scripts/track_subject.py", out, "0", "6"], { encoding: "utf8", timeout: 300000 });
  const track = JSON.parse(raw.trim().split("\n").at(-1));
  assert.equal(track.status, "ok");
  assert.ok(track.summary.usableRatio >= 0.9, `usableRatio ${track.summary.usableRatio}`);
  const usable = track.samples.filter((s) => s.mainX !== null && s.prominence >= 1.6);
  assert.ok(usable.length > 20);
  // The tracked subject must travel with the ground truth, not sit still.
  const first = usable[0].mainX;
  const last = usable[usable.length - 1].mainX;
  assert.ok(last - first > 0.45, `track should travel across frame, got ${first.toFixed(2)} -> ${last.toFixed(2)}`);
  // And the follow window must keep it in frame for the whole clip.
  const plan = planSubjectFraming(track, { sourceAspect: 16 / 9, windowSeconds: 6 });
  assert.equal(evaluateSubjectFraming(track, plan).status, "pass");
});

function hasFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("python3", ["-c", "import numpy, PIL"], { stdio: "ignore" });
    return existsSync("scripts/track_subject.py");
  } catch { return false; }
}
