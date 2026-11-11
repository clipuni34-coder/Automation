// Operator-initiated Pixabay source discovery for the Primeplug planning inbox.
// This module never downloads footage, verifies third-party rights, creates a
// production plan or approves an upload. API search results remain leads.
//
// Pixabay's published API guidance requires 24-hour caching, says requests
// should represent real human use, and prohibits systematic mass downloads.
// Accordingly this is an explicit one-query action, not an autonomous daily
// search loop. https://pixabay.com/api/docs/ (review terms before live use).
import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { searchPixabayVideos } from "../../production/pixabay.js";

export const PIXABAY_SEARCH_CACHE_MS = 24 * 60 * 60 * 1000;
// Our conservative operational limit, not a claim about Pixabay's own limit.
// Cache hits do not count as new searches; failed requests do.
export const PIXABAY_MAX_RECENT_QUERIES = 5;
const MAX_CACHE_ENTRIES = PIXABAY_MAX_RECENT_QUERIES;
const MAX_RESULTS = 12;
const MAX_SOURCE_BYTES = 120 * 1024 * 1024;
const PROVIDER_TERMS = "https://pixabay.com/service/terms/";
const POSSIBLY_GENERATED = /\b(?:ai[\s_-]*generated|generated[\s_-]*by[\s_-]*ai|ai[\s_-]*video|animation|animated|cartoon|3d[\s_-]*render)\b/i;

function normalText(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
export function pixabayLeadKey(id) {
  const n = Number(id);
  return Number.isSafeInteger(n) && n > 0 ? hash(`pixabay:video:${n}`).slice(0, 24) : null;
}

function validPage(value, id) {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.hostname !== "pixabay.com" || u.port || u.username || u.password || u.search || u.hash) return false;
    const match = /^\/videos\/[^/]+-(\d+)\/?$/.exec(u.pathname);
    return Boolean(match && Number(match[1]) === Number(id));
  } catch { return false; }
}
function validMedia(value, id) {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.hostname !== "cdn.pixabay.com" || u.port || u.username || u.password || u.search || u.hash || !u.pathname.startsWith("/video/")) return false;
    const filename = u.pathname.split("/").at(-1) ?? "";
    return filename.startsWith(`${id}-`) && /\.mp4$/i.test(filename);
  } catch { return false; }
}

// The API listing is only a lead. Individual licence class, third-party
// rights, editorial suitability and source content have NOT been checked.
export function pixabayLeadFromVideo(asset, { now = new Date() } = {}) {
  const key = pixabayLeadKey(asset?.id);
  const id = Number(asset?.id), creator = normalText(asset?.attribution?.creator);
  const tags = normalText(asset?.tags).slice(0, 500);
  const width = Number(asset?.file?.width), height = Number(asset?.file?.height);
  const seconds = Number(asset?.durationSeconds), size = asset?.file?.size == null ? null : Number(asset.file.size);
  if (!key || !validPage(asset.sourceUrl, id) || !validMedia(asset.file?.url, id)) return null;
  if (asset.mediaType !== "film" || !creator || creator.length > 200 || !tags || POSSIBLY_GENERATED.test(tags)) return null;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 720 || height < 720 || !Number.isFinite(seconds) || seconds < 10) return null;
  if (size !== null && (!Number.isFinite(size) || size <= 0 || size > MAX_SOURCE_BYTES)) return null;
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid Pixabay discovery timestamp.");
  return {
    id: `planned-${key}`,
    title: tags.replace(/,\s*/g, ", ").slice(0, 200),
    sourceUrl: asset.file.url, rightsEvidenceUrl: asset.sourceUrl, creator,
    provider: "pixabay", providerAssetId: String(id), discoveredVia: "pixabay_official_api",
    sourceWidth: width, sourceHeight: height, sourceMime: "video/mp4", sourceDurationSeconds: seconds,
    sourceSizeBytes: size,
    license: {
      type: "Pixabay terms or applicable CC0: individual item not yet verified",
      rightsStatus: "unverified",
      basis: "The official API identified a Pixabay item. Its publication date, exact applicable terms and third-party rights are not yet independently checked.",
      attributionRequirement: `${creator}, Pixabay: ${asset.sourceUrl}. Terms: ${PROVIDER_TERMS}`
    },
    rightsVerification: {
      status: "evidence_recorded_not_independently_verified",
      checkedAt: date.toISOString(), verificationMethod: "pixabay_api_listing_only",
      reasons: ["API metadata is a lead, not individual rights clearance. Verify the item page, publication date, applicable licence, third-party rights and intended use before production."]
    },
    needsProductionPlan: true, needsRightsReview: true
  };
}

