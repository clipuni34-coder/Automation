import { loadRenderManifest, renderShortVideo } from "./render.js";

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error("Usage: npm run render -- <render-manifest.json>");
  process.exitCode = 1;
} else {
  try {
    const manifest = await loadRenderManifest(manifestPath);
    const result = await renderShortVideo(manifest);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: "failed", error: error.message }));
    process.exitCode = 1;
  }
}
