import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { auditVideoForMonetization } from "./monetization.js";

const input = process.argv[2];
if (!input) {
  console.error("Usage: npm run monetization-audit -- <video-audit-input.json>");
  process.exitCode = 1;
} else {
  try {
    const data = JSON.parse(await readFile(resolve(input), "utf8"));
    const audit = auditVideoForMonetization(data);
    const outputPath = resolve(data.outputPath ?? input.replace(/\.json$/i, ".monetization-audit.json"));
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      videoId: data.videoId ?? null,
      audit
    }, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify({ status: audit.status, blockers: audit.blockers, outputPath }, null, 2));
    if (audit.status !== "eligible_for_human_review") process.exitCode = 2;
  } catch (error) {
    console.error(JSON.stringify({ status: "failed", error: error.message }));
    process.exitCode = 1;
  }
}
