// Private-only YouTube upload smoke test.
// Runs ONLY inside GitHub Actions with secrets present. Guards (all required):
//   SMOKE_UPLOAD_CONFIRM=true        (workflow_dispatch human confirmation)
//   HUMAN_APPROVED=true              (owner approval for THIS private test)
//   repurpose result status=completed with a posting package
//   OAuth channel == YOUTUBE_EXPECTED_CHANNEL_ID
// Privacy is hard-locked to "private"; public/unlisted are refused here.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { refreshYouTubeAccessToken, uploadYouTubeVideo, waitForYouTubeProcessing, getAuthorizedYouTubeChannel } from "../src/platforms/youtube/publisher.js";

if (process.env.SMOKE_UPLOAD_CONFIRM !== "true") throw new Error("Refused: SMOKE_UPLOAD_CONFIRM=true is required (explicit workflow_dispatch confirmation).");
if (process.env.HUMAN_APPROVED !== "true") throw new Error("Refused: HUMAN_APPROVED=true is required for this private upload test.");
if ((process.env.YOUTUBE_PUBLISH_PRIVACY ?? "private") !== "private") throw new Error("Refused: this smoke test uploads with PRIVATE visibility only.");

const resultPath = resolve(process.argv[2] ?? "output/real-landing/result.json");
const outPath = resolve(process.argv[3] ?? "output/real-landing/upload-smoke-result.json");
const result = JSON.parse(await readFile(resultPath, "utf8"));
if (result.status !== "completed" || !result.postingPackage || !result.outputPath) {
  throw new Error(`Refused: pipeline did not complete with a posting package (status=${result.status}). No upload attempted.`);
}
const pkg = result.postingPackage.platformPackages?.youtube_shorts;
if (!pkg?.title) throw new Error("Posting package has no YouTube title.");

const { accessToken } = await refreshYouTubeAccessToken();
const channel = await getAuthorizedYouTubeChannel({ accessToken });
const expected = process.env.YOUTUBE_EXPECTED_CHANNEL_ID ?? "";
if (!expected || channel.channelId !== expected) throw new Error(`Refused: authorized channel ${channel.channelId} does not match expected ${expected || "(unset)"}.`);

const description = [pkg.description, "", "Source: " + (pkg.source?.url ?? result.plan?.source?.sourceUrl ?? ""), "Uploaded as a PRIVATE automation smoke test. Not published."].join("\n").slice(0, 4500);
const uploaded = await uploadYouTubeVideo({
  videoPath: resolve(result.outputPath),
  accessToken,
  metadata: { title: pkg.title.slice(0, 95), description, tags: (pkg.hashtags ?? []).map((t) => t.replace(/^#/, "")).slice(0, 20), categoryId: "22", privacyStatus: "private", selfDeclaredMadeForKids: false }
});
const processing = await waitForYouTubeProcessing({ videoId: uploaded.videoId, accessToken, maxAttempts: 30, intervalMs: 15000 });

// Independent verification: re-read the video and confirm privacy + channel.
const verifyRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id=${uploaded.videoId}`, { headers: { authorization: `Bearer ${accessToken}` } });
const verifyPayload = await verifyRes.json().catch(() => ({}));
const video = verifyPayload.items?.[0];
const verified = Boolean(video) && video.status?.privacyStatus === "private" && video.snippet?.channelId === channel.channelId;

const report = {
  status: verified ? "uploaded_private_verified" : "uploaded_unverified",
  videoId: uploaded.videoId,
  watchUrl: uploaded.watchUrl,
  privacyStatus: video?.status?.privacyStatus ?? uploaded.privacyStatus,
  channelId: video?.snippet?.channelId ?? channel.channelId,
  channelTitle: channel.title,
  processingStatus: processing.processingStatus,
  title: pkg.title,
  uploadedAt: new Date().toISOString(),
  note: "Private smoke-test upload only. Not published, not monetized, no public visibility."
};
await writeFile(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!verified) process.exit(1);
