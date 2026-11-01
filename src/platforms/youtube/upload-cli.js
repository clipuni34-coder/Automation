import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { refreshYouTubeAccessToken, uploadYouTubeVideo, waitForYouTubeProcessing } from "./publisher.js";

const packagePath = process.argv[2];
if (!packagePath) {
  console.error("Usage: npm run youtube-upload -- <publishing-package.json>");
  process.exitCode = 1;
} else {
  try {
    if (process.env.YOUTUBE_AUTO_PUBLISH !== "true") throw new Error("Publishing is disabled. Set YOUTUBE_AUTO_PUBLISH=true only after channel OAuth and upload tests are complete.");
    const absolutePackagePath = resolve(packagePath);
    const pkg = JSON.parse(await readFile(absolutePackagePath, "utf8"));
    if (pkg.publication?.status !== "approved_for_upload" || pkg.publication?.manualApprovalRequired !== false) {
      throw new Error("Package is not approved for autonomous upload. It must pass the monetization preflight and editorial approval workflow first.");
    }
    if (pkg.quality?.visualQualityStatus !== "passed") throw new Error("Video quality status must be passed before upload.");
    const privacyStatus = process.env.YOUTUBE_PUBLISH_PRIVACY ?? "private";
    if (privacyStatus === "public" && process.env.YOUTUBE_ALLOW_PUBLIC_PUBLISH !== "true") {
      throw new Error("Public upload is disabled. Set YOUTUBE_ALLOW_PUBLIC_PUBLISH=true after completing an unlisted/private test.");
    }
    const videoPath = resolve(dirname(absolutePackagePath), pkg.video.path);
    const token = await refreshYouTubeAccessToken();
    const result = await uploadYouTubeVideo({
      videoPath,
      accessToken: token.accessToken,
      metadata: {
        ...pkg.platformPackages?.youtube_shorts,
        privacyStatus,
        categoryId: process.env.YOUTUBE_CATEGORY_ID ?? "22"
      }
    });
    const processing = await waitForYouTubeProcessing({ videoId: result.videoId, accessToken: token.accessToken });
    const completed = { ...result, ...processing, status: "processing_complete", processedAt: new Date().toISOString() };
    const outputPath = absolutePackagePath.replace(/\.json$/i, ".youtube-upload.json");
    await writeFile(outputPath, JSON.stringify(completed, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify({ ...completed, outputPath }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: "not_uploaded", error: error.message }));
    process.exitCode = 1;
  }
}
