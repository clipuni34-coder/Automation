import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { rankResearchDossiers } from "./dossier-ranking.js";

const files = (await readdir(".")).filter(name => /^research-.*\.json$/i.test(name)).sort();
const dossiers = [];
for (const file of files) {
  try {
    dossiers.push({ ...(JSON.parse(await readFile(resolve(file), "utf8"))), path: file });
  } catch {
    // Ignore malformed dossier files; a malformed file must not block valid research.
  }
}
if (!dossiers.length) {
  console.log("");
} else {
  const discoveryPath = process.env.DISCOVERY_STORE_PATH ?? "data/discovery.json";
  let discovery = { candidates: [] };
  try { discovery = JSON.parse(await readFile(discoveryPath, "utf8")); } catch {}
  const ranked = rankResearchDossiers(dossiers, discovery);
  console.log(ranked[0].path);
}
