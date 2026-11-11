// Opt-in hosted Gemini voice probe. Uses a fixed non-private sentence, does
// not use a local fallback, never uploads, and deletes its temporary audio.
// This may consume provider quota or incur a charge; dispatch only with
// explicit authorization. A successful test does not approve a voice for a
// particular video or prove the complete production pipeline works.
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateNarration, SHORT_FORM_NARRATION_STYLE } from "../src/production/voice.js";

const endpoint = "https://generativelanguage.googleapis.com/v1beta/interactions";
const apiKey = process.env.GEMINI_API_KEY ?? "";
function inspectWav(buffer) {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") return null;
  const end = buffer.readUInt32LE(4) + 8;
  if (end !== buffer.length) return null;
  let offset = 12, fmt = null, data = null;
  while (offset < end) {
    if (offset + 8 > end) return null;
    const id = buffer.toString("ascii", offset, offset + 4), size = buffer.readUInt32LE(offset + 4), start = offset + 8;
    if (size > end - start || start + size + (size % 2) > end) return null;
    if (id === "fmt ") {
      if (fmt || size < 16) return null;
      const format = buffer.readUInt16LE(start), channels = buffer.readUInt16LE(start + 2), sampleRate = buffer.readUInt32LE(start + 4);
      const byteRate = buffer.readUInt32LE(start + 8), align = buffer.readUInt16LE(start + 12), bits = buffer.readUInt16LE(start + 14);
      if (!((format === 1 && [16, 24, 32].includes(bits)) || (format === 3 && bits === 32))
          || channels < 1 || channels > 2 || sampleRate < 8000 || sampleRate > 96000
          || align !== channels * bits / 8 || byteRate !== sampleRate * align) return null;
      fmt = { format, bits, align, byteRate };
    }
    if (id === "data") {
      if (data || !size) return null;
      data = { start, size };
    }
    offset = start + size + (size % 2);
  }
  if (!fmt || !data || data.size % fmt.align !== 0) return null;
  const seconds = data.size / fmt.byteRate, step = fmt.bits / 8;
  let peak = 0, sumSquares = 0, audibleSamples = 0, count = 0;
  for (let index = data.start; index < data.start + data.size; index += step) {
    const sample = fmt.format === 3 ? buffer.readFloatLE(index) : buffer.readIntLE(index, step) / (2 ** (fmt.bits - 1));
    if (!Number.isFinite(sample) || Math.abs(sample) > 1) return null;
    const magnitude = Math.abs(sample);
    peak = Math.max(peak, magnitude); sumSquares += sample * sample; count++;
    if (magnitude >= 0.001) audibleSamples++;
  }
  const rms = count ? Math.sqrt(sumSquares / count) : 0;
  // Reject structural/silent output. Non-silence is NOT proof of intelligible
  // speech, good delivery or per-video approval; those still require review.
  return { seconds, nonSilent: peak >= 0.001 && rms >= 0.0001 && audibleSamples >= count * 0.001 };
}

if (process.env.PRIMEPLUG_VOICE_CHECK_AUTHORIZED !== "true") {
  console.error(JSON.stringify({ status: "held", category: "voice_probe_not_authorized", uploadAttempted: false }));
  process.exitCode = 1;
} else if (!apiKey) {
  console.error(JSON.stringify({ status: "held", category: "hosted_voice_not_configured", uploadAttempted: false }));
  process.exitCode = 1;
} else {
  const dir = await mkdtemp(join(tmpdir(), "primeplug-voice-check-"));
  let success = null;
  try {
    const safeFetch = async (value, options = {}) => {
      if (String(value) !== endpoint) throw new Error("Unexpected voice probe destination.");
      return fetch(value, { ...options, redirect: "error" });
    };
    const path = join(dir, "check.wav");
    const result = await generateNarration({ text: "This is a brief diagnostic voice check for the production pipeline.", outputPath: path,
      style: SHORT_FORM_NARRATION_STYLE, apiKey, fetchImpl: safeFetch, localGenerator: async () => ({ status: "not_configured" }) });
    if (result.status !== "generated" || result.provider !== "gemini") throw new Error("Hosted voice did not generate audio.");
    const file = await stat(path);
    if (!file.isFile() || file.size < 44 || file.size > 20 * 1024 * 1024) throw new Error("Invalid audio size.");
    const audio = inspectWav(await readFile(path));
    if (!audio || !(audio.seconds >= 0.5 && audio.seconds <= 30) || !audio.nonSilent) throw new Error("Invalid, silent or out-of-range WAV audio.");
    success = { status: "hosted_voice_generated", provider: "gemini", model: result.model, durationSeconds: Number(audio.seconds.toFixed(2)),
      uploadAttempted: false, videoVoiceApproved: false, note: "Provider probe only: non-silence does not prove intelligibility or delivery. The test audio is deleted; the actual voice still needs per-video editorial review." };
  } catch (error) {
    const message = String(error?.message ?? "");
    const category = /quota|resource_exhausted|\b429\b/i.test(message) ? "quota_or_rate_limit" : "unavailable_or_invalid_audio";
    console.error(JSON.stringify({ status: "held", category, uploadAttempted: false,
      note: "Hosted voice did not pass the probe. Provider messages and credential values are not logged." }));
    process.exitCode = 1;
  } finally {
    try { await rm(dir, { recursive: true, force: true }); }
    catch {
      success = null;
      console.error(JSON.stringify({ status: "held", category: "temporary_audio_cleanup_failed", uploadAttempted: false }));
      process.exitCode = 1;
    }
  }
  if (success) console.log(JSON.stringify(success));
}
