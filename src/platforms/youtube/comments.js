const API = "https://www.googleapis.com/youtube/v3";

export async function fetchRecentCommentThreads({
  channelId,
  accessToken,
  maxResults = 50,
  pageToken = null,
  fetchImpl = fetch
} = {}) {
  if (!channelId || !accessToken) throw new Error("channelId and accessToken are required.");
  const limit = Math.max(1, Math.min(100, Number(maxResults) || 50));
  const url = new URL(API + "/commentThreads");
  url.searchParams.set("part", "snippet,replies");
  url.searchParams.set("allThreadsRelatedToChannelId", channelId);
  url.searchParams.set("maxResults", String(limit));
  url.searchParams.set("order", "time");
  url.searchParams.set("textFormat", "plainText");
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  const response = await fetchImpl(url, {
    headers: { authorization: "Bearer " + accessToken }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error("YouTube comment retrieval failed: HTTP " + response.status + ": " + (payload.error?.message ?? "unknown error"));
  }
  return {
    fetchedAt: new Date().toISOString(),
    channelId,
    nextPageToken: payload.nextPageToken ?? null,
    comments: (payload.items ?? []).map(thread => {
      const top = thread.snippet?.topLevelComment;
      const snippet = top?.snippet ?? {};
      return {
        threadId: thread.id,
        commentId: top?.id ?? null,
        videoId: thread.snippet?.videoId ?? null,
        author: snippet.authorDisplayName ?? "Viewer",
        authorChannelId: snippet.authorChannelId?.value ?? null,
        text: String(snippet.textOriginal ?? snippet.textDisplay ?? "").slice(0, 5000),
        publishedAt: snippet.publishedAt ?? null,
        likeCount: Number(snippet.likeCount ?? 0),
        totalReplyCount: Number(thread.snippet?.totalReplyCount ?? 0),
        canReply: Boolean(thread.snippet?.canReply ?? true),
        moderationStatus: snippet.moderationStatus ?? "unknown"
      };
    })
  };
}

const SPAM_PATTERNS = [
  /https?:\/\//i,
  /\b(?:telegram|whatsapp|crypto|forex|investment|giveaway|promo code)\b/i,
  /\b(?:dm me|message me|earn money|work from home)\b/i,
  /\b(?:sub4sub|subscribe to my channel|free subscribers)\b/i
];

export function draftCommentReply(comment = {}) {
  const text = String(comment.text ?? "").trim();
  const normalized = text.toLowerCase();
  const reasons = [];
  if (!text) reasons.push("empty_comment");
  if (SPAM_PATTERNS.some(pattern => pattern.test(text))) reasons.push("possible_spam_or_promotion");
  if (/(idiot|stupid|hate you|kill yourself|threat)/i.test(text)) reasons.push("abusive_or_threatening_language");
  if (reasons.length) {
    return {
      commentId: comment.commentId ?? null,
      videoId: comment.videoId ?? null,
      author: comment.author ?? "Viewer",
      classification: "hold_for_moderation",
      suggestedReply: null,
      reasons,
      publicationStatus: "not_published"
    };
  }
  const isQuestion = /\?/.test(text) || /^(how|what|why|when|where|who|can|does|is|are|do)\b/i.test(normalized);
  const isPraise = /\b(?:love|great|awesome|amazing|helpful|excellent|thank you|thanks)\b/i.test(normalized);
  const suggestedReply = isQuestion
    ? "Thanks for the question. I’ll check the details carefully before giving you a definite answer."
    : isPraise
      ? "Thanks for watching and sharing that. Glad you enjoyed it!"
      : "Thanks for joining the discussion. What part stood out to you most?";
  return {
    commentId: comment.commentId ?? null,
    videoId: comment.videoId ?? null,
    author: comment.author ?? "Viewer",
    classification: isQuestion ? "question" : isPraise ? "positive_feedback" : "general_discussion",
    suggestedReply,
    reasons: [],
    publicationStatus: "draft_only"
  };
}

export async function publishCommentReply({
  commentId,
  text,
  accessToken,
  allowPublicReply = false,
  fetchImpl = fetch
} = {}) {
  if (allowPublicReply !== true) throw new Error("Public comment replies are disabled until the channel owner explicitly enables them.");
  if (!commentId || !String(text ?? "").trim() || !accessToken) throw new Error("commentId, non-empty text and accessToken are required.");
  const response = await fetchImpl(API + "/comments?part=snippet", {
    method: "POST",
    headers: {
      authorization: "Bearer " + accessToken,
      "content-type": "application/json"
    },
    body: JSON.stringify({ snippet: { parentId: commentId, textOriginal: String(text).trim().slice(0, 10000) } })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.id) {
    throw new Error("YouTube comment reply failed: HTTP " + response.status + ": " + (payload.error?.message ?? "unknown error"));
  }
  return { status: "published", replyId: payload.id, parentCommentId: commentId };
}
