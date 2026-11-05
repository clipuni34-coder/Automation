// Strongest practical rights verification for Commons-hosted assets.
//
// A licence claim in our own config is NOT proof. This verifier reads the
// actual asset's file page through the Wikimedia Commons API, identifies
// the EXACT licence (family + version) recorded there, and compares it
// against the candidate's claim. Four separated statuses:
//
//   rights_verified_with_evidence  - API-observed licence exactly matches
//                                    the claim (family AND version) and
//                                    permits commercial reuse AND
//                                    derivative works.
//   evidence_recorded_not_independently_verified
//                                  - claim recorded, but the asset could
//                                    not be independently checked now.
//   permission_unclear             - observed licence cannot be reconciled
//                                    with the claim (wrong family, wrong
//                                    version, changed licence, missing or
//                                    inconsistent attribution metadata).
//   reuse_prohibited               - observed terms forbid commercial
//                                    reuse or derivative works (NC / ND),
//                                    or the asset is not freely licensed.
//
// Nothing here "legally certifies" anything: this is evidence recording
// and comparison. A human must still inspect the evidence before any
// public use. Only `rights_verified_with_evidence` may enter production.

const PROHIBITED_FAMILIES = new Set(["by-nc", "by-nc-sa", "by-nc-nd", "by-nd"]);

// Parse an exact Creative Commons licence (family + version) from a
// licence URL, short name, or free text. Returns null when no exact CC
// licence can be identified.
export function parseCcLicence(text) {
  const t = String(text ?? "");
  const urlMatch = /creativecommons\.org\/licenses\/([a-z-]+)\/(\d+\.\d+)/i.exec(t);
  if (urlMatch) return { family: urlMatch[1].toLowerCase(), version: urlMatch[2], kind: "cc" };
  const nameMatch = /\bCC\s+(BY(?:-[A-Z]+)*)\s+(\d+\.\d+)\b/i.exec(t);
  if (nameMatch) return { family: nameMatch[1].toLowerCase(), version: nameMatch[2], kind: "cc" };
  if (/creativecommons\.org\/publicdomain\/zero\/1\.0/i.test(t) || /\bCC0\b/i.test(t)) {
    return { family: "cc0", version: "1.0", kind: "cc0" };
  }
  return null;
}

export function parseLicenceIdentity(text) {
  const cc = parseCcLicence(text);
  if (cc) return cc;
  if (/public[._ ]?domain/i.test(String(text ?? ""))) return { family: "public-domain", version: null, kind: "public-domain" };
  return null;
}

function licenceTermsText(meta) {
  return [meta?.LicenseShortName?.value, meta?.UsageTerms?.value, meta?.LicenseUrl?.value]
    .filter(Boolean).join(" ");
}

