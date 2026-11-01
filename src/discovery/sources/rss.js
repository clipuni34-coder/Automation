const ENTITY_MAP = { amp: "&", apos: "'", gt: ">", lt: "<", quot: '"' };

export async function collectRssFeeds({
  feedUrls = [],
  fetchImpl = fetch
} = {}) {
  const results = await Promise.allSettled(feedUrls.map(async (feedUrl) => {
    const url = new URL(feedUrl);
    if (!["https:", "http:"].includes(url.protocol)) throw new Error("Feed URL must use HTTP or HTTPS");
    const response = await fetchImpl(url, {
      headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}`);
    const xml = await response.text();
    return parseFeed(xml, url.href);
  }));

  const items = [];
  const errors = [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (result.status === "fulfilled") items.push(...result.value);
    else errors.push({ feed: feedUrls[index], error: result.reason?.message ?? "Unknown feed error" });
  }
  return {
    source: "rss",
    status: feedUrls.length === 0 ? "not_configured" : errors.length ? "partial" : "ok",
    items,
    errors
  };
}

export function parseFeed(xml, feedUrl) {
  const entries = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
  return entries.map(([, , block], index) => {
    const title = decodeXml(readTag(block, "title") ?? "").trim();
    const description = decodeXml(readTag(block, "description") ?? readTag(block, "summary") ?? "").trim();
    const linkTag = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i);
    const linkText = readTag(block, "link");
    const link = decodeXml(linkTag?.[1] ?? linkText ?? "").trim();
    const guid = decodeXml(readTag(block, "guid") ?? readTag(block, "id") ?? link ?? `${feedUrl}#${index}`);
    const publishedAt = readTag(block, "pubDate") ?? readTag(block, "published") ?? readTag(block, "updated") ?? null;
    return {
      id: `rss:${guid}`,
      platform: "rss",
      sourceUrl: safeUrl(link, feedUrl),
      creator: new URL(feedUrl).hostname,
      creatorId: null,
      title,
      description,
      publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null,
      metrics: { views: null, likes: null, comments: null },
      observedAt: new Date().toISOString(),
      collectionMethod: `RSS/Atom feed: ${feedUrl}`,
      rightsStatus: "reference_only"
    };
  }).filter((item) => item.title && item.sourceUrl);
}

function readTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1") ?? null;
}

function decodeXml(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, entity) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x"
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITY_MAP[entity] ?? whole;
  });
}

function safeUrl(value, fallback) {
  try {
    const url = new URL(value, fallback);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
