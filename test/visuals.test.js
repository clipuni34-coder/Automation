import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateGeminiImage, generateStoryboardAssets } from "../src/production/visuals.js";

const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(1200, 1)]).toString("base64");

test("Gemini image adapter requests portrait visuals and stores validated image bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "visual-gen-"));
  try {
    let body;
    const result = await generateGeminiImage({ prompt: "An illustrative science scene", outputPath: join(dir, "scene.png"), apiKey: "test-key", fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return { ok: true, json: async () => ({ output_image: { data: png, mime_type: "image/png" } }) };
    } });
    assert.equal(result.status, "generated");
    assert.equal(body.model, "gemini-nano-banana-2.1");
    assert.equal(body.response_format.aspect_ratio, "9:16");
    assert.equal((await readFile(result.path)).subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Gemini image adapter rejects malformed image payloads", async () => {
  await assert.rejects(generateGeminiImage({ prompt: "test", outputPath: "/tmp/not-image.png", apiKey: "test-key", fetchImpl: async () => ({ ok: true, json: async () => ({ output_image: { data: Buffer.from("not an image").toString("base64") } }) }) }), /empty or exceeds|not a valid/);
});

test("storyboard asset generator returns scene-by-scene image provenance", async () => {
  const dir = await mkdtemp(join(tmpdir(), "storyboard-"));
  try {
    const assets = await generateStoryboardAssets({ visualPlan: [{ visual: "A glowing planet" }, { visual: "A telescope" }], topic: "Astronomy", outputDir: dir, apiKey: "test-key", fetchImpl: async () => ({ ok: true, json: async () => ({ output_image: { data: png, mime_type: "image/png" } }) }) });
    assert.equal(assets.length, 2);
    assert.ok(assets.every(asset => asset.sourceType === "generated_visual" && asset.generationModel));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
