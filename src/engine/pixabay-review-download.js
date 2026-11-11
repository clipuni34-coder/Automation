// One explicitly authorized, directly fetched Pixabay rendition for OFFLINE
// INSPECTION ONLY. No source is promoted, rendered, or approved for upload.
// This path is useful only if the runner can access the exact item and policy
// pages; an HTTP 403, redirect, ambiguous metadata or changed source is a hold.
import { createHash, randomUUID } from "node:crypto";
import { link, lstat, open, stat, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { validatePixabayLead } from "../discovery/sources/pixabay-planning.js";
import { observePixabayLead } from "./pixabay-observations.js";

const MAX_BYTES = 120 * 1024 * 1024;
async function discard(response) { try { await response?.body?.cancel(); } catch { /* already closed */ } }

// `authorized` and `termsReviewed` represent a real operator's decision to
// obtain this ONE file for inspection under the provider's current terms.
// They are not a signature, licence verification, production approval, or
// permission to perform systematic downloads. The caller must not automate a
// batch. A later production pathway needs an independent fresh rights check,
// human editorial/third-party review, and its own exact source-SHA comparison.
export async function downloadPixabayForReview(candidate, destination, {
  authorized = false, termsReviewed = false, clockVerified = false,
  fetchImpl = fetch, pythonPath = process.env.PYTHON ?? "python3", now = () => new Date(), timeoutMs = 20000
} = {}) {
  if (!authorized || !termsReviewed || !clockVerified) throw new Error("A specifically authorized single review download, current terms review and verified runner clock are required.");
  if (!validatePixabayLead(candidate)) throw new Error("A valid, unverified Pixabay planning lead is required.");
  if (typeof destination !== "string" || !destination.trim() || !/\.mp4$/i.test(destination)) throw new Error("Choose an explicit new .mp4 review-file path.");
  const output = resolve(destination);
  try { await lstat(output); throw new Error("The review destination already exists; refusing to overwrite it."); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  const parent = await stat(dirname(output));
  if (!parent.isDirectory()) throw new Error("The review destination's parent is not a directory.");

  const evidence = await observePixabayLead(candidate, { fetchImpl, pythonPath, now, timeoutMs });
  const base = { provider: "pixabay", providerAssetId: candidate.providerAssetId, itemPageUrl: candidate.rightsEvidenceUrl,
    renditionUrl: candidate.sourceUrl, rightsStatus: "evidence_recorded_not_independently_verified", productionEligible: false,
    uploadApproved: false, evidence };
  if (evidence.observationStatus !== "consistent_metadata_manual_review_required") return { ...base, status: "held", reason: "The direct item, exact rendition or policy observations are incomplete or ambiguous; no media was requested." };

  let response;
  try {
    response = await fetchImpl(candidate.sourceUrl, { method: "GET", redirect: "manual", headers: { accept: "video/mp4, application/octet-stream", "user-agent": "PrimePlugReviewDownload/1.0" }, signal: AbortSignal.timeout(timeoutMs) });
  } catch { return { ...base, status: "held", reason: "The exact review rendition could not be requested." }; }
  const status = Number(response?.status);
  if (status !== 200 || response?.redirected || (response?.url && response.url !== candidate.sourceUrl)) {
    await discard(response);
    return { ...base, status: "held", httpStatus: Number.isInteger(status) ? status : null, reason: "The exact rendition was unavailable or redirected; no redirect was followed." };
  }
  const type = String(response.headers?.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const encoding = String(response.headers?.get("content-encoding") ?? "identity").trim().toLowerCase();
  const lengthHeader = response.headers?.get("content-length");
  if (!(["video/mp4", "application/octet-stream"].includes(type)) || encoding !== "identity" || !response.body || typeof response.body.getReader !== "function"
      || (lengthHeader && (!/^\d+$/.test(lengthHeader) || Number(lengthHeader) < 1024 || Number(lengthHeader) > MAX_BYTES
        || (candidate.sourceSizeBytes !== null && Number(lengthHeader) !== candidate.sourceSizeBytes)))) {
    await discard(response);
    return { ...base, status: "held", reason: "The rendition type, encoding or announced size was unexpected; no file was saved." };
  }
  const temporary = `${output}.partial-${randomUUID()}`;
  let file, reader;
  try {
    file = await open(temporary, "wx", 0o600);
    reader = response.body.getReader();
    const hash = createHash("sha256");
    let bytes = 0, prefix = Buffer.alloc(0);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      bytes += chunk.length;
      if (bytes > MAX_BYTES || (candidate.sourceSizeBytes !== null && bytes > candidate.sourceSizeBytes)) throw new Error("size limit");
      if (prefix.length < 16) prefix = Buffer.concat([prefix, chunk.subarray(0, 16 - prefix.length)]);
      hash.update(chunk);
      await file.writeFile(chunk);
    }
    if (bytes < 1024 || prefix.subarray(4, 8).toString("ascii") !== "ftyp"
        || (lengthHeader && Number(lengthHeader) !== bytes) || (candidate.sourceSizeBytes !== null && candidate.sourceSizeBytes !== bytes)) throw new Error("invalid or truncated media");
    const finished = new Date(typeof now === "function" ? now() : now);
    if (!Number.isFinite(finished.getTime()) || finished.getTime() < Date.parse(evidence.finishedAt ?? "")) throw new Error("clock changed");
    await file.close(); file = null;
    // link() atomically refuses an existing destination; unlike rename(), it
    // never replaces a file another process created during the download.
    await link(temporary, output);
    return { ...base, status: "downloaded_for_inspection_only", localPath: output, bytes, sourceSha256: hash.digest("hex"),
      retrievedAt: finished.toISOString(), sourceProvenance: "direct_https_exact_rendition_no_redirect",
      note: "The digest identifies the downloaded bytes, not the truth of their subject, the contributor's ownership, third-party clearances, or permission to produce or publish." };
  } catch {
    try { await reader?.cancel(); } catch { /* already closed */ }
    return { ...base, status: "held", reason: "The bounded rendition download, file check, clock or exclusive save failed; inspect before retrying." };
  } finally {
    try { reader?.releaseLock(); } catch { /* already released */ }
    if (file) await file.close().catch(() => {});
    await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}
