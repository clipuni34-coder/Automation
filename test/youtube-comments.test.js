import test from "node:test";
import assert from "node:assert/strict";
import { fetchRecentCommentThreads, draftCommentReply, publishCommentReply } from "../src/platforms/youtube/comments.js";

test("fetches channel comment threads with the official API and maps safe inbox fields", async () => {
  let requestUrl;
  const result = await fetchRecentCommentThreads({
    channelId: "UC123", accessToken: "token", maxResults: 20,
    fetchImpl: async (url, options) => {
      requestUrl = new URL(url);
      assert.equal(options.headers.authorization, "Bearer token");
      return {
        ok: true,
        json: async () => ({ items: [{
          id: "thread-1",
          snippet: {
            videoId: "video-1",
            totalReplyCount: 2,
            canReply: true,
            topLevelComment: {
              id: "comment-1",
              snippet: {
                authorDisplayName: "Viewer",
                authorChannelId: { value: "UCviewer" },
                textOriginal: "Why does this happen?",
                publishedAt: "2026-11-01T10:00:00Z",
                likeCount: 3
              }
            }
          }
        }] })
      };
    }
  });
  assert.equal(requestUrl.pathname, "/youtube/v3/commentThreads");
  assert.equal(requestUrl.searchParams.get("allThreadsRelatedToChannelId"), "UC123");
  assert.equal(requestUrl.searchParams.get("maxResults"), "20");
  assert.equal(result.comments[0].commentId, "comment-1");
  assert.equal(result.comments[0].text, "Why does this happen?");
  assert.equal(result.comments[0].totalReplyCount, 2);
});

test("creates cautious reply drafts and holds spam or abusive comments", () => {
  const question = draftCommentReply({ commentId: "q1", text: "Why does the sky look blue?" });
  assert.equal(question.classification, "question");
  assert.equal(question.publicationStatus, "draft_only");
  assert.match(question.suggestedReply, /check the details/);

  const praise = draftCommentReply({ commentId: "p1", text: "Amazing video, thanks!" });
  assert.equal(praise.classification, "positive_feedback");
  assert.equal(praise.publicationStatus, "draft_only");

  const spam = draftCommentReply({ commentId: "s1", text: "DM me on Telegram for crypto profits https://spam.example" });
  assert.equal(spam.classification, "hold_for_moderation");
  assert.equal(spam.suggestedReply, null);

  const abuse = draftCommentReply({ commentId: "a1", text: "I hate you, idiot" });
  assert.equal(abuse.classification, "hold_for_moderation");
});

test("never publishes a public reply without explicit owner opt-in", async () => {
  await assert.rejects(
    publishCommentReply({ commentId: "comment-1", text: "Thanks!", accessToken: "token" }),
    /explicitly enables/
  );
});

test("publishes a reply only when explicitly enabled and confirms the returned ID", async () => {
  let request;
  const result = await publishCommentReply({
    commentId: "comment-1", text: "Thanks for watching!", accessToken: "token", allowPublicReply: true,
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ id: "reply-1" }) };
    }
  });
  assert.equal(request.url, "https://www.googleapis.com/youtube/v3/comments?part=snippet");
  assert.equal(request.options.method, "POST");
  assert.equal(request.body.snippet.parentId, "comment-1");
  assert.equal(result.replyId, "reply-1");
  assert.equal(result.status, "published");
});
