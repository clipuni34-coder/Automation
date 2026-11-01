import { readFile, writeFile } from "node:fs/promises";
import { buildResearchDossier } from "./dossier.js";

const topic = process.argv.slice(2).join(" ").trim();
if (!topic) {
  console.error('Usage: npm run research -- "topic to research"');
  process.exitCode = 1;
} else {
  try {
    let reference = null;
    const discoveryPath = process.env.DISCOVERY_STORE_PATH ?? "data/discovery.json";
    try {
      const discovery = JSON.parse(await readFile(discoveryPath, "utf8"));
      const normalizedTopic = topic.toLocaleLowerCase().replace(/\s+/g, " ").trim();
      reference = (discovery.candidates ?? []).find(candidate =>
        String(candidate.title ?? "").toLocaleLowerCase().replace(/\s+/g, " ").trim() === normalizedTopic
      ) ?? null;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const dossier = await buildResearchDossier({ topic, reference });
    const outputPath = `research-${Date.now()}.json`;
    await writeFile(outputPath, JSON.stringify(dossier, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify({
      status: dossier.status,
      topic: dossier.topic,
      sourceCount: dossier.evidence.length,
      referenceMatched: Boolean(dossier.reference),
      referenceId: dossier.reference?.id ?? null,
      outputPath
    }, null, 2));
  } catch (error) {
    console.error(`Research failed: ${error.message}`);
    process.exitCode = 1;
  }
}
