/**
 * Fail-closed production eligibility gate.
 *
 * Model-generated briefs and AI evidence assessments are never publication
 * approval. A human must explicitly approve the exact brief after checking
 * every claim against its original source.
 */
export function evaluateProductionGate({ editorial = {}, claimLedger = null } = {}) {
  const reasons = [];
  const claims = Array.isArray(editorial.claimsToVerify) ? editorial.claimsToVerify : [];
  const ledgerClaims = Array.isArray(claimLedger?.claims) ? claimLedger.claims : [];
  const totalClaims = Number(claimLedger?.totalClaims ?? ledgerClaims.length);
  const verifiedClaims = Number(claimLedger?.verifiedClaims ?? 0);
  const unresolvedClaims = Number(claimLedger?.unresolvedClaims ?? ledgerClaims.length);

  if (claims.length > 0) reasons.push("The brief still lists factual claims requiring verification.");
  if (!claimLedger || !Array.isArray(claimLedger.claims)) {
    reasons.push("A claim ledger is missing.");
  } else if (totalClaims !== verifiedClaims || unresolvedClaims !== 0) {
    reasons.push("Not every factual claim has a recorded verification decision.");
  }
  if (ledgerClaims.some((claim) => claim.verificationDecision !== "verified_by_human")) {
    reasons.push("At least one claim lacks an explicit human verification decision.");
  }

  const approval = editorial.humanEditorialReview;
  if (approval?.status !== "approved" || typeof approval?.approvedAt !== "string" ||
      !approval.approvedAt.trim() || typeof approval?.reviewer !== "string" ||
      !approval.reviewer.trim() || approval?.briefDigest !== editorial.briefDigest) {
    reasons.push("This exact brief has not received a recorded human editorial approval.");
  }

  return {
    status: reasons.length ? "held" : "passed",
    productionEligible: reasons.length === 0,
    requiresHumanApproval: true,
    totalClaims,
    verifiedClaims,
    unresolvedClaims,
    reasons,
    policy: "AI-generated content and AI evidence assessments cannot approve factual claims or authorize production. Approval must refer to this exact brief digest."
  };
}
