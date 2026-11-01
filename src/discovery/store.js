import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const EMPTY = { version: 1, observations: [], candidates: [], runs: [] };

export async function readDiscoveryStore(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    if (parsed.version !== 1) throw new Error("Unsupported discovery store version");
    return {
      ...EMPTY,
      ...parsed,
      observations: Array.isArray(parsed.observations) ? parsed.observations : [],
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
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
