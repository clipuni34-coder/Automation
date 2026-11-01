import { readFile } from "node:fs/promises";
import { buildDiscoveryDossiers, writeDiscoveryDossiers } from "./discovery-dossiers.js";

const storePath = process.env.DISCOVERY_STORE_PATH ?? "data/discovery.json";
const outputDirectory = process.env.RESEARCH_OUTPUT_DIRECTORY ?? ".";
const discovery = JSON.parse(await readFile(storePath, "utf8"));
const dossiers = buildDiscoveryDossiers(discovery, {
  maxDossiers: Number(process.env.RESEARCH_DOSSIER_LIMIT ?? 3),
  minimumScore: Number(process.env.RESEARCH_MINIMUM_SCORE ?? 35)
});
const files = await writeDiscoveryDossiers(dossiers, outputDirectory);
console.log(JSON.stringify({ status: "completed", dossierCount: dossiers.length, files }, null, 2));
