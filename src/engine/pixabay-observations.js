// Diagnostic observations for ONE manually selected Pixabay planning lead.
// This is deliberately NOT a rights verifier: it cannot establish that the
// contributor owns every depicted right, that a use meets the terms, or that
// an operator-supplied file came from the URL. No result can promote, render or
// publish a source. Inaccessible pages, redirects, ambiguity and parser errors
// remain holds. The ordinary planning and production gates are unchanged.
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validatePixabayLead } from "../discovery/sources/pixabay-planning.js";

const TERMS = "https://pixabay.com/service/terms/";
const SUMMARY = "https://pixabay.com/service/license-summary/";
const MAX_PAGE_BYTES = 1500 * 1024;
const MAX_SOURCE_BYTES = 120 * 1024 * 1024;
const PARSER = fileURLToPath(new URL("../../scripts/extract-pixabay-observations.py", import.meta.url));
const SECTION_IDS = ["section-4-cc0-license", "section-5-content-license", "section-6-attribution"];
const normalized = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const bounded = (value, max = 500) => typeof value === "string" && value.length <= max ? value : null;
const digest = (value) => createHash("sha256").update(value).digest("hex");

async function discard(response) {
  try { await response?.body?.cancel(); } catch { /* no body, already consumed, or already locked */ }
}

async function directHtml(role, url, { fetchImpl, timeoutMs }) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET", redirect: "manual",
      headers: { accept: "text/html", "user-agent": "PrimePlugEvidenceObserver/1.0" },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    return { report: { role, requestedUrl: url, ok: false, reason: "request_failed" } };
  }
  const status = Number(response?.status);
  if (status !== 200 || response?.redirected || (response?.url && response.url !== url)) {
    await discard(response);
    return { report: { role, requestedUrl: url, ok: false, httpStatus: Number.isInteger(status) ? status : null, reason: status >= 300 && status < 400 ? "redirect_refused" : "unavailable_or_unexpected_response" } };
  }
  const type = String(response.headers?.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "text/html") {
    await discard(response);
    return { report: { role, requestedUrl: url, ok: false, httpStatus: status, reason: "unexpected_content_type" } };
  }
  const header = response.headers?.get("content-length");
  if (header && (!/^\d+$/.test(header) || Number(header) > MAX_PAGE_BYTES)) {
    await discard(response);
    return { report: { role, requestedUrl: url, ok: false, httpStatus: status, reason: "page_too_large_or_invalid_length" } };
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    return { report: { role, requestedUrl: url, ok: false, httpStatus: status, reason: "page_body_unavailable" } };
  }
  const reader = response.body.getReader(), chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_PAGE_BYTES) {
        await reader.cancel().catch(() => {});
        return { report: { role, requestedUrl: url, ok: false, httpStatus: status, reason: "page_too_large" } };
      }
      chunks.push(value);
    }
    const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), bytes);
    const body = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return { body, report: { role, requestedUrl: url, ok: true, httpStatus: status, bytes, sha256: digest(buffer) } };
  } catch {
    return { report: { role, requestedUrl: url, ok: false, httpStatus: status, reason: "page_read_or_decode_failed" } };
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}

// Hash only a local regular file; this does not demonstrate its origin. A
// later real renderer must still fetch the exact reviewed rendition safely and
// compare its bytes. Reject symlinks, over-sized input and observed mutation.
export async function observeLocalSourceFile(path) {
  const noFollow = constants.O_NOFOLLOW, nonBlocking = constants.O_NONBLOCK;
  if (!Number.isInteger(noFollow) || !noFollow || !Number.isInteger(nonBlocking) || !nonBlocking) throw new Error("This platform cannot safely open source files.");
  // Avoid hanging on a named pipe while still refusing symlinks.
  const file = await open(path, constants.O_RDONLY | noFollow | nonBlocking);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size < 1 || before.size > MAX_SOURCE_BYTES) throw new Error("Source file is empty, not regular, or exceeds the size limit.");
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      if (bytes > MAX_SOURCE_BYTES) throw new Error("Source file exceeds the size limit.");
      hash.update(chunk);
    }
    const after = await file.stat();
    if (bytes !== before.size || before.size !== after.size || before.ino !== after.ino || before.dev !== after.dev || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error("Source file changed while it was being hashed.");
    }
    return { sha256: hash.digest("hex"), bytes, provenance: "operator_supplied_file_not_independently_bound_to_url" };
  } finally { await file.close(); }
}

