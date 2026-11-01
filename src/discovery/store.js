import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const EMPTY = { version: 2, observations: [], candidates: [], topicClusters: [], runs: [] };

export async function readDiscoveryStore(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    if (![1, 2].includes(parsed.version)) throw new Error("Unsupported discovery store version");
    return {
      ...EMPTY,
      ...parsed,
      version: 2,
      observations: Array.isArray(parsed.observations) ? parsed.observations : [],
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
      topicClusters: Array.isArray(parsed.topicClusters) ? parsed.topicClusters : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs : []
    };
  } catch (error) {
    if (error.code === "ENOENT") return structuredClone(EMPTY);
    throw error;
  }
}

export async function writeDiscoveryStore(filePath, store) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(store, null, 2) + "\n", { mode: 0o600 });
  await rename(temporaryPath, filePath);
}
