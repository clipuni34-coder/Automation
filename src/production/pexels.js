const API = "https://api.pexels.com/v1/videos/search";
const MAX_DOWNLOAD_BYTES = 120 * 1024 * 1024;

function safeVideoFile(video) {
  const files = (video.video_files ?? [])
    .filter((file) => file.file_type === "video/mp4" && file.link && Number(file.width) > 0 && Number(file.height) > 0)
    .sort((a, b) => (b.width * b.height) - (a.width * a.height));
  const file = files.find((item) => item.width >= 720 && item.height >= 720) ?? files[0];
  if (!file) return null;
  const url = new URL(file.link);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".pexels.com")) return null;
  return { url: url.toString(), width: file.width, height: file.height, fps: file.fps ?? null };
}

export async function searchPexelsVideos({
  query, apiKey = process.env.PEXELS_API_KEY ?? "", fetchImpl = fetch,
  perPage = 12, orientation = "portrait", timeoutMs = 20000
} = {}) {
  if (!apiKey) return { status: "not_configured", provider: "pexels", videos: [] };
  const normalized = String(query ?? "").trim().slice(0, 180);
  if (!normalized) throw new Error("A non-empty visual search query is required");
  const params = new URLSearchParams({ query: normalized, per_page: String(Math.max(1, Math.min(30, perPage))), orientation });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${API}?${params}`, {
      headers: { Authorization: apiKey }, signal: controller.signal
    });
    if (!response.ok) throw new Error(`Pexels video search returned HTTP ${response.status}`);
    const payload = await response.json();
    const videos = (payload.videos ?? []).flatMap((video) => {
      const file = safeVideoFile(video);
      if (!file || !video.url || !video.user?.name) return [];
      return [{
        id: video.id, durationSeconds: video.duration, previewImage: video.image,
        sourceUrl: video.url, sourceType: "licensed_stock", license: "Pexels License",
        attribution: { creator: video.user.name, creatorUrl: video.user.url, provider: "Pexels", providerUrl: "https://www.pexels.com" },
        file, width: video.width, height: video.height
      }];
    });
    return { status: "ok", provider: "pexels", query: normalized, videos };
  } finally {
    clearTimeout(timer);
  }
}

export async function downloadPexelsVideo(asset, destinationPath, {
  fetchImpl = fetch, maxBytes = MAX_DOWNLOAD_BYTES, timeoutMs = 60000
} = {}) {
  if (!asset?.file?.url || asset.sourceType !== "licensed_stock" || asset.license !== "Pexels License") {
    throw new Error("A Pexels licensed-stock asset is required");
  }
  const url = new URL(asset.file.url);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".pexels.com")) {
    throw new Error("Video download URL is not an approved Pexels HTTPS host");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, redirect: "error" });
    if (!response.ok) throw new Error(`Pexels video download returned HTTP ${response.status}`);
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("video/") && !type.includes("application/octet-stream")) {
      throw new Error("Pexels asset response is not a video");
    }
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new Error("Pexels video exceeds the configured download limit");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.byteLength > maxBytes) throw new Error("Pexels video is empty or exceeds the configured download limit");
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
