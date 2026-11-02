const ANALYTICS_ENDPOINT = "https://youtubeanalytics.googleapis.com/v2/reports";

export async function fetchYouTubeAnalyticsReport({
  accessToken,
  startDate,
  endDate,
  dimensions,
  metrics = "views,likes,comments,shares,subscribersGained,estimatedMinutesWatched,averageViewDuration,averageViewPercentage",
  sort,
  filters,
  maxResults,
  fetchImpl = fetch
} = {}) {
  if (!accessToken || !startDate || !endDate) throw new Error("accessToken, startDate and endDate are required.");
  if (startDate > endDate) throw new Error("startDate must be on or before endDate.");
  const params = new URLSearchParams({
    ids: "channel==MINE",
    startDate,
    endDate,
    metrics
  });
  if (dimensions) params.set("dimensions", dimensions);
  if (sort) params.set("sort", sort);
  if (filters) params.set("filters", filters);
  // maxResults is only required/appropriate for report types that define a row limit
  // (for example, top-video reports). Do not attach it to every channel report.
  if (maxResults !== undefined && maxResults !== null) {
    params.set("maxResults", String(Math.max(1, Math.min(200, maxResults))));
  }
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
