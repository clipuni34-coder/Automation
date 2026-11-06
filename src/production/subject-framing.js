// Subject-aware vertical framing (9:16 from a 16:9 source).
//
// Problem this solves: a fixed centre crop keeps only ~32% of a 16:9 frame's
// width, so a moving subject leaves the frame. This module turns a subject
// track (scripts/track_subject.py) into a framing plan, and evaluates that plan
// so QC can HOLD a render whose main subject is not actually visible.
//
// Planner policy (tightest framing that provably keeps the subject in):
//   For each story beat, try candidate window widths from narrow (pure crop,
//   deepest zoom, punch-in) to full frame. Keep the NARROWEST candidate whose
//   following window contains the dominant subject peak for >= 97% of the
//   sampled frames. A narrow window fills the vertical frame completely; wider
//   windows keep the full subject span and fill the leftover space with a
//   blurred copy of the same footage. Nothing is ever cropped away to force a
//   pass: if no window can hold the subject, the full frame width is kept.
//
// All coordinates are fractions of the SOURCE frame (0..1).

export const PUNCH_BEATS = [1, 1.25, 1];
export const TRACK_PROMINENCE_MIN = 1.6; // below this, a "peak" is noise
export const MIN_CROP_COVERAGE = 0.97; // a following window must keep the peak in
export const MAX_CROP_VELOCITY = 0.35; // window widths per second
export const INTERIOR_INSET = 0.06; // safe-band inset, fraction of window width
export const MIN_USABLE_RATIO = 0.4; // need enough measurable frames to judge
export const MIN_CONTAINED_RATIO = 0.95; // gate: subject inside the safe frame
export const CANDIDATE_WIDTHS = [0.5, 0.62, 0.75, 0.88, 1.0];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round3 = (v) => Math.round(v * 1000) / 1000;

/** Width of a 9:16 window as a fraction of source width (punch = zoom-in). */
export function windowFraction(sourceAspect, punch = 1) {
  return (9 / 16) / sourceAspect / punch;
}

export function usableSamples(track) {
  return (track?.samples ?? []).filter(
    (s) => s.peakX !== null && s.peakX !== undefined && (s.prominence ?? 0) >= TRACK_PROMINENCE_MIN,
  );
}

/** Moving average of {t,x} control points over +/- halfWindow seconds. */
function smoothPoints(points, halfWindow = 0.4) {
  return points.map((p) => {
    const near = points.filter((q) => Math.abs(q.t - p.t) <= halfWindow);
    return { t: p.t, x: near.reduce((sum, q) => sum + q.x, 0) / (near.length || 1) };
  });
}

/** Limit how fast the window moves, so a reframe reads as a camera move. */
function limitVelocity(points, maxVelocity = MAX_CROP_VELOCITY) {
  const out = points.map((p) => ({ ...p }));
  for (let i = 1; i < out.length; i += 1) {
    const maxStep = maxVelocity * Math.max(1e-3, out[i].t - out[i - 1].t);
    out[i].x = clamp(out[i].x, out[i - 1].x - maxStep, out[i - 1].x + maxStep);
  }
  for (let i = out.length - 2; i >= 0; i -= 1) {
    const maxStep = maxVelocity * Math.max(1e-3, out[i + 1].t - out[i].t);
    out[i].x = clamp(out[i].x, out[i + 1].x - maxStep, out[i + 1].x + maxStep);
  }
  return out;
}

/** Interpolate the window's left edge at a local (beat) time. */
export function interpolateX(points, localT) {
  const pts = points ?? [];
  if (!pts.length) return 0;
  let x = pts[0].x;
  for (let i = 1; i < pts.length; i += 1) {
    if (localT <= pts[i].t) {
      const span = Math.max(1e-6, pts[i].t - pts[i - 1].t);
      const f = clamp((localT - pts[i - 1].t) / span, 0, 1);
      return pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f;
    }
    x = pts[i].x;
  }
  return x;
}

/** Control points for a following window of width `wf`, from local peak medians. */
export function controlPointsFor(samples, beatStart, beatEnd, wf, step = 0.5, fallbackX = 0) {
  const points = [];
  for (let t = beatStart; t < beatEnd - 1e-9; t += step) {
    const near = samples.filter((s) => Math.abs(s.t - t) <= 0.6);
    const pool = near.length ? near : samples;
    const xs = pool.map((s) => s.mainX ?? s.peakX).sort((a, b) => a - b);
    const centre = xs.length ? xs[Math.floor(xs.length / 2)] : 0.5;
    points.push({ t: Math.round((t - beatStart) * 1000) / 1000, x: clamp(centre - wf / 2, 0, Math.max(0, 1 - wf)) });
  }
  if (!points.length) points.push({ t: 0, x: clamp(fallbackX, 0, Math.max(0, 1 - wf)) });
  return limitVelocity(smoothPoints(points)).map((p) => ({ t: p.t, x: clamp(p.x, 0, Math.max(0, 1 - wf)) }));
}

