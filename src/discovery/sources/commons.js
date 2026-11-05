// Wikimedia Commons discovery for genuinely reusable footage.
//
// Unlike YouTube search results (research references only — a search hit
// is never proof of reuse permission), every candidate returned here has
// had its licence read from the asset's own Commons file page via the
// Commons API and classified by the exact rights verifier. Only
// independently verified public-domain / CC BY / CC BY-SA videos are
// returned as items; everything else is reported in `rejected` with the
// reason, and never counted as a production candidate.
//
// Returned candidates carry full provenance: file page (evidence),
// direct source URL, creator, exact licence family + version, licence
// URL and attribution text. They are flagged `needsProductionPlan`:
// discovery establishes reusable footage, but a Short is only produced
// after an editorial production plan (narration/edit) exists for it.
import { classifyObservedLicence, parseLicenceIdentity } from "../../engine/rights-verification.js";

const ALLOWED_FAMILIES = new Set(["by", "by-sa", "public-domain", "cc0"]);

export function commonsCandidateFromPage(page, { now = new Date() } = {}) {
  const info = page?.imageinfo?.[0];
  if (!info?.url || !info?.descriptionurl) return null;
  const meta = info.extmetadata ?? {};
  const observedLicence = meta?.LicenseShortName?.value ?? null;
  const identity = parseLicenceIdentity(`${observedLicence ?? ""} ${meta?.LicenseUrl?.value ?? ""}`);
  if (!identity || !ALLOWED_FAMILIES.has(identity.family)) return null;
  // Verify with the claim set to exactly what the page records: this
  // proves the observed licence is an exact, reusable licence. (Seeds
  // additionally compare against their pre-recorded claim.)
  const verification = {
    candidateId: null,
    claimedType: observedLicence,
    claimedStatus: identity.kind === "public-domain" || identity.kind === "cc0" ? "public_domain" : "licensed",
    evidenceUrl: info.descriptionurl,
    checkedAt: now.toISOString(),
    verificationMethod: "wikimedia_commons_api_extmetadata",
    ...classifyObservedLicence({ claimedType: observedLicence, claimedStatus: identity.kind === "public-domain" ? "public_domain" : "licensed", observedMeta: meta })
  };
  if (verification.status !== "rights_verified_with_evidence") return null;
  const artist = verification.artist || "Unknown creator (see Commons file page)";
  const licenceLabel = observedLicence ?? identity.family;
  const hashSeed = `${info.url}`;
  let h = 0; for (let i = 0; i < hashSeed.length; i++) h = (h * 31 + hashSeed.charCodeAt(i)) >>> 0;
  return {
    id: `commons-${h.toString(16)}`,
    title: String(page.title ?? "").replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " "),
    sourceUrl: info.url,
    creator: artist,
    rightsEvidenceUrl: info.descriptionurl,
    license: {
      type: licenceLabel,
      rightsStatus: identity.kind === "public-domain" || identity.kind === "cc0" ? "public_domain" : "licensed",
      basis: `Licence read from the asset's Commons file page via API at discovery time (${licenceLabel}).`,
      attributionRequirement: identity.kind === "public-domain" || identity.kind === "cc0"
        ? `Public domain / CC0 — credit appreciated: ${artist}, via Wikimedia Commons.`
        : `Credit: ${artist}, via Wikimedia Commons, ${licenceLabel}${verification.licenceUrl ? ` (${verification.licenceUrl})` : ""}.`,
      verificationStatus: "independently_verified_via_commons_api"
    },
    rightsVerification: verification,
    sourceWidth: info.width ?? null,
    sourceHeight: info.height ?? null,
    sourceMime: info.mime ?? null,
    discoveredVia: "wikimedia_commons_api",
    needsProductionPlan: true
  };
}

export async function collectCommonsCandidates({ queries = [], fetchImpl = fetch, perQuery = 4, minHeight = 720, now = new Date() } = {}) {
  const items = [];
  const rejected = [];
  const seen = new Set();
  for (const query of queries) {
    const api = "https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search"
      + `&gsrsearch=${encodeURIComponent(`filetype:video ${query}`)}&gsrnamespace=6&gsrlimit=20`
      + "&prop=imageinfo&iiprop=url%7Csize%7Cmime%7Cextmetadata";
    let payload;
    try {
      const res = await fetchImpl(api, { headers: { "user-agent": "PrimePlugDiscovery/1.0" } });
      if (!res.ok) throw new Error(`Commons API HTTP ${res.status}`);
      payload = await res.json();
    } catch (error) {
      rejected.push({ query, reason: `Commons search failed: ${String(error?.message ?? error).slice(0, 160)}` });
      continue;
    }
    const pages = Object.values(payload?.query?.pages ?? {});
    let addedForQuery = 0;
    for (const page of pages) {
      if (addedForQuery >= perQuery) break;
      const info = page?.imageinfo?.[0];
      if (!info) continue;
      if (!String(info.mime ?? "").startsWith("video/")) { rejected.push({ title: page.title ?? null, reason: `Not a video (${info.mime ?? "unknown mime"})` }); continue; }
      if ((info.height ?? 0) < minHeight) { rejected.push({ title: page.title ?? null, reason: `Below ${minHeight}p native (${info.width}x${info.height})` }); continue; }
      if (seen.has(info.url)) continue;
      const candidate = commonsCandidateFromPage(page, { now });
      if (!candidate) {
        rejected.push({ title: page.title ?? null, reason: "Licence on the file page is not an exactly verified reusable licence (not PD/CC BY/CC BY-SA, or could not be verified)" });
        continue;
      }
      seen.add(info.url);
      items.push(candidate);
      addedForQuery += 1;
    }
  }
  return { source: "wikimedia_commons", status: "ok", items, rejected };
}
