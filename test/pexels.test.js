import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { searchPexelsVideos, downloadPexelsVideo } from "../src/production/pexels.js";

const sample = {
  videos: [{
    id: 42, duration: 8, url: "https://www.pexels.com/video/person-speaking-42/",
    image: "https://images.pexels.com/video-files/42/preview.jpg",
    width: 1080, height: 1920, user: { name: "Creator", url: "https://www.pexels.com/@creator" },
    video_files: [{ file_type: "video/mp4", width: 1080, height: 1920, link: "https://videos.pexels.com/video-files/42/video.mp4" }]
  }]
};

test("Pexels search returns real-video candidates with license and creator attribution", async () => {
  const result = await searchPexelsVideos({
    query: "person speaking", apiKey: "test-key",
    fetchImpl: async (url, options) => {
      assert.match(String(url), /videos\/search/);
      assert.equal(options.headers.Authorization, "test-key");
      return new Response(JSON.stringify(sample), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(result.status, "ok");
  assert.equal(result.videos[0].sourceType, "licensed_stock");
  assert.equal(result.videos[0].license, "Pexels License");
  assert.equal(result.videos[0].attribution.creator, "Creator");
});

test("Pexels search fails closed when API key is absent", async () => {
  const result = await searchPexelsVideos({ query: "person", apiKey: "" });
  assert.equal(result.status, "not_configured");
  assert.deepEqual(result.videos, []);
});

test("Pexels download enforces provider host, video content and byte limit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pexels-"));
  const path = join(dir, "clip.mp4");
  try {
    const asset = (await searchPexelsVideos({
      query: "person", apiKey: "test-key",
      fetchImpl: async () => new Response(JSON.stringify(sample), { status: 200 })
    })).videos[0];
    const downloaded = await downloadPexelsVideo(asset, path, {
      fetchImpl: async () => new Response(new Uint8Array([0, 0, 0, 1]), { status: 200, headers: { "content-type": "video/mp4" } })
    });
    assert.equal(downloaded.status, "downloaded");
    assert.equal((await readFile(path)).byteLength, 4);
    await assert.rejects(downloadPexelsVideo({ ...asset, file: { url: "https://example.com/video.mp4" } }, join(dir, "bad.mp4")), /approved Pexels/);
    await assert.rejects(downloadPexelsVideo(asset, join(dir, "large.mp4"), {
      maxBytes: 2, fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "video/mp4" } })
    }), /download limit/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