/** Main-subject horizontal extent for a sample (falls back to the peak). */
export function mainExtent(sample) {
  if (sample.mainLo !== null && sample.mainLo !== undefined && sample.mainHi !== null && sample.mainHi !== undefined) {
    return { lo: sample.mainLo, hi: sample.mainHi, x: sample.mainX ?? (sample.mainLo + sample.mainHi) / 2 };
  }
  return { lo: sample.peakX, hi: sample.peakX, x: sample.peakX };
}

/**
 * Is a sample's subject inside a window? Requires BOTH the main subject extent
 * and the raw motion peak to be inside, so temporal smoothing can never hide a
 * subject that has genuinely left the frame.
 */
export function sampleContained(sample, x0, x1, mode = "crop") {
  const inset = mode === "contain" ? 0 : INTERIOR_INSET * (x1 - x0);
  const m = mainExtent(sample);
  const mainIn = m.lo >= x0 + inset && m.hi <= x1 - inset;
  const peakIn = sample.peakX === null || sample.peakX === undefined
    ? mainIn
    : (sample.peakX >= x0 + inset * 0.5 && sample.peakX <= x1 - inset * 0.5);
  return mainIn && peakIn;
}

/** Fraction of samples whose MAIN subject stays inside a following window. */
export function cropCoverage(samples, beatStart, wf, points) {
  if (!samples.length) return 0;
  const inside = samples.filter((s) => {
    const x = interpolateX(points, s.t - beatStart);
    return sampleContained(s, x, x + wf, "crop");
  }).length;
  return inside / samples.length;
}

/**
 * Build a framing plan.
 * @param {object} track output of track_subject.py for the selected window
 * @param {object} opts  { sourceAspect, windowSeconds, punch?: number[], controlStep?: number }
 */
export function planSubjectFraming(track, opts) {
  const sourceAspect = Number(opts?.sourceAspect) || 16 / 9;
  const windowSeconds = Number(opts?.windowSeconds) || 0;
  const punch = opts?.punch ?? PUNCH_BEATS;
  const controlStep = opts?.controlStep ?? 0.5;
  const samples = usableSamples(track);
  const totalFrames = track?.samples?.length ?? 0;
  const base = {
    status: "untrackable",
    sourceAspect,
    windowSeconds,
    beats: [],
    metrics: { usableFrames: samples.length, totalFrames, usableRatio: round3(samples.length / Math.max(1, totalFrames)) },
  };
  if (!samples.length || windowSeconds <= 0) return base;

  const beatCount = punch.length;
  const beatSeconds = windowSeconds / beatCount;
  const beats = [];
  let lastX = null;
  let lastWidth = null;
  for (let b = 0; b < beatCount; b += 1) {
    const t0 = b * beatSeconds;
    const t1 = b === beatCount - 1 ? windowSeconds + 1e-6 : (b + 1) * beatSeconds;
    const inBeat = samples.filter((s) => s.t >= t0 && s.t < t1);
    const punchWidth = clamp(windowFraction(sourceAspect, punch[b]), 0.05, 1);
    // Candidate widths, narrowest (deepest zoom) first, ending at full frame.
    const candidateWidths = [punchWidth, windowFraction(sourceAspect, punch[b] * 1.25), ...CANDIDATE_WIDTHS,
      lastWidth === null ? 1 : lastWidth]
      .map((w) => clamp(Number(w) || 1, 0.05, 1))
      .filter((w) => w > 0);
    const candidates = [...new Set(candidateWidths)].sort((a, b2) => a - b2);
    let chosen = null;
    for (const wf of candidates) {
      const fallback = lastX === null ? clamp(0.5 - wf / 2, 0, Math.max(0, 1 - wf)) : clamp(lastX, 0, Math.max(0, 1 - wf));
      const points = controlPointsFor(inBeat.length ? inBeat : samples.filter((s) => Math.abs(s.t - t0) <= 2), t0, t1, wf, controlStep, fallback);
      const coverage = cropCoverage(inBeat.length ? inBeat : [], t0, wf, points);
      const ok = inBeat.length === 0 ? wf >= 1 : coverage >= MIN_CROP_COVERAGE;
      if (ok) { chosen = { widthFraction: wf, points, coverage: inBeat.length ? coverage : 1 }; break; }
    }
    if (!chosen) {
      const wf = 1;
      chosen = { widthFraction: wf, points: [{ t: 0, x: 0 }], coverage: 1 };
    }
    const fillsFrame = Math.abs(chosen.widthFraction - punchWidth) < 1e-3;
    const mode = fillsFrame ? "crop" : (chosen.widthFraction >= 0.999 ? "contain" : "padded");
    lastX = chosen.points[chosen.points.length - 1].x;
    lastWidth = chosen.widthFraction;
    beats.push({
      index: b,
      startSeconds: round3(t0),
      seconds: round3(t1 - t0),
      mode,
      punch: punch[b],
      widthFraction: round3(chosen.widthFraction),
      windowFraction: round3(chosen.widthFraction),
      cropCoverage: round3(chosen.coverage),
      samples: inBeat.length,
      inherited: inBeat.length === 0,
      controlPoints: chosen.points,
    });
  }
  const paddedBeats = beats.filter((x) => x.mode !== "crop").length;
  return {
    ...base,
    status: "planned",
    beats,
    metrics: { ...base.metrics, paddedBeats, cropBeats: beats.length - paddedBeats },
  };
}