// Revalidate before writing cached leads or accepting one into state. This is
// intentionally stricter than general Pixabay search and never sets rights
// status to approved. A query-bearing URL could contain a secret, so no URL
// query is saved in the state branch.
export function validatePixabayLead(candidate) {
  const key = pixabayLeadKey(candidate?.providerAssetId);
  const width = Number(candidate?.sourceWidth), height = Number(candidate?.sourceHeight), seconds = Number(candidate?.sourceDurationSeconds);
  const size = candidate?.sourceSizeBytes;
  return Boolean(key && String(Number(candidate?.providerAssetId)) === candidate?.providerAssetId
    && candidate?.id === `planned-${key}` && candidate?.provider === "pixabay"
    && candidate?.discoveredVia === "pixabay_official_api" && candidate?.needsProductionPlan === true && candidate?.needsRightsReview === true
    && candidate?.license?.rightsStatus === "unverified" && candidate?.rightsVerification?.status === "evidence_recorded_not_independently_verified"
    && validPage(candidate?.rightsEvidenceUrl, candidate?.providerAssetId) && validMedia(candidate?.sourceUrl, candidate?.providerAssetId)
    && normalText(candidate?.creator).length > 0 && normalText(candidate?.creator).length <= 200
    && normalText(candidate?.title).length > 0 && normalText(candidate?.title).length <= 200 && !POSSIBLY_GENERATED.test(normalText(candidate.title))
    && Number.isFinite(width) && width >= 720 && Number.isFinite(height) && height >= 720
    && Number.isFinite(seconds) && seconds >= 10 && candidate?.sourceMime === "video/mp4"
    && Number.isFinite(Date.parse(candidate?.rightsVerification?.checkedAt))
    && (size === null || (Number.isFinite(size) && size > 0 && size <= MAX_SOURCE_BYTES)));
}

// Reconstruct a whitelisted record rather than copying arbitrary extra fields
// from an on-disk cache or an untrusted caller into the persistent inbox.
export function canonicalPixabayLead(candidate) {
  if (!validatePixabayLead(candidate)) return null;
  return pixabayLeadFromVideo({
    id: Number(candidate.providerAssetId), sourceUrl: candidate.rightsEvidenceUrl,
    file: { url: candidate.sourceUrl, width: Number(candidate.sourceWidth), height: Number(candidate.sourceHeight), size: candidate.sourceSizeBytes },
    attribution: { creator: candidate.creator }, tags: candidate.title,
    durationSeconds: Number(candidate.sourceDurationSeconds), mediaType: "film"
  }, { now: new Date(candidate.rightsVerification.checkedAt) });
}

