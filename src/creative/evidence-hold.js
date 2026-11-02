/**
 * Keep model-written narration out of production fields until every factual
 * claim has been explicitly verified by a human editor.
 *
 * The original model output is retained only under reviewOnlyDraft so it can
 * be inspected and rewritten; renderers must consume the cleared production
 * fields, never this review-only copy.
 */
export function applyEditorialEvidenceHold({ plan = {}, claimLedger = null, now = () => new Date().toISOString() } = {}) {
  const claims = Array.isArray(claimLedger?.claims) ? claimLedger.claims : [];
  const unresolved = claims.filter((claim) => claim?.verificationDecision !== "verified_by_human");
  const listedClaims = Array.isArray(plan.claimsToVerify) ? plan.claimsToVerify : [];
  const unresolvedCount = Number(claimLedger?.unresolvedClaims ?? unresolved.length);
  const needsHold = listedClaims.length > 0 || unresolvedCount > 0 || unresolved.length > 0;

  if (!needsHold) {
    return { ...plan, scriptReadiness: { status: "ready_for_human_editorial_approval", held: false, unresolvedClaims: 0 } };
  }

  const reviewOnlyDraft = {
    status: "not_for_production",
    storedAt: now(),
    reason: "Factual claims remain unverified. This model-generated copy is preserved for human review only and must not be rendered, scheduled, or published.",
    workingTitle: plan.workingTitle ?? "",
    targetAudience: plan.targetAudience ?? "",
    recommendedAngle: plan.recommendedAngle ?? "",
    alternativeAngles: plan.alternativeAngles ?? [],
    hookOptions: plan.hookOptions ?? [],
    fullScript: plan.fullScript ?? "",
    estimatedDurationSeconds: plan.estimatedDurationSeconds ?? null,
    scriptBeats: plan.scriptBeats ?? [],
    visualPlan: plan.visualPlan ?? [],
    callToAction: plan.callToAction ?? "",
    claimsToVerify: listedClaims
  };

  return {
    ...plan,
    workingTitle: "",
    hookOptions: [],
    fullScript: "",
    scriptBeats: [],
    visualPlan: [],
    callToAction: "",
    reviewOnlyDraft,
    scriptReadiness: {
      status: "held_for_fact_check",
      held: true,
      unresolvedClaims: Math.max(unresolvedCount, unresolved.length, listedClaims.length),
      reason: "The production-facing script, hooks, visuals, and CTA were cleared because their factual claims have not received human verification."
    }
  };
}
