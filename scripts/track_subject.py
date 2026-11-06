#!/usr/bin/env python3
"""Track the dominant moving subject in a video window (no ML model, no network).

Why this exists: a fixed centre crop of a 16:9 source into 9:16 silently cuts
moving subjects out of frame. To reframe intelligently we need to know where
the subject actually is, frame by frame.

Method
------
1. Sample frames densely (default 8 fps) at reduced width.
2. Estimate the global camera translation between consecutive frames with
   phase correlation, and warp the previous frame accordingly. Handheld or
   panning sources therefore do not register as subject motion.
3. Residual motion = |frame - warped previous frame|, soft-thresholded with
   robust statistics (median + 3*MAD) so film grain and grass texture do not
   dominate, then spatially blurred to give one coherent energy blob per
   subject rather than a speckle field.
4. Report, per sample: the dominant motion peak (x, y), its prominence
   (peak / mean of the blurred energy map), the energy mass inside the peak
   window, and the 5-95% energy span (used to detect subjects that are too
   far apart for one 9:16 window).

Coordinates are fractions of the frame (0..1). A cut or a jump larger than the
search limit is reported as an unusable sample instead of being guessed.

Usage: track_subject.py <video> <start_seconds> <seconds> [--fps 8] [--width 160]
Prints one JSON object on the final stdout line.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image


def extract(video, start, seconds, outdir, fps, width):
    pattern = str(Path(outdir) / "f%04d.png")
    cmd = ["ffmpeg", "-y", "-v", "error"]
    if start > 0:
        cmd += ["-ss", str(start)]
    cmd += ["-i", video, "-t", str(seconds), "-vf", f"fps={fps},scale={width}:-2", pattern]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"frame extraction failed: {r.stderr.strip()[:300]}")
    frames = []
    for p in sorted(Path(outdir).glob("f*.png")):
        with Image.open(p) as im:
            frames.append(np.asarray(im.convert("RGB"), dtype=np.float32))
    return frames


def box_blur(a, radius):
    """Separable box blur over the first two axes (channels preserved)."""
    if radius <= 0:
        return a
    k = 2 * radius + 1
    pad = ((radius, radius), (radius, radius)) + ((0, 0),) * (a.ndim - 2)
    p = np.pad(a, pad, mode="edge")
    out = np.zeros_like(a)
    h, w = a.shape[0], a.shape[1]
    for dy in range(k):
        for dx in range(k):
            out += p[dy:dy + h, dx:dx + w]
    return out / (k * k)


def estimate_shift(prev_luma, cur_luma):
    """Global translation (dy, dx) between two luma frames via phase correlation."""
    a = prev_luma - prev_luma.mean()
    b = cur_luma - cur_luma.mean()
    fa = np.fft.fft2(a)
    fb = np.fft.fft2(b)
    cross = fa * np.conj(fb)
    cross /= np.abs(cross) + 1e-9
    corr = np.abs(np.fft.ifft2(cross))
    h, w = corr.shape
    iy, ix = np.unravel_index(int(np.argmax(corr)), corr.shape)
    dy = iy if iy < h // 2 else iy - h
    dx = ix if ix < w // 2 else ix - w
    return int(dy), int(dx)


def track(frames, fps):
    n = len(frames)
    if n < 4:
        return {"status": "too_few_frames", "samples": [],
                "summary": {"frames": n, "prominentRatio": 0.0}}
    h, w = frames[0].shape[:2]
    smooth = [box_blur(f, 2) for f in frames]
    margin_y = max(2, int(0.07 * h))
    margin_x = max(2, int(0.07 * w))
    samples = []
    energies = []
    prev_main = None
    pos_x = None
    vel_x = 0.0
    pending = 0
    rejected_jumps = 0
    for i in range(n):
        energy = np.zeros((h, w), dtype=np.float32)
        if i > 0:
            dy, dx = estimate_shift(smooth[i - 1].mean(axis=2), smooth[i].mean(axis=2))
            if abs(dx) <= int(w * 0.15) and abs(dy) <= int(h * 0.15):
                warped = np.roll(np.roll(smooth[i - 1], dy, axis=0), dx, axis=1)
                diff = np.abs(smooth[i] - warped).max(axis=2)
                core = diff[margin_y:h - margin_y, margin_x:w - margin_x]
                med = float(np.median(core))
                mad = float(np.median(np.abs(core - med)))
                threshold = med + 3.0 * mad
                e = np.maximum(0.0, diff - threshold)
                # Ignore the border: warping and compression artefacts live there.
                e[:margin_y, :] = 0.0
                e[h - margin_y:, :] = 0.0
                e[:, :margin_x] = 0.0
                e[:, w - margin_x:] = 0.0
                energy = box_blur(e[..., None], 2)[..., 0]
        energies.append(energy)
        total = float(energy.sum())
        t = round(i / fps, 3)
        if total <= 1e-6:
            samples.append({"t": t, "peakX": None, "peakY": None,
                            "prominence": 0.0, "mass": 0.0, "energy": 0.0,
                            "spanLo": None, "spanHi": None,
                            "coreLo": None, "coreHi": None,
                            "mainX": None, "mainLo": None, "mainHi": None,
                            "mainShare": 0.0})
            continue
        peak_flat = int(np.argmax(energy))
        py, px = divmod(peak_flat, w)
        prominence = float(energy.max() / (energy.mean() + 1e-9))
        col = energy.sum(axis=0)
        cum = np.cumsum(col) / (col.sum() + 1e-9)
        span_lo = float(np.searchsorted(cum, 0.05) / w)
        span_hi = float(np.searchsorted(cum, 0.95) / w)
        # Tighter 10-90% mass span: the "core subject" without the long tail
        # of scattered background motion. Used to decide whether a following
        # 9:16 window can hold the subject.
        core_lo = float(np.searchsorted(cum, 0.10) / w)
        core_hi = float(np.searchsorted(cum, 0.90) / w)
        # Main subject = strongest contiguous run of the column-energy profile.
        # This is the thing the framing must never cut; secondary motion (a
        # second animal, wind in the grass) may legitimately leave frame.
        smooth_col = np.convolve(col, np.ones(5) / 5, mode="same")
        hi = float(smooth_col.max())
        above = smooth_col >= 0.5 * hi
        runs = []
        start = None
        for xi in range(w + 1):
            on = above[xi] if xi < w else False
            if on and start is None:
                start = xi
            elif not on and start is not None:
                seg = col[start:xi]
                runs.append((start, xi, float(seg.sum())))
                start = None
        # A moving object against a static background only produces residual at
        # its LEADING and TRAILING edges, so merge clusters separated by a small
        # gap into one subject before choosing - otherwise we would chase one
        # edge of the animal instead of the animal.
        merged = []
        for run in runs:
            if merged and (run[0] - merged[-1][1]) <= 0.12 * w:
                merged[-1] = (merged[-1][0], run[1], merged[-1][2] + run[2])
            else:
                merged.append(run)
        runs = merged
        # Choose the run to FOLLOW with temporal continuity: among plausible
        # subject clusters prefer the one nearest the previous main subject, so
        # the framing tracks one animal instead of oscillating between two.
        best = (0, 0, -1.0)
        if runs:
            if prev_main is None:
                best = max(runs, key=lambda r: r[2])
            else:
                def score(r):
                    centre = (r[0] + r[1]) / 2.0 / w
                    dist = abs(centre - prev_main)
                    return r[2] * float(np.exp(-(dist ** 2) / (2 * 0.25 ** 2)))
                best = max(runs, key=score)
            prev_main = (best[0] + best[1]) / 2.0 / w
        if best[2] > 0:
            m_lo, m_hi = best[0], best[1]
            seg = col[m_lo:m_hi]
            idx = np.arange(m_lo, m_hi)
            raw_x = float((idx * seg).sum() / (seg.sum() + 1e-9) / w)
            half = (m_hi - m_lo) / 2.0 / w
            main_share = float(best[2] / (col.sum() + 1e-9))
        else:
            raw_x, half, main_share = px / w, 0.0, 0.0
        # Temporal continuity via an alpha-beta (predictive) filter: it follows
        # constant-velocity subject motion with no steady-state lag (a plain
        # moving average lags behind a travelling subject, which would push the
        # crop behind the animal), while implausible single-frame jumps from
        # sensor noise or cluster re-selection are rejected outright.
        dt = 1.0 / fps
        if pos_x is None:
            pos_x, vel_x = raw_x, 0.0
        else:
            predicted = pos_x + vel_x * dt
            residual = raw_x - predicted
            if abs(residual) > 0.25:
                # Implausible single-frame jump: hold the prediction. If the new
                # position persists for three frames it is real motion, so
                # re-anchor instead of ignoring the subject.
                rejected_jumps += 1
                pending += 1
                pos_x = predicted
                if pending >= 3:
                    pos_x, vel_x, pending = raw_x, 0.0, 0
            else:
                pending = 0
                pos_x = predicted + 0.5 * residual
                vel_x = max(-0.6, min(0.6, vel_x + 0.25 * residual / dt))
        main_x = float(max(0.0, min(1.0, pos_x)))
        main_lo = max(0.0, main_x - half)
        main_hi = min(1.0, main_x + half)

        # Mass near the dominant peak (a +/-10% window around it).
        lo = int(max(0, px - 0.10 * w))
        hi = int(min(w, px + 0.10 * w))
        mass = float(col[lo:hi].sum() / (col.sum() + 1e-9))
        samples.append({"t": t, "peakX": round(px / w, 4), "peakY": round(py / h, 4),
                        "prominence": round(prominence, 3), "mass": round(mass, 3),
                        "energy": round(total, 2),
                        "spanLo": round(span_lo, 3), "spanHi": round(span_hi, 3),
                        "coreLo": round(core_lo, 3), "coreHi": round(core_hi, 3),
                        "mainX": round(main_x, 4), "mainLo": round(main_lo, 4),
                        "mainHi": round(main_hi, 4), "mainShare": round(main_share, 3)})
    usable = [s for s in samples if s["peakX"] is not None and s["prominence"] >= 1.6]
    summary = {
        "frames": n,
        "fps": fps,
        "usableFrames": len(usable),
        "usableRatio": round(len(usable) / n, 3),
        "peakRange": [round(min(s["peakX"] for s in usable), 3),
                      round(max(s["peakX"] for s in usable), 3)] if usable else None,
        "spanRange": [round(min(s["spanLo"] for s in usable), 3),
                      round(max(s["spanHi"] for s in usable), 3)] if usable else None,
        "coreSpanRange": [round(min(s["coreLo"] for s in usable), 3),
                          round(max(s["coreHi"] for s in usable), 3)] if usable else None,
        "mainRange": [round(min(s["mainX"] for s in usable), 3),
                      round(max(s["mainX"] for s in usable), 3)] if usable else None,
        "medianMainWidth": round(float(np.median([s["mainHi"] - s["mainLo"] for s in usable])), 3) if usable else 0.0,
        "medianMainShare": round(float(np.median([s["mainShare"] for s in usable])), 3) if usable else 0.0,
        "rejectedJumps": rejected_jumps,
        "medianProminence": round(float(np.median([s["prominence"] for s in usable])), 2) if usable else 0.0,
    }
    return {"status": "ok", "samples": samples, "summary": summary}


def main(argv):
    if len(argv) < 4:
        print(json.dumps({"status": "usage",
                          "detail": "track_subject.py <video> <start> <seconds> [--fps N] [--width N]"}))
        return 2
    video, start, seconds = argv[1], float(argv[2]), float(argv[3])
    fps, width = 8.0, 160
    for i, a in enumerate(argv):
        if a == "--fps":
            fps = float(argv[i + 1])
        elif a == "--width":
            width = int(argv[i + 1])
    try:
        with tempfile.TemporaryDirectory() as td:
            frames = extract(video, start, seconds, td, fps, width)
            result = track(frames, fps)
    except Exception as exc:  # noqa: BLE001 - reported, never guessed
        print(json.dumps({"status": "error", "detail": str(exc)[:300], "samples": []}))
        return 1
    result["seconds"] = seconds
    result["start"] = start
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
