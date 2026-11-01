const SEARCH_ENDPOINT = "https://api.tavily.com/search";
const EXTRACT_ENDPOINT = "https://api.tavily.com/extract";

function isSafePublicHttpsUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".localhost") ||
        host.endsWith(".local") || host.endsWith(".internal") ||
        host === "0.0.0.0" || host === "::1" || /^127\./.test(host) ||
        /^10\./.test(host) || /^192\.168\./.test(host) ||
        /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (/^[0-9.]+$/.test(host) || host.includes(":")) return false;
    return true;
  } catch { return false; }
}

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
      headers: { "content-type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        query: normalizedQuery, topic: "general", search_depth: "advanced",
        max_results: Math.min(20, Math.max(1, Number(maxResults) || 8)),
        include_answer: false, include_raw_content: false
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Research provider returned HTTP ${response.status}`);
    const payload = await response.json();
    const results = (Array.isArray(payload.results) ? payload.results : [])
      .filter((item) => { try { return ["http:", "https:"].includes(new URL(item.url).protocol); } catch { return false; } })
      .map((item) => ({
        title: String(item.title ?? "").slice(0, 300), url: item.url,
        content: String(item.content ?? "").slice(0, 4000),
        publishedAt: item.published_date ?? null,
        score: Number.isFinite(item.score) ? item.score : null
      }));
    return { status: "ok", query: normalizedQuery, results };
  } finally { clearTimeout(timeout); }
}

/**
 * Extracts selected public HTTPS source pages through Tavily. Extracted text is
 * evidence for human review, never an automatic claim-verification decision.
 */
export async function extractSources({
  urls = [],
  query = "",
  apiKey = process.env.TAVILY_API_KEY,
  fetchImpl = fetch,
  timeoutMs = 60000
} = {}) {
  const safeUrls = [...new Set(urls.filter(isSafePublicHttpsUrl))].slice(0, 20);
  if (!apiKey) return { status: "not_configured", results: [], failedResults: [] };
  if (!safeUrls.length) return { status: "no_eligible_urls", results: [], failedResults: [] };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(EXTRACT_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        urls: safeUrls, extract_depth: "basic", format: "text",
        include_images: false, timeout: 30,
        ...(query ? { query: String(query).slice(0, 300), chunks_per_source: 2 } : {})
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Source extraction returned HTTP ${response.status}`);
    const payload = await response.json();
    return {
      status: "ok",
      results: (Array.isArray(payload.results) ? payload.results : []).map((item) => ({
        url: item.url,
        rawContent: String(item.raw_content ?? "").slice(0, 12000)
      })),
      failedResults: (Array.isArray(payload.failed_results) ? payload.failed_results : []).map((item) => ({
        url: item.url, error: String(item.error ?? "Extraction failed").slice(0, 300)
      }))
    };
  } finally { clearTimeout(timeout); }
}