/** Window [x0,x1] applied at time t by a plan. */
export function windowAt(plan, t) {
  const beats = plan?.beats ?? [];
  const idx = beats.findIndex((b, i) => t >= b.startSeconds && (i === beats.length - 1 || t < b.startSeconds + b.seconds));
  const beat = beats[idx === -1 ? beats.length - 1 : idx];
  if (!beat) return null;
  const x = interpolateX(beat.controlPoints, t - beat.startSeconds);
  const wf = beat.widthFraction ?? beat.windowFraction;
  return { x0: x, x1: Math.min(1, x + wf), mode: beat.mode, width: wf, beat: beat.index };
}

/**
 * Gate (source side): was the dominant subject actually inside the window that
 * the render used? Evaluated from the track, independent of the render.
 */
export function evaluateSubjectFraming(track, plan) {
  const samples = usableSamples(track);
  const all = track?.samples ?? [];
  if (!samples.length) {
    return { status: "untrackable", reason: "No dominant moving subject could be measured in the selected window.", metrics: { usableFrames: 0, totalFrames: all.length } };
  }
  if (plan?.status !== "planned") {
    return { status: "untrackable", reason: "No framing plan could be built from the subject track.", metrics: { usableFrames: samples.length, totalFrames: all.length } };
  }
  const failures = [];
  const spanCuts = [];
  let contained = 0;
  for (const s of samples) {
    const w = windowAt(plan, s.t);
    if (!w) { failures.push({ t: s.t, peakX: s.peakX, reason: "no_window" }); continue; }
    const inset = w.mode === "contain" ? 0 : INTERIOR_INSET * w.width;
    const m = mainExtent(s);
    if (sampleContained(s, w.x0, w.x1, w.mode)) contained += 1;
    else failures.push({
      t: s.t,
      mainSubject: [round3(m.lo), round3(m.hi)],
      peakX: s.peakX,
      window: [round3(w.x0), round3(w.x1)],
      reason: "main_subject_outside_safe_frame",
    });
    if (s.spanLo !== null && s.spanLo !== undefined && (s.spanLo < w.x0 - 0.02 || s.spanHi > w.x1 + 0.02)) {
      spanCuts.push({ t: s.t, span: [s.spanLo, s.spanHi], window: [round3(w.x0), round3(w.x1)] });
    }
  }
  const usableRatio = samples.length / Math.max(1, all.length);
  const containedRatio = contained / samples.length;
  const metrics = {
    usableFrames: samples.length,
    totalFrames: all.length,
    usableRatio: round3(usableRatio),
    containedFrames: contained,
    containedRatio: round3(containedRatio),
    spanCutFrames: spanCuts.length,
    failures: failures.slice(0, 8),
    spanCuts: spanCuts.slice(0, 5),
  };
  if (usableRatio < MIN_USABLE_RATIO) {
    return { status: "untrackable", reason: `Only ${samples.length}/${all.length} frames had a measurable subject; framing cannot be verified.`, metrics };
  }
  if (containedRatio < MIN_CONTAINED_RATIO) {
    return { status: "hold", reason: `Main subject inside the safe frame in only ${(containedRatio * 100).toFixed(1)}% of measurable frames (gate ${(MIN_CONTAINED_RATIO * 100).toFixed(0)}%).`, metrics };
  }
  return { status: "pass", reason: `Main subject inside the safe frame in ${(containedRatio * 100).toFixed(1)}% of ${samples.length} measurable frames.`, metrics };
}

