import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { searchPexelsVideos, downloadPexelsVideo } from "./pexels.js";

const GEMINI_IMAGE_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const IMAGE_MODEL = "gemini-nano-banana-2.1";
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const JPEG_SIGNATURE = Buffer.from([255, 216, 255]);

function visualPrompt(item, topic, style) {
  return [
    "Create one original high-quality 9:16 vertical visual for a professional short-form video.",
    "Topic: " + String(topic ?? "General interest").slice(0, 300),
    "Visual direction: " + String(item.visual ?? item.description ?? "").slice(0, 1000),
    "Additional direction: " + String(item.notes ?? "").slice(0, 500),
    "Consistent art direction: " + style,
    "Composition: one clear focal subject, cinematic lighting, depth, strong contrast, clean edges, visually engaging at phone size, safe space for captions.",
    "Do not include written words, subtitles, logos, watermarks, UI, or brand marks. Do not depict an identifiable real person or claim to show documentary footage. Use a generic illustrative representation where a real person or event is mentioned."
  ].join("\n");
}

export async function generateGeminiImage({ prompt, outputPath, apiKey = process.env.GEMINI_API_KEY ?? "", fetchImpl = fetch, timeoutMs = 120000 } = {}) {
  if (!apiKey) return { status: "not_configured", provider: "gemini", outputPath: null };
  if (!String(prompt ?? "").trim() || !outputPath) throw new Error("Image prompt and outputPath are required");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(GEMINI_IMAGE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ model: IMAGE_MODEL, input: prompt, response_format: { type: "image", mime_type: "image/png", aspect_ratio: "9:16", image_size: "1K" } }),
      signal: controller.signal
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error("Gemini image generation returned HTTP " + response.status + (detail ? ": " + detail.slice(0, 700) : ""));
    }
    const payload = await response.json();
    const encoded = payload.output_image?.data ?? payload.output?.image?.data;
    if (!encoded) throw new Error("Gemini image response contained no image data");
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length < 1000 || bytes.length > 25 * 1024 * 1024) throw new Error("Generated image is empty or exceeds the 25MB safety limit");
    const isPng = bytes.subarray(0, 8).equals(PNG_SIGNATURE);
    const isJpeg = bytes.subarray(0, 3).equals(JPEG_SIGNATURE);
    if (!isPng && !isJpeg) throw new Error("Gemini image output is not a valid PNG or JPEG");
    const finalPath = resolve(outputPath.replace(/\.(png|jpe?g)$/i, "") + (isPng ? ".png" : ".jpg"));
    await mkdir(dirname(finalPath), { recursive: true });
    await writeFile(finalPath, bytes, { mode: 0o600, flag: "wx" });
    return { status: "generated", provider: "gemini", model: IMAGE_MODEL, path: finalPath, mimeType: isPng ? "image/png" : "image/jpeg", bytes: bytes.length };
  } finally { clearTimeout(timer); }
}

export async function generateStoryboardAssets({ visualPlan, topic, outputDir = "output/visuals", apiKey = process.env.GEMINI_API_KEY ?? "", pexelsApiKey = process.env.PEXELS_API_KEY ?? "", fetchImpl = fetch, maxScenes = 6, style = "Cinematic editorial illustration, cohesive visual language, vivid but natural color, realistic lighting, crisp details." } = {}) {
  if (!Array.isArray(visualPlan) || visualPlan.length < 1) throw new Error("A non-empty visualPlan is required");
  const selected = visualPlan.slice(0, Math.max(1, Math.min(6, maxScenes)));
  await mkdir(resolve(outputDir), { recursive: true });
  const assets = [];
  for (const [index, item] of selected.entries()) {
    const prompt = visualPrompt(item, topic, style);
    const basePath = join(resolve(outputDir), "scene-" + String(index + 1).padStart(2, "0") + ".png");
    if (apiKey) {
      try {
        const generated = await generateGeminiImage({ prompt, outputPath: basePath, apiKey, fetchImpl });
        if (generated.status === "generated") {
          assets.push({ imagePath: generated.path, sourceType: "generated_visual", generationModel: generated.model, generationPrompt: prompt });
          continue;
        }
      } catch (error) {
        if (!pexelsApiKey) throw new Error("Visual scene " + (index + 1) + " failed: " + error.message);
      }
    }
    if (!pexelsApiKey) throw new Error("No image-generation or Pexels key is available for visual scene " + (index + 1));
    const query = String(item.visual ?? item.description ?? topic ?? "cinematic vertical footage").slice(0, 160);
    const found = await searchPexelsVideos({ query, apiKey: pexelsApiKey, fetchImpl, perPage: 5 });
    if (!found.videos.length) throw new Error("No rights-cleared Pexels footage found for scene " + (index + 1));
    const asset = found.videos[0];
    const destination = join(resolve(outputDir), "scene-" + String(index + 1).padStart(2, "0") + ".mp4");
    const downloaded = await downloadPexelsVideo(asset, destination, { fetchImpl });
    assets.push({ videoPath: downloaded.path, sourceType: "licensed_stock", sourceUrl: downloaded.sourceUrl, license: downloaded.license, attribution: downloaded.attribution });
  }
  return assets;
}
