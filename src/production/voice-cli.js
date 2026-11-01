import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateNarration } from "./voice.js";

const inputPath = process.argv[2];
const outputPath = process.argv[3] ?? "narration.wav";

if (!inputPath) {
  console.error("Usage: npm run voice -- <creative-brief.json> [output.wav]");
  process.exitCode = 1;
} else {
  try {
    const brief = JSON.parse(await readFile(resolve(inputPath), "utf8"));
    const text = brief.editorial?.fullScript ?? brief.fullScript;
    const result = await generateNarration({ text, outputPath: resolve(outputPath) });
    console.log(JSON.stringify(result));
    if (result.status !== "generated") process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
