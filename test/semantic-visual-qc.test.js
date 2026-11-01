import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewSceneVisualSemantics } from "../src/production/semantic-visual-qc.js";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(command + " exited " + code)));
  });
}

async function createSampleVideo(dir) {
  const video = join(dir, "sample.mp4");
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=320x240:d=2", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-y", video]);
  return video;
}

test("semantic visual review fails closed when no vision API key is configured", async () => {
  const result = await reviewSceneVisualSemantics({ scenes: [{ start: 0, end: 2 }] }, "/tmp/unused.mp4", { apiKey: "" });
  assert.equal(result.status, "unverified");
  assert.equal(result.reviewedScenes, 0);
  assert.match(result.warnings[0], /not configured/);
});

test("semantic visual review sends sampled scene frames and reports unrelated visuals", async () => {
  const dir = await mkdtemp(join(tmpdir(), "semantic-qc-"));
  try {
    const video = await createSampleVideo(dir);
    let request;
    const result = await reviewSceneVisualSemantics({
      scenes: [{ start: 0, end: 2, visualDescription: "A baseball catcher throwing a ball", narrationContext: "The catcher throws to second base." }]
    }, video, {
      apiKey: "test-key",
      fetchImpl: async (url, options) => {
        request = { url, body: JSON.parse(options.body), authorization: options.headers.authorization };
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ relevant: false, confidence: 0.98, observed: "A plain red frame", reason: "No baseball player or catcher is visible." }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });
    assert.equal(request.url, "https://api.openai.com/v1/chat/completions");
    assert.equal(request.authorization, "Bearer test-key");
    assert.equal(request.body.messages[1].content[1].image_url.detail, "low");
    assert.equal(result.status, "review");
    assert.equal(result.failedScenes, 1);
    assert.match(result.warnings[0], /failed semantic visual verification/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("OpenAI vision API errors are recorded without crashing the production pipeline", async () => {
  const dir = await mkdtemp(join(tmpdir(), "semantic-qc-error-"));
  try {
    const video = await createSampleVideo(dir);
    const result = await reviewSceneVisualSemantics({
      scenes: [{ start: 0, end: 2, visualDescription: "A basketball player dunking", narrationContext: "A player scores." }]
    }, video, {
      apiKey: "test-key",
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: "Quota exceeded" } }), { status: 429 })
    });
    assert.equal(result.status, "review");
    assert.equal(result.reviewedScenes, 1);
    assert.equal(result.failedScenes, 1);
    assert.match(result.scenes[0].description, /basketball player/);
    assert.match(result.scenes[0].error, /HTTP 429/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
