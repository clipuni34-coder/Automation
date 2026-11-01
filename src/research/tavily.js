const SEARCH_ENDPOINT = "https://api.tavily.com/search";

export async function searchTopic({
  query,
  apiKey = process.env.TAVILY_API_KEY,
  fetchImpl = fetch,
  maxResults = 8,
  timeoutMs = 15000
} = {}) {
  const normalizedQuery = String(query ?? "").trim();
  if (!normalizedQuery) throw new Error("A research query is required");
  if (!apiKey) return { status: "not_configured", query: normalizedQuery, results: [] };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(SEARCH_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: normalizedQuery,
        topic: "general",
        search_depth: "advanced",
        max_results: Math.min(20, Math.max(1, Number(maxResults) || 8)),
        include_answer: false,
        include_raw_content: false
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Research provider returned HTTP ${response.status}`);
    }
    const payload = await response.json();
    const results = (Array.isArray(payload.results) ? payload.results : [])
      .filter((item) => {
        try { return ["http:", "https:"].includes(new URL(item.url).protocol); }
        catch { return false; }
      })
      .map((item) => ({
        title: String(item.title ?? "").slice(0, 300),
        url: item.url,
        content: String(item.content ?? "").slice(0, 4000),
        publishedAt: item.published_date ?? null,
        score: Number.isFinite(item.score) ? item.score : null
      }));
    return { status: "ok", query: normalizedQuery, results };
  } finally {
    clearTimeout(timeout);
  }
}
