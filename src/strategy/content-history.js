import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function tokenizeScript(value) {
  return [...new Set(String(value ?? "").toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])].slice(0, 250);
}

export function fingerprintScript(value) {
  const normalized = String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

export function assessContentDistinctness(script, recentContent = []) {
  const tokens = tokenizeScript(script);
  const tokenSet = new Set(tokens);
  const fingerprint = fingerprintScript(script);
  let maxSimilarity = 0;
  let exactDuplicate = false;
  for (const prior of recentContent) {
    if (prior.fingerprint && prior.fingerprint === fingerprint) exactDuplicate = true;
    const priorTokens = new Set(Array.isArray(prior.scriptTokens) ? prior.scriptTokens : []);
    if (!priorTokens.size || !tokenSet.size) continue;
    let intersection = 0;
    for (const token of tokenSet) if (priorTokens.has(token)) intersection += 1;
    const union = new Set([...tokenSet, ...priorTokens]).size;
    maxSimilarity = Math.max(maxSimilarity, union ? intersection / union : 0);
  }
  return {
    distinct: !exactDuplicate && maxSimilarity < 0.78,
    fingerprint,
    scriptTokens: tokens,
    maxSimilarity: Math.round(maxSimilarity * 1000) / 1000,
    comparedUploads: recentContent.length,
    reason: exactDuplicate ? "exact_script_duplicate" : maxSimilarity >= 0.78 ? "too_similar_to_recent_upload" : "distinct_from_recent_uploads"
  };
}

export async function readContentHistory(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return { version: 1, uploads: Array.isArray(value.uploads) ? value.uploads : [] };
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, uploads: [] };
    throw error;
  }
}

export async function recordPublishedContent(path, item) {
  if (!item?.channelId || !item?.videoId || !item?.fingerprint) throw new Error("channelId, videoId and fingerprint are required for content history.");
  const history = await readContentHistory(path);
  const exists = history.uploads.some(upload => upload.channelId === item.channelId && upload.videoId === item.videoId);
  if (!exists) history.uploads.push({ ...item, recordedAt: new Date().toISOString() });
  history.uploads = history.uploads.slice(-500);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(history, null, 2) + "\n", { mode: 0o600 });
  return history;
}

export function hasPublishedFingerprint(history, channelId, fingerprint) {
  return Boolean(channelId && fingerprint && (history?.uploads ?? []).some(item => item.channelId === channelId && item.fingerprint === fingerprint));
}
