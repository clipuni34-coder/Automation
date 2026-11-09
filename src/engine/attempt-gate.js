// Recheck the current production manifest and rights immediately before an
// attempt. Persisted queue items may contain older licence or plan data.
import { verifyCandidateRights } from "./rights-verification.js";
import { screenCandidate } from "./scheduler.js";
import { isDailyProductionSeed } from "./retry-policy.js";

export function isTransientRightsFailure(verification) {
  return verification?.status === "evidence_recorded_not_independently_verified" &&
    /429|\b5\d\d\b|network|fetch|timeout|timed out|econn|enotfound/i.test(String(verification.verificationError ?? ""));
}

export async function validateCurrentProductionAttempt({ job, candidates, verifyRights = verifyCandidateRights } = {}) {
  const current = (candidates ?? []).find((c) => c.id === job?.candidate?.id && c.sourceUrl === job?.candidate?.sourceUrl);
  const seed = current?.seedManifestEntry;
  if (!seed || !isDailyProductionSeed(seed) || seed.id !== job?.candidate?.id || seed.sourceUrl !== job?.candidate?.sourceUrl) {
    return { allowed: false, outcome: "held_candidate_identity", reason: "Current production candidate missing, test-only or mismatched; no production attempted." };
  }
  // The plan's own source, licence and creator are the fields the renderer
  // will use; verify those exact values, not a stale queue copy.
  const canonical = { ...current, sourceUrl: seed.sourceUrl, creator: seed.creator, rightsEvidenceUrl: seed.rightsEvidenceUrl, license: seed.license };
  let verification;
  try { verification = await verifyRights(canonical); }
  catch (error) { verification = { status: "evidence_recorded_not_independently_verified", verificationError: String(error?.message ?? error).slice(0, 200) }; }
  const candidate = { ...canonical, rightsVerification: verification };
  const rights = screenCandidate(candidate);
  if (!rights.eligible) return { allowed: false, outcome: "held_fresh_rights_check", reason: rights.reasons.join("; "), retryable: isTransientRightsFailure(verification), candidate };
  return { allowed: true, candidate, seed };
}
