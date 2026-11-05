import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { runEndToEnd } from "./e2e.js";

// Usage: npm run e2e -- <e2e-input.json> [result.json]
// Input: { sourceLocalPath, outputPath, source{...rights...}, transcriptWords[],
//          uploadRequested?, humanApproved?, channel? }
// Upload never runs from this CLI without an injected uploader; the GitHub
// Actions e2e-smoke workflow supplies the real YouTube uploader explicitly.
const inputPath = process.argv[2];
if (!inputPath) { console.error("Usage: npm run e2e -- <e2e-input.json> [result.json]"); process.exitCode = 1; }
else {
  try {
    const input = JSON.parse(await readFile(resolve(inputPath), "utf8"));
    const result = await runEndToEnd(input);
    const out = resolve(process.argv[3] ?? inputPath.replace(/\.json$/i, ".e2e-result.json"));
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ status: result.status, stages: result.stages.map((s) => `${s.name}:${s.status}`), upload: result.upload.status, resultPath: out }, null, 2));
    if (!["completed", "held_weak_footage", "rejected_rights"].includes(result.status)) process.exitCode = 1;
    if (result.status !== "completed") process.exitCode = 2;
  } catch (error) {
    console.error(JSON.stringify({ status: "failed", error: error.message }));
    process.exitCode = 1;
  }
}
