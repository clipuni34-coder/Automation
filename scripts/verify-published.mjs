// Independent verification of the published registry against the live
// YouTube API. For every video recorded in a channel's published.json,
// re-read it with that channel's OWN OAuth connection after verifying
// the channel identity, and report whether it still exists, is private,
// and belongs to the expected channel. This treats the registry as a
// claim and the API as the evidence — never the report as proof.
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { loadChannels } from "../src/config/channels.js";
import { openChannelState } from "../src/engine/state.js";
import { refreshYouTubeAccessToken, getAuthorizedYouTubeChannel } from "../src/platforms/youtube/publisher.js";

const stateRoot = resolve(process.env.STATE_DIR ?? "data/state");
const reportPath = resolve(process.env.VERIFY_REPORT ?? "output/publishing/verify-published.json");
const channels = await loadChannels(process.env.CHANNEL_PROFILES_PATH ?? "config/channels.json");
const report = { generatedAt: new Date().toISOString(), channels: [] };

for (const channel of channels) {
  const entry = { channelId: channel.id, status: "skipped", videos: [] };
  report.channels.push(entry);
  if (channel.status !== "connected" || !channel.youtubeChannelId) { entry.reason = "Not a connected channel"; continue; }
  const state = await openChannelState(stateRoot, channel.id);
  const published = (await state.getPublished()).videos;
  if (!published.length) { entry.status = "no_published_videos"; continue; }
  try {
    const { accessToken } = await refreshYouTubeAccessToken({ refreshToken: process.env[channel.refreshTokenEnv] || process.env.REFRESH_TOKEN });
    const identity = await getAuthorizedYouTubeChannel({ accessToken });
    entry.identity = { channelId: identity.channelId, title: identity.title };
    if (identity.channelId !== channel.youtubeChannelId) { entry.status = "blocked_identity_mismatch"; continue; }
    for (const video of published) {
      const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id=${video.videoId}`, { headers: { authorization: `Bearer ${accessToken}` } });
      const payload = await res.json().catch(() => ({}));
      const item = payload.items?.[0];
      entry.videos.push({
        videoId: video.videoId, candidateId: video.candidateId ?? null,
        exists: Boolean(item),
        privacyStatus: item?.status?.privacyStatus ?? null,
        channelId: item?.snippet?.channelId ?? null,
        titleOnYouTube: item?.snippet?.title ?? null,
        matchesRegistry: Boolean(item) && item.status?.privacyStatus === (video.privacyStatus ?? "private") && item.snippet?.channelId === channel.youtubeChannelId
      });
    }
    entry.status = entry.videos.every((v) => v.matchesRegistry) ? "all_verified" : "mismatch_found";
  } catch (error) {
    entry.status = "error";
    entry.reason = String(error?.message ?? error).slice(0, 300);
  }
}

await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
