import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateEditorialPlan } from "./provider.js";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: npm run create-brief -- <research-dossier.json>");
  process.exitCode = 1;
} else {
  try {
    const dossier = JSON.parse(await readFile(resolve(inputPath), "utf8"));
    const result = await generateEditorialPlan({ dossier });
    if (result.status !== "ok") {
      console.log(JSON.stringify({ status: result.status, topic: dossier.topic }));
    } else {
      const output = {
        ...dossier,
        editorial: {
          ...dossier.editorial,
          ...result.plan,
          status: "brief_generated",
          provider: result.provider,
          generatedAt: new Date().toISOString()
        }
      };
      const outputPath = resolve(inputPath.replace(/\.json$/i, "") + ".creative.json");
      await writeFile(outputPath, JSON.stringify(output, null, 2) + "\n", { mode: 0o600 });
      console.log(JSON.stringify({ status: "ok", topic: dossier.topic, provider: result.provider, outputPath }));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
