import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshYouTubeAccessToken, uploadYouTubeVideo } from "../src/platforms/youtube/publisher.js";

test("refreshes a YouTube OAuth access token without exposing credentials", async () => {
  let request;
  const result = await refreshYouTubeAccessToken({
    clientId: "client-id", clientSecret: "client-secret", refreshToken: "refresh-token",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ access_token: "access-token", expires_in: 3600 }) };
    }
  });
  assert.equal(result.accessToken, "access-token");
  assert.match(request.url, /oauth2.googleapis.com/);
  assert.match(String(request.options.body), /grant_type=refresh_token/);
});

test("refreshes a YouTube OAuth access token when the client has no secret", async () => {
  let request;
  const result = await refreshYouTubeAccessToken({
    clientId: "public-client-id", refreshToken: "refresh-token",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ access_token: "access-token", expires_in: 3600 }) };
    }
  });
  assert.equal(result.accessToken, "access-token");
  assert.match(String(request.options.body), /client_id=public-client-id/);
  assert.doesNotMatch(String(request.options.body), /client_secret/);
});

test("uploads MP4 through the official resumable upload flow", async () => {
  const dir = await mkdtemp(join(tmpdir(), "youtube-upload-"));
  try {
    const videoPath = join(dir, "short.mp4");
    await writeFile(videoPath, Buffer.from("fake-mp4-content"));
    const calls = [];
    const result = await uploadYouTubeVideo({
      videoPath,
      accessToken: "test-access-token",
      metadata: { title: "Original short", description: "Test description", tags: ["test"], privacyStatus: "unlisted" },
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (calls.length === 1) return {
          ok: true,
          headers: { get: key => key.toLowerCase() === "location" ? "https://www.googleapis.com/upload/youtube/v3/videos/session/abc" : null },
          text: async () => ""
        };
        return {
          ok: true,
          json: async () => ({ id: "video123", status: { privacyStatus: "unlisted", uploadStatus: "uploaded" }, snippet: { channelId: "channel123" } })
        };
      }
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[1].options.method, "PUT");
    assert.equal(result.videoId, "video123");
    assert.equal(result.privacyStatus, "unlisted");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects invalid resumable upload URLs and oversized media", async () => {
  const dir = await mkdtemp(join(tmpdir(), "youtube-upload-"));
  try {
    const videoPath = join(dir, "short.mp4");
    await writeFile(videoPath, "data");
    await assert.rejects(uploadYouTubeVideo({
      videoPath, accessToken: "token", metadata: { title: "x" },
      fetchImpl: async () => ({ ok: true, headers: { get: () => "https://example.com/not-youtube" } })
    }), /valid resumable upload URL/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("polls until YouTube confirms video processing succeeded", async () => {
  let attempts = 0;
  const result = await (await import("../src/platforms/youtube/publisher.js")).waitForYouTubeProcessing({
    videoId: "video123", accessToken: "token", maxAttempts: 3, intervalMs: 0, sleep: async () => {},
    fetchImpl: async () => {
      attempts += 1;
      const processingStatus = attempts < 2 ? "processing" : "succeeded";
      return { ok: true, json: async () => ({ items: [{ status: { uploadStatus: "processed", privacyStatus: "unlisted" }, processingDetails: { processingStatus } }] }) };
    }
  });
  assert.equal(attempts, 2);
  assert.equal(result.processingStatus, "succeeded");
  assert.equal(result.privacyStatus, "unlisted");
});

test("does not report failed YouTube processing as success", async () => {
  const { waitForYouTubeProcessing } = await import("../src/platforms/youtube/publisher.js");
  await assert.rejects(waitForYouTubeProcessing({
    videoId: "bad", accessToken: "token",
    fetchImpl: async () => ({ ok: true, json: async () => ({ items: [{ processingDetails: { processingStatus: "failed" } }] }) })
  }), /processing ended with status: failed/);
});

test("verifies the OAuth-connected YouTube channel before publishing", async () => {
  const { getAuthorizedYouTubeChannel } = await import("../src/platforms/youtube/publisher.js");
  const result = await getAuthorizedYouTubeChannel({
    accessToken: "token",
    fetchImpl: async url => {
      assert.match(String(url), /channels\?part=id%2Csnippet&mine=true/);
      return { ok: true, json: async () => ({ items: [{ id: "UCexpected", snippet: { title: "My channel" } }] }) };
    }
  });
  assert.deepEqual(result, { channelId: "UCexpected", title: "My channel" });
});

test("refuses ambiguous OAuth channel identity", async () => {
  const { getAuthorizedYouTubeChannel } = await import("../src/platforms/youtube/publisher.js");
  await assert.rejects(getAuthorizedYouTubeChannel({
    accessToken: "token",
    fetchImpl: async () => ({ ok: true, json: async () => ({ items: [] }) })
  }), /Expected exactly one authorized YouTube channel/);
});
