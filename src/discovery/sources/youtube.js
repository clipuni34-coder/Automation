const API_ROOT = "https://www.googleapis.com/youtube/v3";

export async function collectYouTubePopular({
  apiKey,
  regionCode = "NG",
  maxResults = 50,
  fetchImpl = fetch
} = {}) {
  if (!apiKey) return { source: "youtube", status: "not_configured", items: [] };

  const url = new URL(`${API_ROOT}/videos`);
  url.search = new URLSearchParams({
    key: apiKey,
    part: "snippet,statistics,contentDetails",
    chart: "mostPopular",
    regionCode,
    maxResults: String(Math.min(50, Math.max(1, maxResults)))
  });

  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`YouTube API returned ${response.status}: ${detail.slice(0, 240)}`);
  }

  const payload = await response.json();
  return {
    source: "youtube",
    status: "ok",
    items: (payload.items ?? []).map((video) => ({
      id: `youtube:${video.id}`,
      platform: "youtube",
      sourceUrl: `https://www.youtube.com/watch?v=${video.id}`,
      creator: video.snippet?.channelTitle ?? null,
      creatorId: video.snippet?.channelId ?? null,
      title: video.snippet?.title ?? "",
      description: video.snippet?.description ?? "",
      publishedAt: video.snippet?.publishedAt ?? null,
      categoryId: video.snippet?.categoryId ?? null,
      metrics: {
        views: numberOrNull(video.statistics?.viewCount),
        likes: numberOrNull(video.statistics?.likeCount),
        comments: numberOrNull(video.statistics?.commentCount)
      },
      observedAt: new Date().toISOString(),
      collectionMethod: "YouTube Data API videos.list chart=mostPopular",
      rightsStatus: "reference_only"
    }))
  };
}

function numberOrNull(value) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