function pythonExtract(pages, pythonPath) {
  const child = spawnSync(pythonPath, [PARSER], {
    input: JSON.stringify(pages), encoding: "utf8", timeout: 20000, maxBuffer: 1024 * 1024
  });
  if (child.error || child.status !== 0) return null;
  try { return JSON.parse(child.stdout); } catch { return null; }
}
function equalsResolved(value, expected) {
  try { return new URL(value, "https://pixabay.com/").href === expected; } catch { return false; }
}
const MONTHS = new Map(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((m, i) => [m, i]));
function displayedDate(value) {
  const match = /^(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})$/.exec(normalized(value));
  if (!match) return null;
  const year = Number(match[3]), month = MONTHS.get(match[1]), day = Number(match[2]);
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day ? date : null;
}
function structuredDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(String(value ?? ""));
  if (!match) return null;
  // Date.parse can normalize impossible calendar dates such as February 30.
  // Check the stated calendar date before accepting the timestamp.
  const year = Number(match[1]), month = Number(match[2]) - 1, day = Number(match[3]);
  const calendar = new Date(Date.UTC(year, month, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month || calendar.getUTCDate() !== day) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
function dateKey(date) { return date.toISOString().slice(0, 10); }

// `fetchImpl` and `now` are injectable for offline tests. They are not a
// substitute for a live rights check. Returned observations are never an
// independently verified rights status, even when every comparison matches.
export async function observePixabayLead(candidate, {
  fetchImpl = fetch, pythonPath = process.env.PYTHON ?? "python3", timeoutMs = 20000,
  now = () => new Date(), sourceFile = null
} = {}) {
  if (!validatePixabayLead(candidate)) throw new Error("A valid, unverified Pixabay planning lead is required.");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error("Invalid page-request timeout.");
  const readClock = () => new Date(typeof now === "function" ? now() : now);
  const started = readClock();
  if (!Number.isFinite(started.getTime())) throw new Error("The observer clock is invalid.");
  const report = {
    version: 1, kind: "pixabay_observation_only", provider: "pixabay",
    providerAssetId: candidate.providerAssetId, itemPageUrl: candidate.rightsEvidenceUrl,
    renditionUrl: candidate.sourceUrl, creatorClaim: candidate.creator,
    startedAt: started.toISOString(), clockSource: "runner_local_clock_unverified",
    pageRequests: [], observed: null, sourceFile: null,
    rightsStatus: "evidence_recorded_not_independently_verified", productionEligible: false,
    uploadApproved: false, blockers: []
  };
  if (sourceFile) {
    try { report.sourceFile = await observeLocalSourceFile(sourceFile); }
    catch { report.blockers.push("local_source_file_could_not_be_safely_hashed"); }
  } else report.blockers.push("local_source_file_not_hashed");

  const item = await directHtml("item", candidate.rightsEvidenceUrl, { fetchImpl, timeoutMs });
  report.pageRequests.push(item.report);
  if (!item.report.ok) report.blockers.push("direct_item_page_unavailable");
  if (item.report.ok) {
    const [terms, summary] = await Promise.all([
      directHtml("terms", TERMS, { fetchImpl, timeoutMs }),
      directHtml("license_summary", SUMMARY, { fetchImpl, timeoutMs })
    ]);
    report.pageRequests.push(terms.report, summary.report);
    if (!terms.report.ok) report.blockers.push("direct_terms_page_unavailable");
    if (!summary.report.ok) report.blockers.push("direct_license_summary_unavailable");
    if (terms.report.ok && summary.report.ok) {
      const parsed = pythonExtract({ item: item.body, terms: terms.body, summary: summary.body }, pythonPath);
      if (!parsed?.item || !parsed?.terms || !parsed?.summary) report.blockers.push("page_observation_parser_unavailable_or_failed");
      else {
        const p = parsed.item, pol = parsed.terms, sum = parsed.summary;
        const v = Array.isArray(p.videoObjects) && p.videoObjects.length === 1 ? p.videoObjects[0] : null;
        const canonicalMatches = Array.isArray(p.canonicals) && p.canonicals.length === 1 && equalsResolved(p.canonicals[0], candidate.rightsEvidenceUrl);
        const itemLinkMatches = v && equalsResolved(v.acquireLicensePage, candidate.rightsEvidenceUrl);
        const renditionMatches = v && v.contentUrl === candidate.sourceUrl;
        const creatorMatches = v && normalized(v.creator) === normalized(candidate.creator);
        const dimensionsMatch = v && Number(v.width) === candidate.sourceWidth && Number(v.height) === candidate.sourceHeight;
        const licenseMatches = v && v.license === SUMMARY && Array.isArray(p.licenseLabels) && p.licenseLabels.length === 1;
        const visible = Array.isArray(p.publishedDates) && p.publishedDates.length === 1 ? displayedDate(p.publishedDates[0]) : null;
        const published = v ? structuredDate(v.datePublished) : null, uploaded = v ? structuredDate(v.uploadDate) : null;
        const visibleMillis = visible?.getTime(), publishedDay = published ? Date.parse(dateKey(published) + "T00:00:00Z") : NaN;
        const dayGap = visible && published ? Math.abs(visibleMillis - publishedDay) / 86400000 : null;
        // Hold the policy-change boundary day itself as well: displayed
        // local dates and structured UTC timestamps can differ by a day.
        const safelyAfterCutoff = "2019-01-10";
        const afterCutoff = visible && published && dateKey(visible) >= safelyAfterCutoff && dateKey(published) >= safelyAfterCutoff;
        const unambiguousDate = Boolean(visible && published && uploaded && dayGap <= 1 && dateKey(published) === dateKey(uploaded)
          && afterCutoff && visible.getTime() <= started.getTime() && published.getTime() <= started.getTime());
        const termsValid = Array.isArray(pol.titles) && pol.titles.length === 1 && pol.titles[0] === "Pixabay Terms of Service"
          && Array.isArray(pol.updated) && pol.updated.length === 1 && normalized(pol.updated[0]).startsWith("Last updated:")
          && SECTION_IDS.every((id) => pol.sections?.[id] && /^[a-f0-9]{64}$/.test(pol.sections[id].sha256 ?? "") && Number(pol.sections[id].characters) >= 50);
        const summaryValid = Array.isArray(sum.titles) && sum.titles.length === 1 && sum.titles[0] === "Content License Summary"
          && Array.isArray(sum.headings) && sum.headings.includes("What are you allowed to do with Content?") && sum.headings.includes("What are you not allowed to do with Content?");
        report.observed = {
          canonicalMatches: Boolean(canonicalMatches), itemLinkMatches: Boolean(itemLinkMatches), renditionMatches: Boolean(renditionMatches),
          creatorMatches: Boolean(creatorMatches), dimensionsMatch: Boolean(dimensionsMatch), contentLicenseLabelMatches: Boolean(licenseMatches),
          itemVideoObjectCount: Array.isArray(p.videoObjects) ? p.videoObjects.length : null,
          observedCanonical: p.canonicals?.length === 1 ? bounded(p.canonicals[0]) : null,
          observedRendition: bounded(v?.contentUrl), observedCreator: bounded(v?.creator, 200),
          visiblePublishedDate: p.publishedDates?.length === 1 ? bounded(p.publishedDates[0], 80) : null,
          structuredPublishedDate: bounded(v?.datePublished, 80), structuredUploadDate: bounded(v?.uploadDate, 80),
          dateDifferenceDays: dayGap, dateUnambiguousPost2019: unambiguousDate,
          termsStructurePresent: Boolean(termsValid), termsUpdated: pol.updated?.length === 1 ? bounded(pol.updated[0], 120) : null,
          termsSectionHashes: Object.fromEntries(SECTION_IDS.map((id) => [id, pol.sections?.[id]?.sha256 ?? null])),
          summaryStructurePresent: Boolean(summaryValid)
        };
        if (!canonicalMatches || !itemLinkMatches || !v) report.blockers.push("item_identity_not_unambiguously_observed");
        if (!renditionMatches) report.blockers.push("exact_rendition_not_observed_in_item_metadata");
        if (!creatorMatches) report.blockers.push("creator_missing_or_changed");
        if (!dimensionsMatch) report.blockers.push("rendition_dimensions_missing_or_changed");
        if (!licenseMatches) report.blockers.push("content_license_label_missing_or_inconsistent");
        if (!unambiguousDate) report.blockers.push("published_date_or_pre2019_licence_requires_manual_resolution");
        if (!termsValid || !summaryValid) report.blockers.push("provider_policy_structure_unavailable_or_changed");
      }
    }
  }
  // A matching page is metadata, not a finding that the licence actually
  // covers the intended edit or all third-party rights. It also cannot prove
  // the local file's origin or approve the separate publication decision.
  report.blockers.push("file_origin_and_complete_footage_not_independently_reviewed", "human_rights_attribution_and_third_party_review_required", "pixabay_production_path_not_enabled");
  const finished = readClock();
  if (!Number.isFinite(finished.getTime()) || finished < started) {
    report.blockers.push("observer_clock_invalid_or_moved_backwards");
    report.finishedAt = null;
  } else report.finishedAt = finished.toISOString();
  report.observationStatus = report.blockers.some((b) => !["local_source_file_not_hashed", "file_origin_and_complete_footage_not_independently_reviewed", "human_rights_attribution_and_third_party_review_required", "pixabay_production_path_not_enabled"].includes(b)) ? "needs_investigation" : "consistent_metadata_manual_review_required";
  return report;
}
