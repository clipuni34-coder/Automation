// One-time, owner-requested metadata-only operation for the two public
// Primeplug Shorts observed on the channel. It NEVER uploads, deletes, changes
// privacy, or changes made-for-kids settings. It edits only snippet.description,
// preserving existing snippet fields with a concurrency guard and re-read.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { refreshYouTubeAccessToken, getAuthorizedYouTubeChannel } from "../src/platforms/youtube/publisher.js";
import { updateExistingPublicVideoHashtags } from "../src/platforms/youtube/hashtag-update.js";

const expectedChannelId = "UCB7EhjM0bj2wtIBy_A_kkkg";
const tasks = [
  { videoId: "KBHalqUmHxk", hashtags: ["#Shorts", "#Chiitan", "#FunnyFails", "#Mascot"] },
  { videoId: "dQwD_It3oXM", hashtags: ["#Shorts", "#BabyElephants", "#FunnyAnimals", "#Elephants"] }
];
if (process.env.HASHTAG_UPDATE_CONFIRM !== "true") throw new Error("Refused: explicit owner confirmation is required for this metadata-only hashtag update.");
if (process.env.YOUTUBE_EXPECTED_CHANNEL_ID !== expectedChannelId) throw new Error("Refused: configured target is not the expected Primeplug channel.");

const report = { channelId: expectedChannelId, generatedAt: new Date().toISOString(), purpose: "append_visible_hashtags_only", results: [] };
const reportPath = resolve(process.env.HASHTAG_UPDATE_REPORT ?? "output/hashtag-update/report.json");
let failed = false;
try {
  const { accessToken } = await refreshYouTubeAccessToken();
  const channel = await getAuthorizedYouTubeChannel({ accessToken });
  if (channel.channelId !== expectedChannelId) throw new Error("Refused: connected OAuth identity does not match Primeplug.");
  for (const task of tasks) {
    let result;
    try {
      result = await updateExistingPublicVideoHashtags({ ...task, expectedChannelId, accessToken });
    } catch (error) {
      result = { videoId: task.videoId, status: "read_or_validation_failed", reason: String(error?.message ?? error).slice(0, 200) };
    }
    report.results.push(result);
    if (!["updated_verified", "already_present"].includes(result.status)) {
      failed = true;
      // Stop rather than make another change after an error, uncertain update,
      // policy/identity failure, or unverified response.
      break;
    }
  }
} catch (error) {
  failed = true;
  report.error = String(error?.message ?? error).slice(0, 200);
}
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failed) process.exitCode = 1;