export function classifyObservedLicence({ claimedType = "", claimedStatus = "", observedMeta = null } = {}) {
  if (!observedMeta) {
    return { status: "evidence_recorded_not_independently_verified", commercialUse: null, derivativesAllowed: null, shareAlike: false, observedLicence: null, licenceFamily: null, licenceVersion: null, attributionRequired: null, reasons: ["No licence metadata could be observed for the asset; only the recorded claim exists."] };
  }
  const terms = licenceTermsText(observedMeta);
  const observedLicence = observedMeta?.LicenseShortName?.value ?? null;
  const observed = parseLicenceIdentity(`${observedLicence ?? ""} ${observedMeta?.LicenseUrl?.value ?? ""} ${observedMeta?.UsageTerms?.value ?? ""}`);
  const claimed = parseLicenceIdentity(claimedType) ?? parseLicenceIdentity(claimedStatus);
  const base = { observedLicence, licenceFamily: observed?.family ?? null, licenceVersion: observed?.version ?? null };

  if (!observed) {
    return { status: "permission_unclear", commercialUse: null, derivativesAllowed: null, shareAlike: false, attributionRequired: null, ...base, reasons: [`Observed licence "${observedLicence ?? "unknown"}" is not recognisable as public domain or an exact Creative Commons licence.`] };
  }
  if (PROHIBITED_FAMILIES.has(observed.family) || /noncommercial|NoDerivatives|all rights reserved/i.test(terms)) {
    return { status: "reuse_prohibited", commercialUse: false, derivativesAllowed: false, shareAlike: observed.family?.includes("sa") ?? false, attributionRequired: true, ...base, reasons: [`Observed licence terms forbid commercial reuse or derivative works: ${observedLicence ?? terms.slice(0, 80)}`] };
  }
  // The claim must identify the SAME licence: same family, and the same
  // version whenever the claim specifies one. A generic claim ("licensed")
  // identifies nothing exactly and cannot verify an exact licence.
  if (!claimed) {
    return { status: "permission_unclear", commercialUse: null, derivativesAllowed: null, shareAlike: false, attributionRequired: null, ...base, reasons: [`Recorded claim (${claimedType || claimedStatus || "none"}) does not identify an exact licence to compare against the observed ${observedLicence}.`] };
  }
  if (claimed.family !== observed.family) {
    return { status: "permission_unclear", commercialUse: null, derivativesAllowed: null, shareAlike: observed.family?.includes("sa") ?? false, attributionRequired: null, ...base, reasons: [`Licence family mismatch: claim identifies "${claimed.family}" but the asset page records "${observedLicence}" (${observed.family}). The licence may have changed or the claim is wrong.`] };
  }
  if (claimed.version && observed.version && claimed.version !== observed.version) {
    return { status: "permission_unclear", commercialUse: null, derivativesAllowed: null, shareAlike: false, attributionRequired: null, ...base, reasons: [`Licence version mismatch: claim identifies version ${claimed.version} but the asset page records ${observedLicence} (version ${observed.version}).`] };
  }
  // Attribution metadata must be consistent: a CC BY-family licence always
  // requires attribution; metadata claiming otherwise is inconsistent.
  const attributionRequiredRaw = observedMeta?.AttributionRequired?.value;
  const attributionRequired = observed.kind === "public-domain" || observed.kind === "cc0" ? false : true;
  if (observed.kind === "cc" && attributionRequiredRaw === "false") {
    return { status: "permission_unclear", commercialUse: null, derivativesAllowed: null, shareAlike: false, attributionRequired, ...base, reasons: [`Attribution metadata is inconsistent: ${observedLicence} requires attribution but the file page records AttributionRequired=false.`] };
  }
  const shareAlike = Boolean(observed.family?.includes("sa"));
  return {
    status: "rights_verified_with_evidence",
    commercialUse: true,
    derivativesAllowed: true,
    shareAlike,
    attributionRequired,
    artist: observedMeta?.Artist?.value?.replace(/<[^>]+>/g, "").trim() ?? null,
    licenceUrl: observedMeta?.LicenseUrl?.value ?? null,
    ...base,
    reasons: [`Exact licence observed on the asset's Commons file page (${observedLicence}) matches the claim and permits commercial reuse and derivative works${shareAlike ? " under ShareAlike conditions, which are recorded and must be honoured" : ""}. This is recorded evidence, not legal certification.`]
  };
}

export async function verifyCandidateRights(candidate, { fetchImpl = fetch } = {}) {
  const evidenceUrl = candidate?.rightsEvidenceUrl ?? candidate?.license?.evidenceUrl ?? "";
  const claimedType = candidate?.license?.type ?? "";
  const claimedStatus = candidate?.license?.rightsStatus ?? candidate?.rightsStatus ?? "";
  const base = { candidateId: candidate?.id ?? null, claimedType, claimedStatus, evidenceUrl, checkedAt: new Date().toISOString() };
  // Only Commons file pages can be independently read this way.
  const match = /commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/.exec(evidenceUrl);
  if (!match) {
    return { ...base, ...classifyObservedLicence({ claimedType, claimedStatus, observedMeta: null }), verificationMethod: "none_available_for_this_host" };
  }
  try {
    const title = decodeURIComponent(match[1]);
    const api = `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url|extmetadata&format=json&titles=${encodeURIComponent(title)}`;
    const res = await fetchImpl(api, { headers: { "user-agent": "PrimePlugRightsVerifier/1.0" } });
    if (!res.ok) throw new Error(`Commons API HTTP ${res.status}`);
    const payload = await res.json();
    const page = Object.values(payload?.query?.pages ?? {})[0];
    if (!page || page.missing !== undefined || !page.imageinfo?.length) throw new Error("File page not found on Commons");
    const meta = page.imageinfo[0].extmetadata ?? null;
    if (!meta) throw new Error("No extmetadata on file page");
    return { ...base, ...classifyObservedLicence({ claimedType, claimedStatus, observedMeta: meta }), verificationMethod: "wikimedia_commons_api_extmetadata" };
  } catch (error) {
    return { ...base, ...classifyObservedLicence({ claimedType, claimedStatus, observedMeta: null }), verificationMethod: "wikimedia_commons_api_extmetadata", verificationError: String(error?.message ?? error).slice(0, 200) };
  }
}

// Only independently verified evidence may enter production. Recorded but
// unverified claims are preserved for audit and blocked, never guessed.
export const PRODUCTION_RIGHTS_STATUSES = new Set(["rights_verified_with_evidence"]);
