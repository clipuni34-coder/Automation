const API_ROOT = "https://www.googleapis.com/youtube/v3";
export const DEFAULT_REGIONS = ["US", "GB", "CA", "AU", "IN", "NG", "ZA", "BR", "MX", "DE", "JP", "KR"];
export const DEFAULT_CATEGORIES = ["1", "2", "10", "15", "17", "19", "20", "22", "23", "24", "25", "26", "27", "28", "29"];

export async function collectYouTubePopular({
  apiKey,
  regionCode = "NG",
  maxResults = 50,
  fetchImpl = fetch
} = {}) {
  return collectYouTubeGlobal({
    apiKey,
    regions: [regionCode],
    categories: [],
    maxResults,
    fetchImpl
  });
}

export async function collectYouTubeGlobal({
  apiKey,
  regions = DEFAULT_REGIONS,
  categories = DEFAULT_CATEGORIES,
  maxResults = 50,
  concurrency = 5,
  fetchImpl = fetch
} = {}) {
  if (!apiKey) return { source: "youtube", status: "not_configured", items: [], requests: 0 };
  const regionList = [...new Set(regions.map((value) => String(value).trim().toUpperCase()).filter(Boolean))];
  const categoryList = [...new Set(categories.map((value) => String(value).trim()).filter(Boolean))];
  if (!regionList.length) throw new Error("At least one YouTube region is required");
  const jobs = regionList.flatMap((regionCode) =>
    (categoryList.length ? categoryList : [null]).map((categoryId) => ({ regionCode, categoryId }))
  );
  const results = new Array(jobs.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= jobs.length) return;
      const job = jobs[index];
      try {
        results[index] = { ...job, ...(await fetchChart({
          ...job, apiKey, maxResults, fetchImpl
        })) };
      } catch (error) {
        results[index] = { ...job, error: error.message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), jobs.length) }, worker));

  const byId = new Map();
  const failures = [];
  for (const result of results) {
    if (result.error) {
      failures.push({ regionCode: result.regionCode, categoryId: result.categoryId, error: result.error });
      continue;
    }
    for (const video of result.items) {
      const previous = byId.get(video.id);
      if (previous) {
        if (!previous.seenInRegions.includes(result.regionCode)) previous.seenInRegions.push(result.regionCode);
        if (result.categoryId && !previous.seenInCategories.includes(result.categoryId)) {
          previous.seenInCategories.push(result.categoryId);
        }
      } else {
        byId.set(video.id, {
          ...video,
          seenInRegions: [result.regionCode],
          seenInCategories: result.categoryId ? [result.categoryId] : []
        });
      }
    }
  }

  const items = [...byId.values()];
  return {
    source: "youtube",
    status: failures.length === 0 ? "ok" : items.length ? "partial" : "error",
    items,
    requests: jobs.length,
    successfulRequests: jobs.length - failures.length,
    failedRequests: failures.length,
    regions: regionList,
    categories: categoryList,
    failures: failures.slice(0, 20)
  };
}

async function fetchChart({ regionCode, categoryId, apiKey, maxResults, fetchImpl }) {
  const url = new URL(`${API_ROOT}/videos`);
  const params = {
    part: "snippet,statistics,contentDetails",
    chart: "mostPopular",
    regionCode,
    maxResults: String(Math.min(50, Math.max(1, maxResults)))
  };
  if (categoryId) params.videoCategoryId = categoryId;
  url.search = new URLSearchParams(params);
  const response = await fetchImpl(url, {
    headers: { accept: "application/json", "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`YouTube API returned ${response.status}: ${detail.slice(0, 180)}`);
  }
  const payload = await response.json();
  return {
    items: (payload.items ?? []).map((video) => ({
      id: `youtube:${video.id}`,
      platform: "youtube",
      sourceUrl: `https://www.youtube.com/watch?v=${video.id}`,
      creator: video.snippet?.channelTitle ?? null,
      creatorId: video.snippet?.channelId ?? null,
      title: video.snippet?.title ?? "",
      description: video.snippet?.description ?? "",
      publishedAt: video.snippet?.publishedAt ?? null,
      categoryId: video.snippet?.categoryId ?? categoryId ?? null,
      metrics: {
        views: numberOrNull(video.statistics?.viewCount),
        likes: numberOrNull(video.statistics?.likeCount),
        comments: numberOrNull(video.statistics?.commentCount)
      },
      observedAt: new Date().toISOString(),
      collectionMethod: "YouTube Data API videos.list mostPopular by region and category",
      rightsStatus: "reference_only"
    }))
  };
}

function numberOrNull(value) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function searchYouTubeVideos({
  apiKey, queries = [], maxResults = 20, order = "viewCount", regionCode = "US", fetchImpl = fetch
} = {}) {
  if (!apiKey) return { source: "youtube_search", status: "not_configured", items: [], requests: 0 };
  const terms = [...new Set(queries.map(value => String(value).trim()).filter(Boolean))].slice(0, 5);
  if (!terms.length) return { source: "youtube_search", status: "not_configured", items: [], requests: 0 };
  if (!["date", "rating", "relevance", "viewCount"].includes(order)) throw new Error("Unsupported YouTube search order");
  const itemsById = new Map();
  const failures = [];
  let requests = 0;
  for (const query of terms) {
    try {
      const searchUrl = new URL(`${API_ROOT}/search`);
      searchUrl.search = new URLSearchParams({ part: "snippet", type: "video", q: query, order, regionCode, maxResults: String(Math.max(1, Math.min(50, maxResults))) });
      const searchResponse = await fetchImpl(searchUrl, { headers: { accept: "application/json", "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(20000) });
      requests++;
      if (!searchResponse.ok) throw new Error(`YouTube search returned HTTP ${searchResponse.status}`);
      const searchPayload = await searchResponse.json();
      const found = (searchPayload.items ?? []).filter(item => item.id?.videoId).slice(0, 50);
      if (!found.length) continue;
      const detailsUrl = new URL(`${API_ROOT}/videos`);
      detailsUrl.search = new URLSearchParams({ part: "snippet,statistics,contentDetails", id: found.map(item => item.id.videoId).join(",") });
      const detailsResponse = await fetchImpl(detailsUrl, { headers: { accept: "application/json", "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(20000) });
      requests++;
      if (!detailsResponse.ok) throw new Error(`YouTube video details returned HTTP ${detailsResponse.status}`);
      const details = await detailsResponse.json();
      for (const video of details.items ?? []) {
        if (!video.id || !video.snippet?.title) continue;
        itemsById.set(video.id, {
          id: `youtube:${video.id}`, platform: "youtube", sourceUrl: `https://www.youtube.com/watch?v=${video.id}`,
          creator: video.snippet.channelTitle ?? null, creatorId: video.snippet.channelId ?? null,
          title: video.snippet.title, description: video.snippet.description ?? "",
          publishedAt: video.snippet.publishedAt ?? null, categoryId: video.snippet.categoryId ?? null,
          metrics: { views: numberOrNull(video.statistics?.viewCount), likes: numberOrNull(video.statistics?.likeCount), comments: numberOrNull(video.statistics?.commentCount) },
          observedAt: new Date().toISOString(), collectionMethod: "YouTube Data API search.list and videos.list",
          searchQueries: [query], rightsStatus: "reference_only"
        });
      }
    } catch (error) { failures.push({ query, error: error.message }); }
  }
  const items = [...itemsById.values()];
  return { source: "youtube_search", status: failures.length ? (items.length ? "partial" : "error") : "ok", items, requests, queries: terms, failures };
}
