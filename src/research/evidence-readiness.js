const MIN_INDEPENDENT_DOMAINS = 2;

function hostnameOf(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\\./, ""); }
  catch { return ""; }
}

/**
 * Deterministic research-readiness audit. It never verifies claims; it reports
 * whether there is enough opened source material for a human to review.
 */
export function evaluateEvidenceReadiness(claimLedger, { minIndependentDomains = MIN_INDEPENDENT_DOMAINS } = {}) {
  const claims = Array.isArray(claimLedger?.claims) ? claimLedger.claims : [];
  const perClaim = claims.map((claim) => {
    const opened = (claim.sources ?? []).filter((source) =>
      source.extractionStatus === "opened" && String(source.extractedContent ?? "").trim().length >= 160
    );
    const domains = [...new Set(opened.map((source) => hostnameOf(source.url)).filter(Boolean))];
    const primaryCandidates = opened.filter((source) =>
      source.sourceTypeCandidate === "government_or_court_candidate" ||
      source.sourceTypeCandidate === "academic_or_journal_candidate"
    );
    const reasons = [];
    if (opened.length === 0) reasons.push("No original source page was successfully opened.");
    if (domains.length < minIndependentDomains) reasons.push(`Fewer than ${minIndependentDomains} independent source domains have opened passages.`);
    return {
      claimId: claim.id,
      claim: claim.claim,
      openedSourceCount: opened.length,
      independentDomainCount: domains.length,
      domains,
      primarySourceCandidateCount: primaryCandidates.length,
      status: reasons.length ? "insufficient_for_editorial_review" : "evidence_pack_ready_for_human_review",
      reasons,
      sourceIds: opened.map((source) => source.id)
    };
  });
  const insufficient = perClaim.filter((item) => item.status !== "evidence_pack_ready_for_human_review");
  return {
    status: claims.length === 0 ? "no_claims" : insufficient.length ? "insufficient" : "ready_for_human_review",
    claimsChecked: claims.length,
    claimsWithSufficientSourceCoverage: claims.length - insufficient.length,
    claimsInsufficient: insufficient.length,
    minIndependentDomains,
    claims: perClaim,
    verificationPolicy: "This is a source-coverage check only. It does not establish accuracy, direct support, source independence in substance, or human verification."
  };
}
