import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateGeminiImage, generateStoryboardAssets, generateOriginalGraphic } from "../src/production/visuals.js";

const jpeg = Buffer.concat([Buffer.from([255,216,255]), Buffer.alloc(1200, 1)]).toString("base64");

test("Gemini image adapter requests portrait visuals and stores validated image bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "visual-gen-"));
  try {
    let body;
    const result = await generateGeminiImage({ prompt: "An illustrative science scene", outputPath: join(dir, "scene.png"), apiKey: "test-key", fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return { ok: true, json: async () => ({ output_image: { data: jpeg, mime_type: "image/jpeg" } }) };
    } });
    assert.equal(result.status, "generated");
    assert.equal(body.model, "gemini-nano-banana-2.1");
    assert.equal(body.response_format.aspect_ratio, "9:16");
    assert.equal((await readFile(result.path)).subarray(0, 3).toString("hex"), "ffd8ff");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Gemini image adapter rejects malformed image payloads", async () => {
  await assert.rejects(generateGeminiImage({ prompt: "test", outputPath: "/tmp/not-image.png", apiKey: "test-key", fetchImpl: async () => ({ ok: true, json: async () => ({ output_image: { data: Buffer.from("not an image").toString("base64") } }) }) }), /empty or exceeds|not a valid/);
});

test("storyboard asset generator returns scene-by-scene image provenance", async () => {
  const dir = await mkdtemp(join(tmpdir(), "storyboard-"));
  try {
    const assets = await generateStoryboardAssets({ visualPlan: [{ visual: "A glowing planet" }, { visual: "A telescope" }], topic: "Astronomy", outputDir: dir, apiKey: "test-key", fetchImpl: async () => ({ ok: true, json: async () => ({ output_image: { data: jpeg, mime_type: "image/jpeg" } }) }) });
    assert.equal(assets.length, 2);
    assert.ok(assets.every(asset => asset.sourceType === "generated_visual" && asset.generationModel));
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test("storyboard falls back to locally generated original graphics when no visual API is configured", async () => {
  const dir = await mkdtemp(join(tmpdir(), "storyboard-fallback-"));
  try {
    const assets = await generateStoryboardAssets({
      visualPlan: [{ visual: "A dramatic reveal" }, { visual: "A surprising result" }],
      topic: "Test topic",
      outputDir: dir,
      apiKey: "",
      pixabayApiKey: ""
    });
    assert.equal(assets.length, 2);
    assert.ok(assets.every(asset => asset.sourceType === "original_graphic"));
    const header = (await readFile(assets[0].imagePath)).subarray(0, 2).toString("ascii");
    assert.equal(header, "P6");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("local original graphic generator writes a valid PPM image", async () => {
  const dir = await mkdtemp(join(tmpdir(), "local-graphic-"));
  try {
    const result = await generateOriginalGraphic({ outputPath: join(dir, "scene.png"), sceneIndex: 3 });
    const bytes = await readFile(result.path);
    assert.equal(result.provider, "local-graphics");
    assert.equal(bytes.subarray(0, 2).toString("ascii"), "P6");
    assert.ok(bytes.length > 1000000);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test("storyboard stops retrying Gemini after a quota response", async () => {
  const dir = await mkdtemp(join(tmpdir(), "storyboard-quota-"));
  try {
    let calls = 0;
    const assets = await generateStoryboardAssets({
      visualPlan: [{ visual: "Scene one" }, { visual: "Scene two" }, { visual: "Scene three" }],
      topic: "Test topic",
      outputDir: dir,
      apiKey: "test-key",
      pixabayApiKey: "",
      fetchImpl: async () => {
        calls += 1;
        return { ok: false, status: 429, text: async () => "RESOURCE_EXHAUSTED: quota exceeded" };
      }
    });
    assert.equal(calls, 1);
    assert.equal(assets.length, 3);
    assert.ok(assets.every(asset => asset.sourceType === "original_graphic"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
