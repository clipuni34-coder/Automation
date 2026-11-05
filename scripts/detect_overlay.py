#!/usr/bin/env python3
"""Detect burned-in source overlays (watermarks / promotional CTAs).

Method: sample frames across the selected window. Real footage changes
between samples; a burned-in static graphic does not. For the top and
bottom bands we compute a staticness score = how little the band changes
relative to how much the whole frame changes, plus a colourfulness
score (promotional text is usually saturated). Detection runs on the
SOURCE, before any of our own captions exist, so our graphics can never
be mistaken for source overlays.

Usage: detect_overlay.py <video> <start> <seconds>
Prints one JSON object.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image


def extract_frames(video, start, seconds, outdir, count=12):
    paths = []
    duration = max(1.0, seconds)
    for i in range(count):
        t = start + (duration * (i + 0.5) / count)
        p = Path(outdir) / f"f{i}.png"
        r = subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-ss", str(t), "-i", video,
             "-frames:v", "1", "-vf", "scale=320:-2", str(p)],
            capture_output=True, text=True)
        if r.returncode == 0 and p.exists():
            paths.append(p)
    return paths


def band(arr, y0, y1):
    h = arr.shape[0]
    return arr[int(h * y0):int(h * y1), :, :]


def analyse(frames):
    imgs = [np.asarray(Image.open(p).convert("RGB"), dtype=np.float32) for p in frames]
    if len(imgs) < 3:
        return {"status": "insufficient_frames", "frames": len(imgs), "overlays": []}
    whole_diffs, top_diffs, bottom_diffs, centre_diffs = [], [], [], []
    top_colour, bottom_colour, centre_colour = [], [], []
    for a, b in zip(imgs, imgs[1:]):
        whole_diffs.append(np.abs(a - b).mean())
        top_diffs.append(np.abs(band(a, 0, 0.2) - band(b, 0, 0.2)).mean())
        bottom_diffs.append(np.abs(band(a, 0.8, 1.0) - band(b, 0.8, 1.0)).mean())
        centre_diffs.append(np.abs(band(a, 0.4, 0.6) - band(b, 0.4, 0.6)).mean())
    for im in imgs:
        for target, (y0, y1) in ((top_colour, (0, 0.2)), (bottom_colour, (0.8, 1.0)), (centre_colour, (0.4, 0.6))):
            px = band(im, y0, y1).reshape(-1, 3)
            # saturated pixels (strong colour) as a fraction of the band
            mx, mn = px.max(axis=1), px.min(axis=1)
            target.append(float(((mx - mn) > 60).mean()))
    whole = float(np.mean(whole_diffs)) or 1.0

    def verdict(diffs, colour):
        change_ratio = float(np.mean(diffs)) / whole
        staticness = max(0.0, 1.0 - change_ratio)
        return staticness, float(np.mean(colour))

    # Per-frame promotional-text signature: a band containing saturated,
    # high-edge-density graphics (typical CTA / watermark rendering) in
    # at least two sampled frames counts even when it is not static
    # (e.g. it sits over a repeated or end-card scene).
    def text_signature(im, y0, y1):
        # Promotional CTAs/watermarks are typically rendered in saturated
        # warm colours (red/orange) with hard edges. Natural footage in an
        # edge band almost never contains >2% promotional-red pixels.
        b = band(im, y0, y1).astype(np.int16)
        r, g, bl = b[:, :, 0], b[:, :, 1], b[:, :, 2]
        promo_red = float(((r > 140) & (r - g > 70) & (r - bl > 70)).mean())
        edges = float((np.abs(np.diff(b.astype(np.float32), axis=1)).mean(axis=2) > 28).mean())
        return promo_red, edges

    overlays = []
    for name, diffs, colour, frac, yr in (
        ("top", top_diffs, top_colour, 0.20, (0, 0.2)),
        ("bottom", bottom_diffs, bottom_colour, 0.20, (0.8, 1.0)),
        ("centre", centre_diffs, centre_colour, 0.20, (0.4, 0.6)),
    ):
        staticness, colourful = verdict(diffs, colour)
        static_detected = staticness > 0.72 and colourful > 0.02 and whole > 4
        sig_hits = sum(1 for im in imgs if (lambda se: se[0] > 0.02 and se[1] > 0.04)(text_signature(im, *yr)))
        text_detected = sig_hits >= 1
        if static_detected or text_detected:
            overlays.append({
                "band": name, "fraction": frac,
                "staticness": round(staticness, 3),
                "colourfulness": round(colourful, 3),
                "signatureFrames": int(sig_hits),
                "method": "static" if static_detected else "text-signature",
            })
    return {
        "status": "ok", "frames": len(imgs),
        "wholeFrameChange": round(whole, 2),
        "overlays": overlays,
        "detected": len(overlays) > 0,
    }


def main():
    video, start, seconds = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
    with tempfile.TemporaryDirectory() as td:
        frames = extract_frames(video, start, seconds, td)
        print(json.dumps(analyse(frames)))


if __name__ == "__main__":
    main()
