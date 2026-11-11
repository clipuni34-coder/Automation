import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NARRATION_AUDIO_FILTER } from "../src/production/audio-filter.js";
import { parseVolumedetect } from "../src/production/advanced-qc.js";

function waveWithPeaks() {
  const rate = 48000, count = 5 * rate, body = Buffer.alloc(count * 2), out = Buffer.alloc(44 + body.length);
  for (let i = 0; i < count; i++) {
    const tone = 0.12 * Math.sin(2 * Math.PI * 440 * i / rate);
    const transient = i % rate < 240 ? 0.75 * Math.sin(2 * Math.PI * 1800 * i / rate) : 0;
    body.writeInt16LE(Math.round(Math.max(-1, Math.min(1, tone + transient)) * 32767), i * 2);
  }
  out.write("RIFF", 0); out.writeUInt32LE(out.length - 8, 4); out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write("data", 36); out.writeUInt32LE(body.length, 40); body.copy(out, 44);
  return out;
}

test("normalisation plus limiter retains audible AAC narration headroom and timing", async (t) => {
  if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0) return t.skip("ffmpeg is unavailable");
  const root = await mkdtemp(join(tmpdir(), "narration-limiter-"));
  try {
    const wav = join(root, "input.wav"), aac = join(root, "output.m4a");
    await writeFile(wav, waveWithPeaks());
    const encode = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", wav, "-af", NARRATION_AUDIO_FILTER, "-c:a", "aac", aac], { encoding: "utf8", timeout: 60000 });
    assert.equal(encode.status, 0, encode.stderr);
    const vol = spawnSync("ffmpeg", ["-hide_banner", "-i", aac, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8", timeout: 60000 });
    assert.equal(vol.status, 0, vol.stderr);
    const { meanDb, maxDb } = parseVolumedetect(vol.stderr);
    assert.ok(meanDb >= -22 && meanDb <= -8, `mean ${meanDb} dB must satisfy existing audibility QC`);
    assert.ok(maxDb <= -0.3, `encoded peak ${maxDb} dB must satisfy existing no-clipping QC`);
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", aac], { encoding: "utf8" });
    assert.equal(probe.status, 0);
    assert.ok(Math.abs(Number(probe.stdout.trim()) - 5) < 0.1, "limiter must not shift/extend narration timing materially");
  } finally { await rm(root, { recursive: true, force: true }); }
});