async function withCacheLock(state, fn) {
  const path = state.path(".pixabay-search.lock");
  let handle;
  try { handle = await open(path, "wx", 0o600); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error("Pixabay search cache is locked; wait for the other request or inspect a stale lock.");
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }) + "\n");
    return await fn();
  } finally {
    await handle.close();
    await unlink(path).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

async function readCache(state) {
  let contents;
  try { contents = await readFile(state.path("pixabay-search-cache.json"), "utf8"); }
  catch (error) { if (error.code === "ENOENT") return { version: 1, entries: [] }; throw error; }
  let db;
  try { db = JSON.parse(contents); } catch { throw new Error("Pixabay search cache is invalid JSON; refusing a new API request until repaired."); }
  if (db?.version !== 1 || !Array.isArray(db.entries) || db.entries.length > MAX_CACHE_ENTRIES || db.entries.some((e) => !/^[a-f0-9]{64}$/.test(e?.key ?? "") || !Number.isFinite(Date.parse(e?.fetchedAt)) || !["pending", "failed", "ok"].includes(e?.status) || !Array.isArray(e?.leads) || e.leads.length > MAX_RESULTS || e.leads.some((lead) => !validatePixabayLead(lead)) || (e.status !== "ok" && e.leads.length))) {
    throw new Error("Pixabay search cache has an invalid shape; refusing a new API request until repaired.");
  }
  if (new Set(db.entries.map((e) => e.key)).size !== db.entries.length) throw new Error("Pixabay search cache contains duplicate queries.");
  return { version: 1, entries: db.entries.map((entry) => ({ key: entry.key, fetchedAt: entry.fetchedAt, status: entry.status, leads: entry.leads.map(canonicalPixabayLead) })) };
}

async function writeCache(state, db) {
  const path = state.path("pixabay-search-cache.json");
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, JSON.stringify(db, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally { await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
}

// Each invocation represents an actual operator's one query. No scheduled
// caller is wired. A repeated query uses its cached result for 24 hours after
// receipt, even if a key is no longer available; no API key or provider
// response URL with query parameters is persisted or returned. `now` may be a
// fixed Date for tests or a clock function (the default) for real requests.
export async function searchPixabayForReview(state, query, { apiKey = process.env.PIXABAY_API_KEY ?? "", fetchImpl = fetch, now = () => new Date() } = {}) {
  if (state?.channelId !== "Primeplug") throw new Error("Pixabay planning is restricted to the Primeplug channel.");
  const normalized = normalText(query);
  if (!normalized || normalized.length > 100) throw new Error("Enter one specific Pixabay search of at most 100 characters.");
  if (apiKey && normalized.includes(String(apiKey))) throw new Error("The search query must not contain an API key.");
  const readClock = () => new Date(typeof now === "function" ? now() : now);
  const date = readClock(), nowMs = date.getTime();
  if (!Number.isFinite(nowMs)) throw new Error("Invalid Pixabay search time.");
  const key = hash(JSON.stringify({ query: normalized.toLowerCase(), videoType: "film", safe: true, perPage: MAX_RESULTS }));
  return withCacheLock(state, async () => {
    const db = await readCache(state);
    const existing = db.entries.find((entry) => entry.key === key);
    if (existing) {
      const age = nowMs - Date.parse(existing.fetchedAt);
      if (age < 0) throw new Error("Pixabay cache timestamp is in the future; verify the clock before requesting again.");
      // A process could have died after sending a request but before saving
      // its response. Its receipt time is unknown: never silently expire it.
      if (existing.status === "pending") throw new Error("The previous Pixabay request is still pending; inspect the state before any retry.");
      if (age < PIXABAY_SEARCH_CACHE_MS) {
        if (existing.status !== "ok") throw new Error("The previous Pixabay request failed; it will not be repeated during the 24-hour cache period.");
        return { status: "ok", cached: true, fetchedAt: existing.fetchedAt, leads: structuredClone(existing.leads) };
      }
    }
    if (!apiKey) throw new Error("PIXABAY_API_KEY is required for a new search; do not paste the key into chat.");
    const fresh = db.entries.filter((entry) => {
      const age = nowMs - Date.parse(entry.fetchedAt);
      if (age < 0) throw new Error("Pixabay cache timestamp is in the future; verify the clock before requesting again.");
      return entry.status === "pending" || age < PIXABAY_SEARCH_CACHE_MS;
    });
    if (fresh.length >= MAX_CACHE_ENTRIES) throw new Error("Pixabay search cache is full of recent queries; wait rather than evict 24-hour entries.");
    // Reserve the 24-hour cache slot BEFORE making the request. A crash or a
    // failed final write cannot cause an unseen automatic repeat of a request.
    const record = { key, fetchedAt: date.toISOString(), status: "pending", leads: [] };
    fresh.push(record);
    await writeCache(state, { version: 1, entries: fresh });
    try {
      const search = await searchPixabayVideos({ query: normalized, apiKey, fetchImpl, perPage: MAX_RESULTS, videoType: "film" });
      if (search.status !== "ok") throw new Error("Pixabay search did not return a usable response.");
      const seen = new Set(), leads = [];
      const secretForms = [...new Set([String(apiKey), encodeURIComponent(String(apiKey)), new URLSearchParams({ key: String(apiKey) }).toString().slice(4)])].filter(Boolean);
      for (const video of search.videos) {
        const lead = pixabayLeadFromVideo(video, { now: date });
        if (!lead || !validatePixabayLead(lead) || seen.has(lead.providerAssetId)) continue;
        // Defend against a provider unexpectedly echoing a credential into a
        // public field; the API key itself must never enter state or summaries.
        if (secretForms.some((secret) => JSON.stringify(lead).includes(secret))) continue;
        seen.add(lead.providerAssetId); leads.push(lead);
        if (leads.length >= MAX_RESULTS) break;
      }
      // The 24-hour period starts when the response was received, not when
      // the request started. A backward/broken clock leaves the reservation
      // pending rather than risking an early repeated request.
      const completed = readClock();
      if (!Number.isFinite(completed.getTime()) || completed.getTime() < nowMs) throw new Error("Pixabay cache clock moved backwards or became invalid; the pending request needs investigation.");
      record.fetchedAt = completed.toISOString(); record.status = "ok"; record.leads = leads;
      await writeCache(state, { version: 1, entries: fresh });
      return { status: "ok", cached: false, fetchedAt: record.fetchedAt, leads: structuredClone(leads) };
    } catch (error) {
      let completed;
      try { completed = readClock(); } catch { /* leave the earlier pending reservation */ }
      if (completed && Number.isFinite(completed.getTime()) && completed.getTime() >= nowMs) {
        record.fetchedAt = completed.toISOString(); record.status = "failed"; record.leads = [];
        await writeCache(state, { version: 1, entries: fresh }).catch(() => {}); // pending reservation remains on write failure
      }
      throw error;
    }
  });
}
