import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { searchPixabayVideos, downloadPixabayVideo } from "../src/production/pixabay.js";

const sample = {
  totalHits: 1,
  hits: [{
    id: 42, duration: 8, pageURL: "https://pixabay.com/videos/person-speaking-42/",
    tags: "person,speaking", user: "Creator", userImageURL: "https://cdn.pixabay.com/user/creator.jpg",
    videos: {
      large: { url: "https://cdn.pixabay.com/video/2024/01/01/42-123456_large.mp4", width: 1920, height: 1080, size: 12345, thumbnail: "https://cdn.pixabay.com/video/preview.jpg" },
      medium: { url: "https://cdn.pixabay.com/video/2024/01/01/42-123456_medium.mp4", width: 1280, height: 720, size: 6789 }
    }
  }]
};

test("Pixabay search returns licensed video candidates with creator attribution", async () => {
  const result = await searchPixabayVideos({
    query: "person speaking", apiKey: "test-key",
    fetchImpl: async (url) => {
      assert.match(String(url), /api\/videos/);
      assert.match(String(url), /key=test-key/);
      assert.match(String(url), /q=person\+speaking/);
      return new Response(JSON.stringify(sample), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(result.status, "ok");
  assert.equal(result.provider, "pixabay");
  assert.equal(result.videos[0].sourceType, "licensed_stock");
  assert.equal(result.videos[0].license, "Pixabay Content License");
  assert.equal(result.videos[0].attribution.creator, "Creator");
  assert.equal(result.videos[0].file.width, 1920);
});


test("Pixabay search falls back to a smaller affordable variant", async () => {
  const oversized = structuredClone(sample);
  oversized.hits[0].videos.large.size = 150 * 1024 * 1024;
  const result = await searchPixabayVideos({
    query: "person speaking", apiKey: "test-key",
    fetchImpl: async () => new Response(JSON.stringify(oversized), { status: 200, headers: { "content-type": "application/json" } })
  });
  assert.equal(result.videos[0].file.width, 1280);
  assert.match(result.videos[0].file.url, /medium/);
});

test("Pixabay search fails closed when API key is absent", async () => {
  const result = await searchPixabayVideos({ query: "person", apiKey: "" });
  assert.equal(result.status, "not_configured");
  assert.deepEqual(result.videos, []);
});

test("Pixabay download enforces provider host, video content and byte limit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pixabay-"));
  const path = join(dir, "clip.mp4");
  try {
    const asset = (await searchPixabayVideos({
      query: "person", apiKey: "test-key",
      fetchImpl: async () => new Response(JSON.stringify(sample), { status: 200 })
    })).videos[0];
    const downloaded = await downloadPixabayVideo(asset, path, {
      fetchImpl: async () => new Response(new Uint8Array([0, 0, 0, 1]), { status: 200, headers: { "content-type": "video/mp4" } })
    });
    assert.equal(downloaded.status, "downloaded");
    assert.equal((await readFile(path)).byteLength, 4);
    await assert.rejects(downloadPixabayVideo({ ...asset, file: { url: "https://example.com/video.mp4" } }, join(dir, "bad.mp4")), /approved Pixabay/);
    await assert.rejects(downloadPixabayVideo(asset, join(dir, "large.mp4"), {
      maxBytes: 2, fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "video/mp4" } })
    }), /download limit/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
