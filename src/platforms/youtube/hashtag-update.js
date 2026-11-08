import { appendVisibleHashtags } from "./hashtags.js";
import { observedAudienceStatus } from "./audience.js";

const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";

async function readVideo({ videoId, accessToken, fetchImpl }) {
  const url = new URL(VIDEOS_URL);
  url.searchParams.set("part", "snippet,status");
  url.searchParams.set("id", videoId);
  const response = await fetchImpl(url, { headers: { authorization: `Bearer ${accessToken}` } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Could not read the existing video: HTTP ${response.status}`);
  const item = payload.items?.[0];
  if (!item || item.id !== videoId) throw new Error("YouTube did not return the requested video.");
  return item;
}

// Modify only an existing public video's description after reading it from
// the channel owner's API. The caller must restrict the list of video IDs.
// This intentionally NEVER includes `status` in the update's part or body,
// so privacy and made-for-kids fields are not written. All currently documented
// writable snippet fields are copied verbatim except the appended hashtags.
// If-Match prevents overwriting a concurrent edit; missing ETag fails closed.
export async function updateExistingPublicVideoHashtags({ videoId, expectedChannelId, hashtags, accessToken, fetchImpl = fetch } = {}) {
  if (!videoId || !expectedChannelId || !accessToken) throw new Error("Video, expected channel and OAuth access are required.");
  const before = await readVideo({ videoId, accessToken, fetchImpl });
  const snippet = before.snippet ?? {};
  const beforeAudience = observedAudienceStatus(before.status);
  const base = {
    videoId,
    privacyBefore: before.status?.privacyStatus ?? null,
    audienceBefore: beforeAudience,
    addedHashtags: []
  };
  if (snippet.channelId !== expectedChannelId) return { ...base, status: "blocked_channel_mismatch" };
  if (base.privacyBefore !== "public") return { ...base, status: "blocked_not_public" };
  if (!before.etag || !snippet.title || !snippet.categoryId) return { ...base, status: "blocked_incomplete_metadata" };
  if (snippet.tags !== undefined && !Array.isArray(snippet.tags)) return { ...base, status: "blocked_incomplete_metadata" };
  const result = appendVisibleHashtags(snippet.description ?? "", hashtags);
  if (!result.added.length) return { ...base, status: result.reason === "existing_hashtag_limit" ? "no_space_for_more_hashtags" : "already_present" };

  const writable = {
    title: snippet.title,
    categoryId: snippet.categoryId,
    description: result.description,
    ...(snippet.tags !== undefined ? { tags: snippet.tags } : {}),
    ...(snippet.defaultLanguage !== undefined ? { defaultLanguage: snippet.defaultLanguage } : {})
  };
  const update = new URL(VIDEOS_URL);
  update.searchParams.set("part", "snippet");
  let response;
  try {
    response = await fetchImpl(update, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json; charset=UTF-8",
        "if-match": before.etag
      },
      body: JSON.stringify({ id: videoId, snippet: writable })
    });
  } catch {
    // A network error after sending may still have applied the update.
    // Never assume it failed or automatically retry a state-changing call.
    return { ...base, status: "update_outcome_unknown", reason: "The update request did not return a response; check the current description before retrying." };
  }
  if (!response.ok) return { ...base, status: response.status === 412 ? "blocked_concurrent_edit" : "update_failed", httpStatus: response.status };

  let after;
  try {
    after = await readVideo({ videoId, accessToken, fetchImpl });
  } catch {
    return { ...base, addedHashtags: result.added, status: "updated_unverified", reason: "Update returned success, but the independent re-read failed." };
  }
  const afterSnippet = after.snippet ?? {};
  const afterAudience = observedAudienceStatus(after.status);
  const expectedTags = snippet.tags ?? [];
  const afterTags = afterSnippet.tags ?? [];
  const unchanged = afterSnippet.channelId === expectedChannelId
    && afterSnippet.title === snippet.title
    && afterSnippet.categoryId === snippet.categoryId
    && afterSnippet.defaultLanguage === snippet.defaultLanguage
    && JSON.stringify(afterTags) === JSON.stringify(expectedTags)
    && after.status?.privacyStatus === base.privacyBefore
    && (beforeAudience.madeForKids === null || afterAudience.madeForKids === beforeAudience.madeForKids)
    && (beforeAudience.selfDeclaredMadeForKids === null || afterAudience.selfDeclaredMadeForKids === beforeAudience.selfDeclaredMadeForKids);
  const descriptionMatches = afterSnippet.description === result.description;
  return {
    ...base,
    addedHashtags: result.added,
    privacyAfter: after.status?.privacyStatus ?? null,
    audienceAfter: afterAudience,
    status: unchanged && descriptionMatches ? "updated_verified" : "updated_unverified",
    ...(!(unchanged && descriptionMatches) ? { reason: "The independent re-read did not confirm the expected description and unchanged metadata." } : {})
  };
}
