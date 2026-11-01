import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { refreshYouTubeAccessToken, getAuthorizedYouTubeChannel } from "./publisher.js";
import { fetchRecentCommentThreads, draftCommentReply } from "./comments.js";

const expectedChannelId = process.env.YOUTUBE_EXPECTED_CHANNEL_ID;
const outputPath = resolve(process.env.YOUTUBE_COMMENTS_PATH ?? "data/youtube-comment-inbox.json");
const maxResults = Number(process.env.YOUTUBE_COMMENTS_MAX_RESULTS ?? 50);

try {
  if (!expectedChannelId) throw new Error("YOUTUBE_EXPECTED_CHANNEL_ID is required.");
  const token = await refreshYouTubeAccessToken();
  const channel = await getAuthorizedYouTubeChannel({ accessToken: token.accessToken });
  if (channel.channelId !== expectedChannelId) {
    throw new Error("OAuth token is connected to a different YouTube channel; refusing to read its comments.");
  }
  const inbox = await fetchRecentCommentThreads({
    channelId: channel.channelId,
    accessToken: token.accessToken,
    maxResults
  });
  const drafts = inbox.comments.map(draftCommentReply);
  const result = {
    ...inbox,
    channel: { channelId: channel.channelId, title: channel.title },
    replyPolicy: "Drafts only. No public replies are posted by this workflow.",
    summary: {
      totalComments: inbox.comments.length,
      replyDrafts: drafts.filter(item => item.publicationStatus === "draft_only").length,
      heldForModeration: drafts.filter(item => item.publicationStatus === "not_published").length
    },
    replyDrafts: drafts
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ status: "saved", outputPath, ...result.summary }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", error: error.message }));
  process.exitCode = 1;
}