/**
 * Gate (output side): the rendered file must show measurable subject motion
 * inside the visible safe band.
 */
export function evaluateRenderedFraming(outputTrack, opts = {}) {
  const band = opts.safeBand ?? [0.12, 0.88];
  const minUsable = opts.minUsableRatio ?? MIN_USABLE_RATIO;
  const minInside = opts.minInsideRatio ?? 0.9;
  const samples = usableSamples(outputTrack);
  const all = outputTrack?.samples ?? [];
  if (!samples.length) {
    return { status: "untrackable", reason: "No measurable subject motion in the rendered output; framing cannot be verified.", metrics: { usableFrames: 0, totalFrames: all.length } };
  }
  const inside = samples.filter((s) => s.peakX >= band[0] && s.peakX <= band[1]);
  const metrics = {
    usableFrames: samples.length,
    totalFrames: all.length,
    usableRatio: round3(samples.length / Math.max(1, all.length)),
    insideRatio: round3(inside.length / samples.length),
    peakRange: [round3(Math.min(...samples.map((s) => s.peakX))), round3(Math.max(...samples.map((s) => s.peakX)))],
    outside: samples.filter((s) => s.peakX < band[0] || s.peakX > band[1]).slice(0, 5).map((s) => ({ t: s.t, peakX: s.peakX })),
  };
  if (metrics.usableRatio < minUsable) {
    return { status: "untrackable", reason: `Subject measurable in only ${samples.length}/${all.length} output frames; framing cannot be verified.`, metrics };
  }
  if (metrics.insideRatio < minInside) {
    return { status: "hold", reason: `Rendered subject outside the safe band ${band.join("-")} in ${((1 - metrics.insideRatio) * 100).toFixed(1)}% of measurable frames.`, metrics };
  }
  return { status: "pass", reason: `Rendered subject inside the safe band in ${(metrics.insideRatio * 100).toFixed(1)}% of measurable frames.`, metrics };
}

/**
 * ffmpeg expression for the crop x offset over time. Control points are linear
 * ramps: x(t) = x0 + sum(dx_k * clip((t - t_k)/dt_k, 0, 1)), clamped in pixels.
 */
export function cropXExpression(points, sourceWidth, cropWidth) {
  const pts = points?.length ? points : [{ t: 0, x: 0 }];
  let expr = `${pts[0].x.toFixed(4)}`;
  for (let i = 1; i < pts.length; i += 1) {
    const dt = Math.max(1e-3, pts[i].t - pts[i - 1].t);
    const dx = pts[i].x - pts[i - 1].x;
    if (Math.abs(dx) < 1e-4) continue;
    expr += `+${dx.toFixed(4)}*clip((t-${pts[i - 1].t.toFixed(3)})/${dt.toFixed(3)}\\,0\\,1)`;
  }
  const maxX = Math.max(0, sourceWidth - cropWidth);
  return `clip((${expr})*${sourceWidth}\\,0\\,${maxX})`;
}

/**
 * Build one filter chain per story beat that maps a trimmed stream to the final
 * vertical geometry (crop-follow, or padded zoom-out with blurred fill).
 */
export function buildSubjectBeatFilters(plan, dims) {
  const {
    sourceWidth, sourceHeight, postOverlayHeight, outputWidth = 1080, outputHeight = 1920,
  } = dims;
  const height = postOverlayHeight ?? sourceHeight;
  return (plan?.beats ?? []).map((beat, i) => {
    const wf = beat.widthFraction ?? beat.windowFraction;
    const cropWidth = Math.max(64, Math.round((sourceWidth * wf) / 2) * 2);
    const cropHeight = Math.max(64, Math.round(height / 2) * 2);
    const expr = cropXExpression(beat.controlPoints, sourceWidth, cropWidth);
    const crop = `crop=${cropWidth}:${cropHeight}:x='${expr}':y=0`;
    if (beat.mode === "crop") {
      return {
        index: i,
        mode: beat.mode,
        cropWidth,
        cropHeight,
        filter: `${crop},scale=${outputWidth}:${outputHeight}:flags=bicubic,setsar=1`,
        inputs: 1,
      };
    }
    return {
      index: i,
      mode: beat.mode,
      cropWidth,
      cropHeight,
      filter: `${crop},split=2[bg${i}][fg${i}];`
        + `[bg${i}]scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=increase,crop=${outputWidth}:${outputHeight},boxblur=24:2[bgb${i}];`
        + `[fg${i}]scale=${outputWidth}:-2:flags=bicubic[fgs${i}];`
        + `[bgb${i}][fgs${i}]overlay=(W-w)/2:(H-h)/2,setsar=1`,
      inputs: 2,
    };
  });
}
