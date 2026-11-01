import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/youtube/v3/videos";

export async function refreshYouTubeAccessToken({
  clientId = process.env.YOUTUBE_CLIENT_ID,
  clientSecret = process.env.YOUTUBE_CLIENT_SECRET,
  refreshToken = process.env.YOUTUBE_REFRESH_TOKEN,
  fetchImpl = fetch
} = {}) {
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("YouTube OAuth is not configured: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET and YOUTUBE_REFRESH_TOKEN are required.");
  }
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const reason = payload.error_description ?? payload.error ?? `HTTP ${response.status}`;
    throw new Error(`YouTube OAuth token refresh failed: ${reason}`);
  }
  return { accessToken: payload.access_token, expiresIn: payload.expires_in ?? null, tokenType: payload.token_type ?? "Bearer" };
}

function validateMetadata(metadata) {
  const title = String(metadata?.title ?? "").trim();
  const description = String(metadata?.description ?? "").trim();
  if (!title || title.length > 100) throw new Error("YouTube title must contain 1–100 characters.");
  if (description.length > 5000) throw new Error("YouTube description exceeds 5,000 characters.");
  const privacyStatus = metadata?.privacyStatus ?? "private";
  if (!["private", "unlisted", "public"].includes(privacyStatus)) throw new Error("Invalid YouTube privacy status.");
  const tags = Array.isArray(metadata?.tags) ? metadata.tags.map(tag => String(tag).trim()).filter(Boolean).slice(0, 30) : [];
  return {
    snippet: {
      title,
      description,
      tags,
      categoryId: String(metadata?.categoryId ?? "22")
    },
    status: {
      privacyStatus,
      ...(typeof metadata?.selfDeclaredMadeForKids === "boolean" ? { selfDeclaredMadeForKids: metadata.selfDeclaredMadeForKids } : {})
    }
  };
}

export async function uploadYouTubeVideo({
  videoPath,
  metadata,
  accessToken,
  fetchImpl = fetch
} = {}) {
  if (!videoPath || !accessToken) throw new Error("videoPath and accessToken are required.");
  const file = await stat(videoPath);
  if (!file.isFile() || file.size <= 0) throw new Error("The upload file is missing or empty.");
  if (file.size > 256 * 1024 * 1024) throw new Error("Video exceeds this workflow's 256MB upload safety limit.");
  const resource = validateMetadata(metadata);
  const init = await fetchImpl(`${UPLOAD_ENDPOINT}?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": "video/mp4",
      "x-upload-content-length": String(file.size)
    },
    body: JSON.stringify(resource)
  });
  if (!init.ok) {
    const detail = await init.text().catch(() => "");
    throw new Error(`YouTube upload session creation failed: HTTP ${init.status} ${detail.slice(0, 600)}`);
  }
  const uploadUrl = init.headers.get("location");
  if (!uploadUrl || !uploadUrl.startsWith("https://www.googleapis.com/upload/youtube/")) {
    throw new Error("YouTube did not return a valid resumable upload URL.");
  }
  const response = await fetchImpl(uploadUrl, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "video/mp4",
      "content-length": String(file.size)
    },
    body: createReadStream(videoPath),
    duplex: "half"
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.id) {
    const reason = result.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`YouTube video upload failed: ${reason}`);
  }
  return {
    status: "uploaded",
    videoId: result.id,
    privacyStatus: result.status?.privacyStatus ?? resource.status.privacyStatus,
    channelId: result.snippet?.channelId ?? null,
    watchUrl: `https://www.youtube.com/watch?v=${result.id}`,
    processingStatus: result.status?.uploadStatus ?? "uploaded",
    warning: "Upload acceptance is not the same as completed processing or monetization approval. Poll processing status before treating the video as ready."
  };
}
