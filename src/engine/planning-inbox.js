// A durable handoff between reusable-footage discovery and production.
// Discovery, model output, and a complete-looking JSON object are NOT a
// reviewed plan. Only an explicit editorial review of the actual source,
// narration, opening, and rights may promote a record. This module does not
// upload, change a schedule, or make an upload/audience decision.
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { screenCandidate } from "./scheduler.js";
import { sameSourceUrl, sourceIdentity } from "./source-identity.js";
import { verifyCandidateRights } from "./rights-verification.js";
import { commonsCandidateFromPage } from "../discovery/sources/commons.js";
import { canonicalPixabayLead, pixabayLeadKey } from "../discovery/sources/pixabay-planning.js";
import { validateNarratedEntry, validateVisualHookReview, validateOriginalAudioPlan } from "../production/narrated-plan.js";

// Bounded rather than silently growing forever. At capacity, intake is held
// and surfaced to the operator; records are never discarded automatically.
const MAX_RECORDS = 5000;
const VALID_STATUSES = new Set(["awaiting_review", "reviewed", "rejected"]);
const PENDING = "awaiting_review";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function digest(value) { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function normalText(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
// Stable Commons source identity; exported so the CLI can stage an example's
// source without trusting or importing its old assistant-authored review.
export function sourceKey(url) {
  const identity = sourceIdentity(url);
  return identity ? createHash("sha256").update(identity).digest("hex").slice(0, 24) : null;
}
function canonicalCommonsSource(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.hostname !== "upload.wikimedia.org" || u.username || u.password || !u.pathname.startsWith("/wikipedia/commons/")) return null;
    u.search = ""; u.hash = "";
    return u.href;
  } catch { return null; }
}
function isCommonsFilePage(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "commons.wikimedia.org" && !u.username && !u.password && u.pathname.startsWith("/wiki/File:");
  } catch { return false; }
}
async function atomicWrite(path, value) {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally { await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
}

// Serialise read-modify-write actions in one checked-out state directory.
// A competing writer is an explicit retryable error, not a last-writer-wins
// overwrite of an approval or revocation. This does not lock a remote Git
// branch; operators must coordinate state commits with the daily workflow.
async function withInboxLock(state, operation) {
  const path = state.path(".planning-inbox.lock");
  let handle;
  try { handle = await open(path, "wx", 0o600); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error("Planning inbox is locked by another writer; retry after it finishes.");
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }) + "\n");
    return await operation();
  } finally {
    await handle.close();
    await unlink(path).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

export async function readPlanningInbox(state) {
  let text;
  try { text = await readFile(state.path("planning-inbox.json"), "utf8"); }
  catch (error) { if (error.code === "ENOENT") return { version: 1, records: [] }; throw error; }
  let db;
  try { db = JSON.parse(text); } catch { throw new Error("Planning inbox is invalid JSON; refusing to treat it as an empty inbox."); }
  if (db?.version !== 1 || !Array.isArray(db.records) || db.records.length > MAX_RECORDS || db.records.some((r) => !r || !/^[a-f0-9]{24}$/.test(r.key ?? "") || !VALID_STATUSES.has(r.status) || !r.candidate?.sourceUrl)) {
    throw new Error("Planning inbox has an invalid shape; reviewed candidates are unavailable until it is repaired.");
  }
  if (new Set(db.records.map((r) => r.key)).size !== db.records.length) throw new Error("Planning inbox contains duplicate source identities.");
  return db;
}

function cleanDiscoveredCandidate(candidate) {
  const sourceUrl = canonicalCommonsSource(candidate?.sourceUrl);
  if (!sourceUrl || !isCommonsFilePage(candidate?.rightsEvidenceUrl) || candidate?.discoveredVia !== "wikimedia_commons_api" || candidate?.researchOnly || candidate?.needsProductionPlan !== true) return null;
  if (candidate?.rightsVerification?.status !== "rights_verified_with_evidence" || !screenCandidate({ ...candidate, sourceUrl }).eligible) return null;
  if (!String(candidate.sourceMime ?? "").startsWith("video/") || !Number.isFinite(Number(candidate.sourceHeight)) || Number(candidate.sourceHeight) < 720) return null;
  const title = normalText(candidate.title), creator = normalText(candidate.creator);
  if (!title || title.length > 300 || creator.length < 2 || creator.length > 300 || /unknown creator/i.test(creator)) return null;
  if (JSON.stringify(candidate.license ?? {}).length > 5000) return null;
  return {
    id: `planned-${sourceKey(sourceUrl)}`, title, sourceUrl, creator,
    rightsEvidenceUrl: candidate.rightsEvidenceUrl,
    license: structuredClone(candidate.license),
    rightsVerification: structuredClone(candidate.rightsVerification),
    sourceWidth: Number(candidate.sourceWidth) || null, sourceHeight: Number(candidate.sourceHeight) || null,
    sourceMime: String(candidate.sourceMime ?? "").slice(0, 120),
    discoveredVia: "wikimedia_commons_api", needsProductionPlan: true
  };
}

// Persist only independently rights-screened Commons candidates. Used,
// queued, test-manifest, and already-seeded source identities are excluded.
// A later discovery never overwrites a review or rejection.
export async function ingestPlanningCandidates(state, candidates, { existingSeedSources = [], now = new Date() } = {}) {
  return withInboxLock(state, async () => {
    const db = await readPlanningInbox(state);
    const queue = await state.getQueue();
    let added = 0, ignored = 0, atCapacity = 0;
    for (const raw of candidates ?? []) {
      const candidate = cleanDiscoveredCandidate(raw);
      if (!candidate) { ignored++; continue; }
      const key = sourceKey(candidate.sourceUrl);
      if (existingSeedSources.some((u) => sameSourceUrl(u, candidate.sourceUrl)) || queue.jobs.some((j) => ["queued", "running", "completed", "failed"].includes(j.status) && sameSourceUrl(j.candidate?.sourceUrl, candidate.sourceUrl))) { ignored++; continue; }
      if (db.records.some((r) => r.key === key || sameSourceUrl(r.candidate.sourceUrl, candidate.sourceUrl))) { ignored++; continue; }
      if (db.records.length >= MAX_RECORDS) { atCapacity++; continue; }
      db.records.push({ key, status: PENDING, candidate, discoveredAt: now.toISOString(), updatedAt: now.toISOString() });
      added++;
    }
    if (added) await atomicWrite(state.path("planning-inbox.json"), db);
    return { added, ignored, atCapacity, pending: db.records.filter((r) => r.status === PENDING).length };
  });
}

// Add Pixabay API search results as unverified planning leads only. They
// are intentionally NOT rights-cleared or eligible for production: a provider-
// specific rights verifier and reviewed production pathway are still needed.
// The provider's stable video id deduplicates different size variants.
export async function ingestPixabayLeads(state, leads, { now = new Date() } = {}) {
  if (state?.channelId !== "Primeplug") throw new Error("Pixabay planning is restricted to the Primeplug channel.");
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid planning intake timestamp.");
  return withInboxLock(state, async () => {
    const db = await readPlanningInbox(state);
    const queue = await state.getQueue();
    let added = 0, ignored = 0, atCapacity = 0;
    for (const raw of leads ?? []) {
      const candidate = canonicalPixabayLead(raw);
      if (!candidate) { ignored++; continue; }
      const key = pixabayLeadKey(candidate.providerAssetId);
      if (db.records.some((r) => r.key === key || (r.candidate?.provider === "pixabay" && r.candidate?.providerAssetId === candidate.providerAssetId))
          || queue.jobs.some((j) => ["queued", "running", "completed", "failed"].includes(j.status)
            && (j.candidate?.id === candidate.id || (j.candidate?.provider === "pixabay" && j.candidate?.providerAssetId === candidate.providerAssetId)))) {
        ignored++; continue;
      }
      if (db.records.length >= MAX_RECORDS) { atCapacity++; continue; }
      db.records.push({
        key, status: PENDING, candidate, discoveredAt: date.toISOString(), updatedAt: date.toISOString(),
        productionBlock: "Pixabay item is an unverified lead. The provider-specific rights verification and reviewed production pathway are not yet enabled."
      });
      added++;
    }
    if (added) await atomicWrite(state.path("planning-inbox.json"), db);
    return { added, ignored, atCapacity, pending: db.records.filter((r) => r.status === PENDING).length, productionEligible: false };
  });
}

// Recover previously held sources from the old sources registry. The old
// registry lacks a complete licence/attribution record, so never infer one:
// re-fetch the exact Commons file page and compare the original source URL.
export async function recoverPreviouslyAwaitingCandidates(state, { fetchImpl = fetch, maxSources = 40, existingSeedSources = [], now = new Date() } = {}) {
  const sources = await state.getSources();
  const queue = await state.getQueue();
  const inbox = await readPlanningInbox(state);
  const eligible = Object.values(sources.sources ?? {}).filter((r) => r?.lastOutcome === "awaiting_plan" && canonicalCommonsSource(r.sourceUrl)
    && !inbox.records.some((item) => sameSourceUrl(item.candidate.sourceUrl, r.sourceUrl))
    && !existingSeedSources.some((url) => sameSourceUrl(url, r.sourceUrl))
    && !queue.jobs.some((j) => ["queued", "running", "completed", "failed"].includes(j.status) && sameSourceUrl(j.candidate?.sourceUrl, r.sourceUrl)));
  const limit = Number.isFinite(Number(maxSources)) ? Math.max(0, Math.min(40, Math.floor(Number(maxSources)))) : 40;
  // Rotate the bounded batch each day so the same unreviewable or stale
  // pages cannot permanently starve later previously-held sources.
  const day = Math.floor(new Date(now).getTime() / 86400000);
  const offset = eligible.length && Number.isFinite(day) ? ((day * limit) % eligible.length + eligible.length) % eligible.length : 0;
  const entries = [...eligible.slice(offset), ...eligible.slice(0, offset)].slice(0, limit);
  if (!entries.length) return { items: [], checked: 0, errors: [] };
  const titles = entries.map((r) => {
    try { return `File:${decodeURIComponent(new URL(r.sourceUrl).pathname.split("/").at(-1)).replace(/_/g, " ")}`; } catch { return null; }
  }).filter(Boolean);
  if (!titles.length) return { items: [], checked: entries.length, errors: ["No usable Commons filenames were found."] };
  const api = "https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url%7Csize%7Cmime%7Cextmetadata&titles=" + encodeURIComponent(titles.join("|"));
  try {
    const response = await fetchImpl(api, { headers: { "user-agent": "PrimePlugPlanning/1.0" }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Commons API HTTP ${response.status}`);
    const payload = await response.json();
    const items = [];
    for (const page of Object.values(payload?.query?.pages ?? {})) {
      const item = commonsCandidateFromPage(page);
      if (!item || !String(item.sourceMime ?? "").startsWith("video/") || Number(item.sourceHeight) < 720) continue;
      if (!entries.some((r) => sameSourceUrl(r.sourceUrl, item.sourceUrl))) continue;
      items.push(item);
    }
    return { items, checked: entries.length, errors: [] };
  } catch (error) { return { items: [], checked: entries.length, errors: [String(error?.message ?? error).slice(0, 250)] }; }
}

export function makePlanTemplate(record) {
  if (!record?.candidate || ![PENDING, "reviewed"].includes(record.status)) throw new Error("A pending or reviewed source is required.");
  const c = record.candidate;
  let oldReviewInvalid = false;
  if (record.status === "reviewed") {
    if (validateReviewedRecord(record).valid) {
      return {
        ...structuredClone(record.seed), candidateId: c.id, sourceUrl: c.sourceUrl,
        instructions: "REVISION DRAFT ONLY: inspect the exact source and re-review every changed claim, window, opening and rights term. The old review is not inherited.",
        visualHookReview: { ...structuredClone(record.seed.visualHookReview), status: "review_required", sourceSha256: "", firstActionSourceSeconds: null, reviewedThroughSourceSeconds: null, reviewMethod: "", reviewedBy: "" }
      };
    }
    // An older, incomplete review needs a practical path to a fresh review.
    // Never carry its untrusted plan forward, and refuse a corrupted source
    // identity rather than creating a draft for a different item.
    if (!cleanDiscoveredCandidate(c) || record.key !== sourceKey(c.sourceUrl) || c.id !== `planned-${record.key}`) throw new Error("The existing record's source identity is invalid; investigate it before revising.");
    oldReviewInvalid = true;
  }
  return {
    candidateId: c.id, sourceUrl: c.sourceUrl,
    instructions: c.provider === "pixabay"
      ? "DRAFT ONLY: this Pixabay lead is not rights-cleared and cannot be promoted until a provider-specific rights and production pathway is implemented and tested."
      : oldReviewInvalid
        ? "FRESH DRAFT ONLY: the previous review is invalid and none of its plan was inherited. Inspect the entire source and freshly review the complete window, claims, rights and attribution."
        : "DRAFT ONLY: inspect the exact source and licence. Write only visible, supportable claims. Do not set a review status until a separate real review is complete.",
    productionMode: "narrated", muteOriginalAudio: true,
    window: { startSeconds: null, seconds: null, minimumStorySeconds: null },
    postingTitle: "", hookText: "", narrationScript: "", visualSubject: "",
    hashtags: ["#Shorts", "#FunnyAnimals"],
    storyBeats: { hook: "", development: "", payoff: "" },
    visualHookReview: { status: "review_required", sourceUrl: c.sourceUrl, sourceSha256: "", windowStartSeconds: null, firstActionSourceSeconds: null, reviewedThroughSourceSeconds: null, onScreenText: "", visualAction: "", reviewMethod: "", reviewedBy: "" }
  };
}

function reviewProblems(seed, review, candidate, checkedSourceSha256) {
  const problems = [];
  const hook = validateVisualHookReview(seed), narration = validateNarratedEntry(seed), audio = validateOriginalAudioPlan(seed);
  problems.push(...hook.reasons, ...narration.reasons);
  if (!audio.valid || seed.muteOriginalAudio !== true) problems.push("The planning inbox uses muted source audio; all other audio requires its own cleared pathway.");
  const start = Number(seed?.window?.startSeconds), seconds = Number(seed?.window?.seconds);
  const coverageStart = Number(review?.coverageStartSeconds), coverageEnd = Number(review?.coverageEndSeconds);
  if (!Number.isFinite(start) || start < 0 || !Number.isFinite(seconds) || seconds < 10 || seconds > 60) problems.push("A source window between 10 and 60 seconds is required.");
  // Only a tiny floating-point tolerance is permitted: a half-second gap at
  // the end is not complete coverage. The booleans are attestations, not
  // proof that a human actually watched or that the review was correct.
  if (review?.coverageStartSeconds == null || review?.coverageEndSeconds == null || !Number.isFinite(coverageStart) || !Number.isFinite(coverageEnd) || coverageStart < 0 || coverageStart > start || coverageEnd + 0.000001 < start + seconds) problems.push("The review must cover the complete planned source window, not just its opening.");
  if (review?.humanReviewer !== true || review?.entireSourceWatched !== true || review?.continuousWindowPlayback !== true) problems.push("A human reviewer must attest to watching the entire source and continuously reviewing the complete selected window; sampled frames or AI review alone are insufficient.");
  if (review?.decision !== "reviewed_against_source" || review?.claimsChecked !== true || review?.rightsChecked !== true || review?.openingChecked !== true) problems.push("A separate, explicit review of the footage, claims, rights and opening is required.");
  if (normalText(review?.reviewedBy).length < 3 || normalText(review?.method).length < 25 || normalText(review?.claimNotes).length < 25 || normalText(review?.rightsNotes).length < 25) problems.push("Record who reviewed, the actual review method, claim evidence and rights notes.");
  if (normalText(review?.reviewedBy) !== normalText(seed?.visualHookReview?.reviewedBy)) problems.push("Opening and full-plan reviewer identities do not match.");
  if (!/^[a-f0-9]{64}$/i.test(String(checkedSourceSha256 ?? "")) || checkedSourceSha256.toLowerCase() !== String(seed?.visualHookReview?.sourceSha256 ?? "").toLowerCase()) problems.push("The reviewed opening must match the SHA-256 actually computed from the source file.");
  const credit = normalText(seed?.license?.attributionRequirement);
  const licenceUrl = normalText(candidate?.rightsVerification?.licenceUrl);
  if (!credit.toLowerCase().includes(normalText(candidate.creator).toLowerCase()) || !licenceUrl || !credit.includes(licenceUrl) || !/edit|adapt|modif/i.test(credit)) problems.push("Attribution must identify the creator, exact licence URL, and the edits made.");
  if (candidate?.rightsVerification?.shareAlike && (review?.shareAlikeAcknowledged !== true || !/(?:adaptation|edit|short).{0,100}(?:licen[cs]ed|distributed).{0,120}(?:same|compatible|cc\s*by-sa)/i.test(credit))) problems.push("ShareAlike footage requires explicit review and a statement that the adaptation is licensed under the same or a compatible licence.");
  return problems;
}

// Hash only the same bounded regular file throughout the operation. This is
// byte identity, not proof that the operator actually watched it or that it
// came from the provider URL. The renderer still compares its own download.
export async function hashSourceFile(path) {
  const { O_NOFOLLOW, O_NONBLOCK, O_RDONLY } = constants;
  if (!Number.isInteger(O_NOFOLLOW) || !O_NOFOLLOW || !Number.isInteger(O_NONBLOCK) || !O_NONBLOCK) throw new Error("This platform cannot safely open the reviewed source.");
  // Nonblocking open prevents a named pipe from hanging the review command.
  const file = await open(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  const maxBytes = 2 * 1024 * 1024 * 1024;
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size < 1 || before.size > maxBytes) throw new Error("The reviewed source must be a non-empty regular file of at most 2 GiB.");
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw new Error("The reviewed source exceeded its size limit while hashing.");
      hash.update(chunk);
    }
    const after = await file.stat();
    if (bytes !== before.size || before.size !== after.size || before.ino !== after.ino || before.dev !== after.dev || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error("The reviewed source changed while being hashed; inspect it again.");
    }
    return hash.digest("hex");
  } finally { await file.close(); }
}

// This is an explicit operator action, not a model-generated approval.
// Callers must compute checkedSourceSha256 from the source file they reviewed.
// A fresh rights check occurs here and again immediately before production.
export async function approveReviewedPlan(state, key, draft, review, { checkedSourceSha256, verifyRights = verifyCandidateRights, now = new Date() } = {}) {
  return withInboxLock(state, async () => {
    const db = await readPlanningInbox(state);
    const record = db.records.find((r) => r.key === key);
    if (!record || record.status === "rejected") throw new Error("Pending/reviewed source not found or previously rejected.");
    const c = record.candidate;
    if (c.provider === "pixabay" || c.discoveredVia === "pixabay_official_api") throw new Error("Pixabay leads remain held: provider-specific rights verification and the reviewed production pathway are not yet enabled.");
    if (draft?.candidateId !== c.id || draft?.sourceUrl !== c.sourceUrl) throw new Error("Draft source identity differs from the selected inbox item.");
    const verification = await verifyRights(c);
    const fresh = { ...c, rightsVerification: verification };
    const screen = screenCandidate(fresh);
    if (!screen.eligible) throw new Error("Fresh rights check failed: " + screen.reasons.join("; "));
    if (!normalText(verification.artist) || normalText(verification.artist).toLowerCase() !== normalText(c.creator).toLowerCase()) throw new Error("Creator metadata is missing or changed; re-examine the source before review.");
    const originalLicence = normalText(c.rightsVerification?.licenceUrl);
    if (originalLicence !== normalText(verification.licenceUrl) || Boolean(c.rightsVerification?.shareAlike) !== Boolean(verification.shareAlike)) throw new Error("Licence details changed since discovery; re-examine the source before review.");
    const seed = {
      id: c.id, label: c.title, sourceUrl: c.sourceUrl, creator: c.creator, rightsEvidenceUrl: c.rightsEvidenceUrl,
      sourceResolution: `${c.sourceWidth}x${c.sourceHeight}`,
      license: { ...c.license, attributionRequirement: normalText(review?.attributionText) },
      productionMode: "narrated", muteOriginalAudio: true,
      window: structuredClone(draft.window ?? {}), hookText: String(draft.hookText ?? ""), postingTitle: String(draft.postingTitle ?? ""),
      narrationScript: String(draft.narrationScript ?? ""), visualSubject: String(draft.visualSubject ?? ""),
      hashtags: Array.isArray(draft.hashtags) ? draft.hashtags.slice(0, 12).map(String) : [],
      storyBeats: structuredClone(draft.storyBeats ?? {}), visualHookReview: structuredClone(draft.visualHookReview ?? {})
    };
    if (draft.engagementPrompt) seed.engagementPrompt = String(draft.engagementPrompt).slice(0, 300);
    const attestation = {
      decision: review?.decision, reviewedBy: normalText(review?.reviewedBy), method: normalText(review?.method),
      humanReviewer: review?.humanReviewer === true, entireSourceWatched: review?.entireSourceWatched === true,
      continuousWindowPlayback: review?.continuousWindowPlayback === true,
      coverageStartSeconds: review?.coverageStartSeconds, coverageEndSeconds: review?.coverageEndSeconds,
      claimsChecked: review?.claimsChecked === true, rightsChecked: review?.rightsChecked === true, openingChecked: review?.openingChecked === true,
      claimNotes: normalText(review?.claimNotes), rightsNotes: normalText(review?.rightsNotes),
      shareAlikeAcknowledged: review?.shareAlikeAcknowledged === true,
      sourceSha256: String(checkedSourceSha256 ?? "").toLowerCase(), reviewedAt: now.toISOString()
    };
    const problems = reviewProblems(seed, attestation, fresh, checkedSourceSha256);
    if (problems.length) throw new Error("Plan cannot be promoted: " + problems.join(" "));
    record.candidate.rightsVerification = verification;
    record.status = "reviewed";
    record.seed = seed; record.review = attestation;
    record.reviewDigest = digest({ seed, review: attestation, candidate: record.candidate });
    record.updatedAt = now.toISOString();
    await atomicWrite(state.path("planning-inbox.json"), db);
    return record;
  });
}

// Hashes detect post-review changes; they are not a signature or proof that a
// reviewer was truthful. Producer download hashes, fresh rights verification,
// story/timing, captions, framing and QC gates remain independently mandatory.
export function validateReviewedRecord(record) {
  if (record?.status !== "reviewed" || !record.seed || !record.review || !record.candidate) return { valid: false, reasons: ["No reviewed plan record."] };
  const { seed, review, candidate } = record;
  const reasons = [];
  if (record.key !== sourceKey(candidate.sourceUrl) || candidate.id !== `planned-${record.key}` || seed.id !== candidate.id || seed.sourceUrl !== candidate.sourceUrl || seed.creator !== candidate.creator || seed.rightsEvidenceUrl !== candidate.rightsEvidenceUrl || seed.license?.type !== candidate.license?.type || seed.license?.rightsStatus !== candidate.license?.rightsStatus) reasons.push("Reviewed plan no longer matches the selected source and licence identity.");
  if (record.reviewDigest !== digest({ seed, review, candidate })) reasons.push("Source, plan or review changed after the explicit editorial review.");
  if (!cleanDiscoveredCandidate(candidate)) reasons.push("The saved source is no longer an independently screened, usable Commons video.");
  reasons.push(...reviewProblems(seed, review, candidate, review.sourceSha256));
  if (!canonicalCommonsSource(seed.sourceUrl) || !isCommonsFilePage(seed.rightsEvidenceUrl) || seed.testOnly === true) reasons.push("Source identity or production eligibility is invalid.");
  return { valid: reasons.length === 0, reasons };
}

async function readReviewedBootstrap(path) {
  if (!path) return [];
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (parsed?.version !== 1 || !Array.isArray(parsed.records) || parsed.records.length > 20 || parsed.records.some((r) => !r || typeof r !== "object")) throw new Error("Invalid reviewed bootstrap format.");
    return parsed.records;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error("Reviewed bootstrap is invalid: " + error.message);
  }
}

// Persist valid bootstrap records before operating, so the same CLI can
// display, review and revoke them. Existing state, including a rejection or
// a pending record, always wins; old bootstrap data cannot resurrect it.
export async function materializeReviewedBootstrap(state, { bootstrapPath = null } = {}) {
  const bootstrap = await readReviewedBootstrap(bootstrapPath);
  if (!bootstrap.length) return { added: 0, invalid: [] };
  return withInboxLock(state, async () => {
    const db = await readPlanningInbox(state);
    const counts = new Map();
    for (const record of bootstrap) counts.set(record.key, (counts.get(record.key) ?? 0) + 1);
    const overridden = new Set(db.records.map((r) => r.key));
    const invalid = [];
    let added = 0;
    for (const record of bootstrap) {
      if (overridden.has(record.key)) continue;
      const checked = validateReviewedRecord(record);
      if (!checked.valid || counts.get(record.key) !== 1) {
        invalid.push({ key: record.key ?? null, reasons: checked.valid ? ["Duplicate bootstrap identity."] : checked.reasons });
        continue;
      }
      if (db.records.length >= MAX_RECORDS) throw new Error("Planning inbox is at capacity; bootstrap records were not added.");
      db.records.push(structuredClone(record)); added++;
    }
    if (added) await atomicWrite(state.path("planning-inbox.json"), db);
    return { added, invalid };
  });
}

// State decisions override the bootstrap on the same source: a pending or
// rejected record must not silently resurrect an older reviewed plan.
export async function reviewedPlanningSeeds(state, { bootstrapPath = null } = {}) {
  const db = await readPlanningInbox(state);
  const bootstrap = await readReviewedBootstrap(bootstrapPath);
  const overridden = new Set(db.records.map((r) => r.key));
  const bootstrapCounts = new Map();
  for (const r of bootstrap) if (!overridden.has(r.key)) bootstrapCounts.set(r.key, (bootstrapCounts.get(r.key) ?? 0) + 1);
  const all = [...bootstrap.filter((r) => !overridden.has(r.key)), ...db.records];
  const seen = new Set(), seeds = [], invalid = [];
  for (const record of all) {
    if (record.status !== "reviewed") {
      if (bootstrap.includes(record)) invalid.push({ key: record.key ?? null, reasons: ["Bootstrap record is not reviewed."] });
      continue;
    }
    const checked = validateReviewedRecord(record);
    if (!checked.valid || seen.has(record.key) || (bootstrap.includes(record) && bootstrapCounts.get(record.key) !== 1)) {
      invalid.push({ key: record.key ?? null, reasons: checked.valid ? ["Duplicate reviewed identity."] : checked.reasons }); continue;
    }
    seen.add(record.key); seeds.push(record.seed);
  }
  return { seeds, invalid, inbox: db };
}

export async function rejectPlanningSource(state, key, { reviewedBy, reason, now = new Date() } = {}) {
  return withInboxLock(state, async () => {
    const db = await readPlanningInbox(state), record = db.records.find((r) => r.key === key);
    if (!record) throw new Error("Planning source not found.");
    if (normalText(reviewedBy).length < 3 || normalText(reason).length < 15) throw new Error("A reviewer and a specific reason are required to reject a source.");
    record.status = "rejected"; record.rejection = { reviewedBy: normalText(reviewedBy), reason: normalText(reason), at: now.toISOString() };
    delete record.seed; delete record.review; delete record.reviewDigest;
    record.updatedAt = now.toISOString();
    await atomicWrite(state.path("planning-inbox.json"), db);
    return record;
  });
}

export async function planningSummary(state, { bootstrapPath = null } = {}) {
  const loaded = await reviewedPlanningSeeds(state, { bootstrapPath });
  const queue = await state.getQueue();
  const jobsFor = (s) => queue.jobs.filter((j) => sameSourceUrl(j.candidate?.sourceUrl, s.sourceUrl));
  const available = loaded.seeds.filter((s) => !jobsFor(s).some((j) => ["queued", "running", "completed", "failed"].includes(j.status)));
  const queued = loaded.seeds.filter((s) => jobsFor(s).some((j) => ["queued", "running"].includes(j.status)));
  return {
    awaitingReview: loaded.inbox.records.filter((r) => r.status === PENDING).length,
    pixabayLeadsBlocked: loaded.inbox.records.filter((r) => r.status === PENDING && r.candidate?.provider === "pixabay").length,
    reviewedAvailable: available.length,
    reviewedQueued: queued.length,
    rejected: loaded.inbox.records.filter((r) => r.status === "rejected").length,
    invalidReviewed: loaded.invalid.length,
    totalRecords: loaded.inbox.records.length,
    capacity: MAX_RECORDS,
    pending: loaded.inbox.records.filter((r) => r.status === PENDING).slice(0, 10).map((r) => ({ key: r.key, title: r.candidate.title, sourceUrl: r.candidate.sourceUrl, rightsEvidenceUrl: r.candidate.rightsEvidenceUrl, licence: r.candidate.license?.type ?? null, provider: r.candidate.provider ?? "wikimedia_commons", rightsStatus: r.candidate.license?.rightsStatus ?? "unknown", productionBlocked: Boolean(r.productionBlock) }))
  };
}
