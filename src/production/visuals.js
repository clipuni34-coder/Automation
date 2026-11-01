import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { searchPixabayVideos, downloadPixabayVideo } from "./pixabay.js";

const GEMINI_IMAGE_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const IMAGE_MODEL = "gemini-nano-banana-2.1";
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const JPEG_SIGNATURE = Buffer.from([255, 216, 255]);
const GRAPHIC_WIDTH = 540;
const GRAPHIC_HEIGHT = 960;
const PALETTES = [
  [[8, 17, 38], [16, 94, 112], [55, 225, 210]],
  [[24, 9, 39], [112, 35, 105], [255, 128, 88]],
  [[8, 22, 32], [30, 83, 133], [102, 177, 255]],
  [[30, 14, 20], [126, 48, 47], [255, 183, 76]],
  [[13, 16, 40], [64, 48, 130], [181, 145, 255]],
  [[9, 30, 27], [25, 112, 83], [142, 232, 156]]
];

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

// Deterministic, locally generated motion-graphic backgrounds keep production working
// when external image APIs are unavailable or have exhausted their quota.
export async function generateOriginalGraphic({ outputPath, sceneIndex = 0 } = {}) {
  if (!outputPath) throw new Error("An outputPath is required for an original graphic");
  const palette = PALETTES[Math.abs(Number(sceneIndex) || 0) % PALETTES.length];
  const [dark, mid, accent] = palette;
  const pixels = Buffer.alloc(GRAPHIC_WIDTH * GRAPHIC_HEIGHT * 3);
  const cx = GRAPHIC_WIDTH * (sceneIndex % 2 === 0 ? 0.72 : 0.28);
  const cy = GRAPHIC_HEIGHT * 0.38;
  const maxDistance = Math.sqrt(GRAPHIC_WIDTH ** 2 + GRAPHIC_HEIGHT ** 2);
  for (let y = 0; y < GRAPHIC_HEIGHT; y++) {
    for (let x = 0; x < GRAPHIC_WIDTH; x++) {
      const t = Math.min(1, Math.max(0, y / GRAPHIC_HEIGHT * 0.72 + x / GRAPHIC_WIDTH * 0.28));
      const dx = x - cx, dy = y - cy;
      const glow = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / (maxDistance * 0.52));
      const ring = Math.max(0, 1 - Math.abs(Math.sqrt(dx * dx + dy * dy) - GRAPHIC_WIDTH * 0.34) / 9);
      const stripe = (x > GRAPHIC_WIDTH * 0.08 && x < GRAPHIC_WIDTH * 0.11 && y > GRAPHIC_HEIGHT * 0.16 && y < GRAPHIC_HEIGHT * 0.78) ? 0.55 : 0;
      const offset = (y * GRAPHIC_WIDTH + x) * 3;
      for (let c = 0; c < 3; c++) {
        const base = dark[c] * (1 - t) + mid[c] * t;
        pixels[offset + c] = Math.max(0, Math.min(255, Math.round(base + accent[c] * (glow * 0.28 + ring * 0.24 + stripe * 0.18))));
      }
    }
  }
  const header = Buffer.from("P6\n" + GRAPHIC_WIDTH + " " + GRAPHIC_HEIGHT + "\n255\n", "ascii");
  const finalPath = resolve(outputPath.replace(/\.(png|jpe?g|ppm)$/i, "") + ".ppm");
  await mkdir(dirname(finalPath), { recursive: true });
  await writeFile(finalPath, Buffer.concat([header, pixels]), { mode: 0o600, flag: "wx" });
  return { status: "generated", provider: "local-graphics", path: finalPath, mimeType: "image/x-portable-pixmap", bytes: header.length + pixels.length };
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
      body: JSON.stringify({ model: IMAGE_MODEL, input: prompt, response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "9:16", image_size: "1K" } }),
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

export async function generateStoryboardAssets({ visualPlan, topic, outputDir = "output/visuals", apiKey = process.env.GEMINI_API_KEY ?? "", pixabayApiKey = process.env.PIXABAY_API_KEY ?? "", fetchImpl = fetch, maxScenes = 6, style = "Cinematic editorial illustration, cohesive visual language, vivid but natural color, realistic lighting, crisp details." } = {}) {
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
        console.warn("Gemini visual unavailable for scene " + (index + 1) + "; trying another visual source: " + error.message);
      }
    }
    if (pixabayApiKey) {
      try {
        const query = String(item.visual ?? item.description ?? topic ?? "cinematic vertical footage").slice(0, 160);
        const found = await searchPixabayVideos({ query, apiKey: pixabayApiKey, fetchImpl, perPage: 5 });
        if (found.videos.length) {
          const asset = found.videos[0];
          const destination = join(resolve(outputDir), "scene-" + String(index + 1).padStart(2, "0") + ".mp4");
          const downloaded = await downloadPixabayVideo(asset, destination, { fetchImpl });
          assets.push({ videoPath: downloaded.path, sourceType: "licensed_stock", sourceUrl: downloaded.sourceUrl, license: downloaded.license, attribution: downloaded.attribution });
          continue;
        }
        console.warn("No Pixabay stock footage found for scene " + (index + 1) + "; using an original graphic.");
      } catch (error) {
        console.warn("Pixabay unavailable for scene " + (index + 1) + "; using an original graphic: " + error.message);
      }
    }
    const graphic = await generateOriginalGraphic({ outputPath: basePath, sceneIndex: index });
    assets.push({ imagePath: graphic.path, sourceType: "original_graphic", graphicStyle: "locally-generated-gradient-motion-background" });
  }
  return assets;
}
