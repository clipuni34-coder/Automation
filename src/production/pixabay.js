// Low-level Pixabay HTTP adapter. Its legacy `licensed_stock` / licence
// fields are provider metadata, NOT independent per-item rights verification.
// Callers must enforce the provider's cache/rate rules and review each asset;
// the automated storyboard fallback is deliberately held. The planning
// wrapper uses this only for a bounded human-initiated lead search.
const API = "https://pixabay.com/api/videos/";
const MAX_DOWNLOAD_BYTES = 120 * 1024 * 1024;
const VISUAL_STOP_WORDS = new Set(["a","an","the","and","or","of","to","in","on","at","for","with","from","show","shows","showing","scene","visual","footage","video","shot","image","cinematic","dramatic","close","wide","camera","view","background","person","people","man","woman","someone","something","their","this","that","into","while","during","about","after","before","over","under","against","near","around","vertical","portrait","professional","high","quality","natural","realistic","lighting","color","crisp","details"]);

function visualTerms(value) {
  return [...new Set(String(value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/)
    .map((word) => word.trim()).filter((word) => word.length >= 3 && !VISUAL_STOP_WORDS.has(word))
    .map((word) => word.endsWith("ies") && word.length > 4 ? word.slice(0, -3) + "y" : word.endsWith("s") && word.length > 4 ? word.slice(0, -1) : word))].slice(0, 10);
}

/** Conservative lexical gate: Pixabay ranking alone is not proof of scene relevance. */
export function scorePixabayRelevance(query, video) {
  const requested = visualTerms(query);
  const tags = visualTerms(video?.tags ?? "");
  const matchedTerms = requested.filter((term) => tags.includes(term));
  const score = requested.length ? matchedTerms.length / requested.length : 0;
  const minimumMatches = requested.length <= 1 ? 1 : 2;
  return { score: Number(score.toFixed(3)), matchedTerms, requestedTerms: requested, relevant: matchedTerms.length >= minimumMatches && score >= 0.35 };
}

function safeVideoFile(video) {
  const variants = [video.videos?.large, video.videos?.medium, video.videos?.small, video.videos?.tiny]
    .filter((file) => file?.url && Number(file.width) > 0 && Number(file.height) > 0)
    .sort((a, b) => (b.width * b.height) - (a.width * a.height));
  // Prefer the highest-resolution variant that fits our download budget.
  // Pixabay may return a very large "large" file while offering a suitable
  // medium/small alternative for the same stock clip.
  const affordable = variants.filter((item) => !Number.isFinite(Number(item.size)) || Number(item.size) <= MAX_DOWNLOAD_BYTES);
  const candidates = affordable.length ? affordable : variants;
  const file = candidates.find((item) => item.width >= 720 && item.height >= 720) ?? candidates[0];
  if (!file || Number(file.size) > MAX_DOWNLOAD_BYTES) return null;
  let url;
  try { url = new URL(file.url); } catch { return null; }
  if (url.protocol !== "https:" || !(url.hostname === "pixabay.com" || url.hostname.endsWith(".pixabay.com"))) return null;
  return { url: url.toString(), width: file.width, height: file.height, size: file.size ?? null };
}

export async function searchPixabayVideos({
  query, apiKey = process.env.PIXABAY_API_KEY ?? "", fetchImpl = fetch,
  perPage = 12, timeoutMs = 20000, videoType = "all"
} = {}) {
  if (!apiKey) return { status: "not_configured", provider: "pixabay", videos: [] };
  const normalized = String(query ?? "").trim().slice(0, 100);
  if (!normalized) throw new Error("A non-empty visual search query is required");
  if (!["all", "film", "animation"].includes(videoType)) throw new Error("Unsupported Pixabay video type.");
  const params = new URLSearchParams({
    key: apiKey, q: normalized, per_page: String(Math.max(3, Math.min(200, perPage))),
    safesearch: "true", video_type: videoType
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // The provider requires its key in the query string. Refuse redirects so
    // a redirect cannot carry that credential to a different host.
    const response = await fetchImpl(`${API}?${params}`, { signal: controller.signal, redirect: "error" });
    if (!response.ok) throw new Error(`Pixabay video search returned HTTP ${response.status}`);
    const payload = await response.json();
    const videos = (payload.hits ?? []).flatMap((video) => {
      const file = safeVideoFile(video);
      if (!file || !video.pageURL || !video.user) return [];
      return [{
        id: video.id, durationSeconds: video.duration, previewImage: video.videos?.large?.thumbnail ?? null,
        mediaType: video.type ?? null,
        sourceUrl: video.pageURL, sourceType: "licensed_stock", license: "Pixabay Content License",
        attribution: { creator: video.user, creatorUrl: video.userImageURL ?? null, provider: "Pixabay", providerUrl: "https://pixabay.com" },
        file, width: file.width, height: file.height, tags: video.tags ?? ""
      }];
    });
    return { status: "ok", provider: "pixabay", query: normalized, totalHits: payload.totalHits ?? null, videos };
  } catch (error) {
    // Never propagate an HTTP-client error containing the request URL: the
    // provider's API key is part of that URL. Keep only a bounded status.
    const message = String(error?.message ?? "");
    if (/^Pixabay video search returned HTTP \d{3}$/.test(message)) throw new Error(message);
    if (error?.name === "AbortError") throw new Error("Pixabay video search timed out.");
    throw new Error("Pixabay video search failed; credential values were not logged.");
  } finally {
    clearTimeout(timer);
  }
}

export async function downloadPixabayVideo(asset, destinationPath, {
  fetchImpl = fetch, maxBytes = MAX_DOWNLOAD_BYTES, timeoutMs = 60000
} = {}) {
  if (!asset?.file?.url || asset.sourceType !== "licensed_stock" || asset.license !== "Pixabay Content License") {
    throw new Error("A Pixabay licensed-stock asset is required");
  }
  const url = new URL(asset.file.url);
  if (url.protocol !== "https:" || !(url.hostname === "pixabay.com" || url.hostname.endsWith(".pixabay.com"))) {
    throw new Error("Video download URL is not an approved Pixabay HTTPS host");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, redirect: "error" });
    if (!response.ok) throw new Error(`Pixabay video download returned HTTP ${response.status}`);
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("video/") && !type.includes("application/octet-stream")) {
      throw new Error("Pixabay asset response is not a video");
    }
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new Error("Pixabay video exceeds the configured download limit");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.byteLength > maxBytes) throw new Error("Pixabay video is empty or exceeds the configured download limit");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(destinationPath, bytes, { mode: 0o600, flag: "wx" });
    return {
      status: "downloaded", path: destinationPath, bytes: bytes.byteLength,
      sourceType: asset.sourceType, sourceUrl: asset.sourceUrl, license: asset.license,
      attribution: asset.attribution
    };
  } finally {
    clearTimeout(timer);
  }
}
