import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { runAuthorizedReedit } from "./authorized-reedit.js";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: npm run reedit-render -- <authorized-reedit-input.json> [result.json]");
  process.exitCode = 1;
} else {
  try {
    const input = JSON.parse(await readFile(resolve(inputPath), "utf8"));
    const result = await runAuthorizedReedit(input);
    const output = resolve(process.argv[3] ?? inputPath.replace(/\.json$/i, ".result.json"));
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({
      status: result.status,
      outputPath: result.outputPath,
      selectedSegments: result.plan?.editDecisionList?.length ?? 0,
      rights: result.plan?.rights?.status ?? "not_applicable",
      sourceAudioPreserved: result.rendered?.sourceAudioPreserved ?? false
    }, null, 2));
    if (result.status !== "completed") process.exitCode = 2;
  } catch (error) {
    console.error(JSON.stringify({ status: "failed", error: error.message }));
    process.exitCode = 1;
  }
}
