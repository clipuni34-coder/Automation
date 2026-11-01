import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateNarration } from "../src/production/voice.js";

function fakeWav() {
  const bytes = Buffer.alloc(48);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(40, 4);
  bytes.write("WAVE", 8);
  bytes.write("fmt ", 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24000, 24);
  bytes.writeUInt32LE(48000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(4, 40);
  return bytes;
}

test("Gemini TTS saves returned WAV audio and sends style/voice controls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voice-"));
  const outputPath = join(dir, "voice.wav");
  let calls = 0;
  try {
    const result = await generateNarration({
      text: "This is a sufficiently long narration for the voice generation test.",
      outputPath, apiKey: "test-key",
      fetchImpl: async (url, options) => {
        calls += 1;
        assert.equal(String(url), "https://generativelanguage.googleapis.com/v1beta/interactions");
        assert.equal(options.headers["x-goog-api-key"], "test-key");
        const body = JSON.parse(options.body);
        assert.equal(body.model, "gemini-3.8-flash-tts");
        assert.equal(body.generation_config.speech_config[0].voice, "Kore");
        assert.equal(body.input[0].content[0].annotations[0].type, "speech_metadata");
        return new Response(JSON.stringify({ steps: [{ type: "model_output", content: [{ type: "audio", data: fakeWav().toString("base64") }] }] }), { status: 200 });
      }
    });
    assert.equal(result.status, "generated");
    assert.equal(calls, 1);
    assert.equal((await readFile(outputPath)).subarray(0, 4).toString(), "RIFF");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Gemini TTS falls back to lite model only for unavailable model responses", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voice-fallback-"));
  const models = [];
  try {
    const result = await generateNarration({
      text: "This is a sufficiently long narration for model fallback testing.",
      outputPath: join(dir, "voice.wav"), apiKey: "test-key",
      fetchImpl: async (_url, options) => {
        const model = JSON.parse(options.body).model;
        models.push(model);
        if (models.length === 1) return new Response("model not found", { status: 404 });
        return new Response(JSON.stringify({ output_audio: { data: fakeWav().toString("base64") } }), { status: 200 });
      }
    });
    assert.equal(result.model, "gemini-3.8-flash-lite-tts");
    assert.deepEqual(models, ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Gemini TTS fails closed without a key and does not retry quota failures", async () => {
  const missing = await generateNarration({ text: "This is a sufficiently long narration for missing key testing.", apiKey: "" });
  assert.equal(missing.status, "not_configured");
  let calls = 0;
  await assert.rejects(generateNarration({
    text: "This is a sufficiently long narration for quota error testing.",
    outputPath: join(tmpdir(), "unused-voice-quota.wav"), apiKey: "test-key",
    fetchImpl: async () => { calls += 1; return new Response("quota exceeded", { status: 429 }); }
  }), /quota exceeded/i);
  assert.equal(calls, 1);
});
