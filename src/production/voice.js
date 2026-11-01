import { writeFile } from "node:fs/promises";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const MODELS = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"];

function audioFromResponse(payload) {
  const direct = payload.output_audio?.data;
  if (direct) return direct;
  for (const step of payload.steps ?? []) {
    for (const item of step.content ?? []) {
      if (item.type === "audio" && item.data) return item.data;
    }
  }
  return null;
}

export async function generateNarration({
  text, outputPath = "narration.wav", style = "Natural, engaging, confident short-form documentary narrator. Clear diction, conversational pacing, expressive but not exaggerated.",
  voice = "Kore", apiKey = process.env.GEMINI_API_KEY ?? "", fetchImpl = fetch, timeoutMs = 120000
} = {}) {
  const narration = String(text ?? "").trim();
  if (!narration || narration.length < 20 || narration.length > 12000) {
    throw new Error("Narration text must contain between 20 and 12000 characters");
  }
  if (!apiKey) return { status: "not_configured", provider: "gemini", outputPath: null };
  const errors = [];
  for (const model of MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          model,
          input: [{
            type: "user_input",
            content: [{
              type: "text",
              text: narration,
              annotations: [{ type: "speech_metadata", style }]
            }]
          }],
          response_format: { type: "audio" },
          generation_config: { speech_config: [{ voice }] }
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        const message = "Gemini TTS " + model + " returned HTTP " + response.status + (detail ? ": " + detail.slice(0, 800) : "");
        if (response.status === 429 || /quota|resource_exhausted/i.test(detail)) throw new Error("TTS_QUOTA: " + message);
        errors.push(message);
        if (response.status !== 404 && response.status !== 400) break;
        continue;
      }
      const payload = await response.json();
      const encoded = audioFromResponse(payload);
      if (!encoded) throw new Error("Gemini TTS returned no audio payload");
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
        throw new Error("Gemini TTS output was not a valid WAV audio file");
      }
      await writeFile(outputPath, bytes, { mode: 0o600 });
      return { status: "generated", provider: "gemini", model, outputPath, bytes: bytes.length, format: "wav", voice };
    } catch (error) {
      if (error.message.startsWith("TTS_QUOTA:")) {
        if (model !== MODELS.at(-1)) { errors.push(error.message.slice(10)); continue; }
        throw new Error(error.message.slice(10));
      }
      if (error.name === "AbortError") errors.push("Gemini TTS request timed out");
      else if (!errors.includes(error.message)) errors.push(error.message);
      if (/quota|resource_exhausted/i.test(error.message)) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(errors.join("; ") || "Gemini TTS failed without a diagnostic");
}
