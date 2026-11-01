const ANALYTICS_ENDPOINT = "https://youtubeanalytics.googleapis.com/v2/reports";

export async function fetchYouTubeAnalyticsReport({
  accessToken,
  startDate,
  endDate,
  dimensions,
  metrics = "views,likes,comments,shares,subscribersGained,estimatedMinutesWatched,averageViewDuration,averageViewPercentage",
  sort,
  maxResults = 200,
  fetchImpl = fetch
} = {}) {
  if (!accessToken || !startDate || !endDate) throw new Error("accessToken, startDate and endDate are required.");
  if (startDate > endDate) throw new Error("startDate must be on or before endDate.");
  const params = new URLSearchParams({
    ids: "channel==MINE",
    startDate,
    endDate,
    metrics,
    maxResults: String(Math.max(1, Math.min(200, maxResults)))
  });
  if (dimensions) params.set("dimensions", dimensions);
  if (sort) params.set("sort", sort);
  const response = await fetchImpl(`${ANALYTICS_ENDPOINT}?${params}`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`YouTube Analytics API returned HTTP ${response.status}: ${payload.error?.message ?? "unknown error"}`);
  }
  return {
    kind: dimensions ?? "channel_summary",
    columnHeaders: payload.columnHeaders ?? [],
    rows: payload.rows ?? [],
    startDate,
    endDate,
    source: "YouTube Analytics API",
    fetchedAt: new Date().toISOString()
  };
}

export function rowsToObjects(report) {
  const headers = (report.columnHeaders ?? []).map(item => item.name);
  return (report.rows ?? []).map(row => Object.fromEntries(headers.map((key, index) => [key, row[index]])));
}
