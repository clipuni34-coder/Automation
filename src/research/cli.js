import { writeFile } from "node:fs/promises";
import { buildResearchDossier } from "./dossier.js";

const topic = process.argv.slice(2).join(" ").trim();
if (!topic) {
  console.error('Usage: npm run research -- "topic to research"');
  process.exitCode = 1;
} else {
  try {
    const dossier = await buildResearchDossier({ topic });
    const outputPath = `research-${Date.now()}.json`;
    await writeFile(outputPath, JSON.stringify(dossier, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify({
      status: dossier.status,
      topic: dossier.topic,
      sourceCount: dossier.evidence.length,
      outputPath
    }, null, 2));
  } catch (error) {
    console.error(`Research failed: ${error.message}`);
    process.exitCode = 1;
  }
}
