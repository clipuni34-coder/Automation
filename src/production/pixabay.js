const API = "https://pixabay.com/api/videos/";
const MAX_DOWNLOAD_BYTES = 120 * 1024 * 1024;

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
  const url = new URL(file.url);
  if (url.protocol !== "https:" || !(url.hostname === "pixabay.com" || url.hostname.endsWith(".pixabay.com"))) return null;
  return { url: url.toString(), width: file.width, height: file.height, size: file.size ?? null };
}

export async function searchPixabayVideos({
  query, apiKey = process.env.PIXABAY_API_KEY ?? "", fetchImpl = fetch,
  perPage = 12, timeoutMs = 20000
} = {}) {
  if (!apiKey) return { status: "not_configured", provider: "pixabay", videos: [] };
  const normalized = String(query ?? "").trim().slice(0, 100);
  if (!normalized) throw new Error("A non-empty visual search query is required");
  const params = new URLSearchParams({
    key: apiKey, q: normalized, per_page: String(Math.max(3, Math.min(200, perPage))),
    safesearch: "true", video_type: "all"
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${API}?${params}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Pixabay video search returned HTTP ${response.status}`);
    const payload = await response.json();
    const videos = (payload.hits ?? []).flatMap((video) => {
      const file = safeVideoFile(video);
      if (!file || !video.pageURL || !video.user) return [];
      return [{
        id: video.id, durationSeconds: video.duration, previewImage: video.videos?.large?.thumbnail ?? null,
        sourceUrl: video.pageURL, sourceType: "licensed_stock", license: "Pixabay Content License",
        attribution: { creator: video.user, creatorUrl: video.userImageURL ?? null, provider: "Pixabay", providerUrl: "https://pixabay.com" },
        file, width: file.width, height: file.height, tags: video.tags ?? ""
      }];
    });
    return { status: "ok", provider: "pixabay", query: normalized, totalHits: payload.totalHits ?? null, videos };
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
