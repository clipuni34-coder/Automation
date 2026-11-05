// Strongest practical rights verification for Commons-hosted assets.
//
// A licence claim in our own config is NOT proof. This verifier reads the
// actual asset's file page through the Wikimedia Commons API and compares
// the licence recorded there (LicenseShortName / usage terms) against the
// candidate's claim, then classifies into exactly four statuses:
//
//   rights_verified_with_evidence  - API-observed licence matches the claim
//                                    and permits commercial reuse AND
//                                    derivative works.
//   evidence_recorded_not_independently_verified
//                                  - claim recorded, but the asset could not
//                                    be independently checked right now.
//   permission_unclear             - API shows a licence that cannot be
//                                    reconciled with the claim, or terms
//                                    are ambiguous.
//   reuse_prohibited               - API shows terms that forbid commercial
//                                    reuse or derivative works (NC / ND),
//                                    or the asset is not freely licensed.
//
// Only `rights_verified_with_evidence` and (below it) recorded-evidence
// candidates with an approved rightsStatus may proceed — and the recorded
// status is always preserved in the package so a human can audit it.

const PROHIBITED_PATTERNS = [/noncommercial/i, /\bNC\b/, /NoDerivatives/i, /\bND\b/, /all rights reserved/i];
const SHAREALIKE_PATTERNS = [/share ?alike/i, /\bSA\b/];

function licenceTermsText(meta) {
  return [meta?.LicenseShortName?.value, meta?.UsageTerms?.value, meta?.LicenseUrl?.value]
    .filter(Boolean).join(" ");
}

export function classifyObservedLicence({ claimedType = "", claimedStatus = "", observedMeta = null } = {}) {
  if (!observedMeta) {
    return { status: "evidence_recorded_not_independently_verified", commercialUse: null, derivativesAllowed: null, shareAlike: false, observedLicence: null, reasons: ["No licence metadata could be observed for the asset; only the recorded claim exists."] };
  }
  const terms = licenceTermsText(observedMeta);
  const observedLicence = observedMeta?.LicenseShortName?.value ?? null;
  if (PROHIBITED_PATTERNS.some((p) => p.test(terms)) && !/public domain/i.test(terms)) {
    return { status: "reuse_prohibited", commercialUse: false, derivativesAllowed: false, shareAlike: false, observedLicence, reasons: [`Observed licence terms forbid commercial reuse or derivatives: ${observedLicence ?? terms.slice(0, 80)}`] };
  }
  const isPublicDomain = /public domain/i.test(terms);
  const isCC = /creative commons/i.test(terms) || /creativecommons\.org/i.test(terms);
  if (!isPublicDomain && !isCC) {
    return { status: "permission_unclear", commercialUse: null, derivativesAllowed: null, shareAlike: false, observedLicence, reasons: [`Observed licence "${observedLicence ?? "unknown"}" is not recognisable as public domain or a Creative Commons licence.`] };
  }
  // Claim must roughly match what was observed.
  const claim = `${claimedType} ${claimedStatus}`.toLowerCase();
  const observed = terms.toLowerCase();
  const claimMatches = isPublicDomain
    ? /public.?domain/.test(claim)
    : (/cc|creative commons|licensed/.test(claim) || observed.includes(claim.trim()));
  if (!claimMatches) {
    return { status: "permission_unclear", commercialUse: null, derivativesAllowed: null, shareAlike: SHAREALIKE_PATTERNS.some((p) => p.test(terms)), observedLicence, reasons: [`Recorded claim (${claimedType || claimedStatus}) does not match the licence observed on the asset page (${observedLicence}).`] };
  }
  return {
    status: "rights_verified_with_evidence",
    commercialUse: true,
    derivativesAllowed: true,
    shareAlike: SHAREALIKE_PATTERNS.some((p) => p.test(terms)),
    observedLicence,
    attribution: observedMeta?.AttributionRequired?.value === "true" || isCC,
    artist: observedMeta?.Artist?.value?.replace(/<[^>]+>/g, "").trim() ?? null,
    licenceUrl: observedMeta?.LicenseUrl?.value ?? null,
    reasons: [`Licence observed on the asset's Commons file page (${observedLicence}) permits commercial reuse and derivative works${SHAREALIKE_PATTERNS.some((p) => p.test(terms)) ? " under ShareAlike conditions, which are recorded and must be honoured" : ""}.`]
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
    const api = `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=extmetadata&format=json&titles=${encodeURIComponent(title)}`;
    const res = await fetchImpl(api, { headers: { "user-agent": "PrimePlugRightsVerifier/1.0" } });
    if (!res.ok) throw new Error(`Commons API HTTP ${res.status}`);
    const payload = await res.json();
    const page = Object.values(payload?.query?.pages ?? {})[0];
    const meta = page?.imageinfo?.[0]?.extmetadata ?? null;
    if (!meta) throw new Error("No extmetadata on file page");
    return { ...base, ...classifyObservedLicence({ claimedType, claimedStatus, observedMeta: meta }), verificationMethod: "wikimedia_commons_api_extmetadata" };
  } catch (error) {
    return { ...base, ...classifyObservedLicence({ claimedType, claimedStatus, observedMeta: null }), verificationMethod: "wikimedia_commons_api_extmetadata", verificationError: String(error?.message ?? error).slice(0, 200) };
  }
}

export const PRODUCTION_RIGHTS_STATUSES = new Set(["rights_verified_with_evidence", "evidence_recorded_not_independently_verified"]);
