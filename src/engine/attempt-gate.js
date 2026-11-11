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
  // Inbox plans have explicitly reviewed creator and attribution evidence.
  // A fresh licence match alone is not enough if Commons changed the credit or
  // licence URL since the review; hold instead of publishing stale attribution.
  if (current.reviewedPlanning === true) {
    const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
    const credit = clean(seed.license?.attributionRequirement);
    const creator = clean(seed.creator);
    const artist = clean(verification.artist);
    const licenceUrl = clean(verification.licenceUrl);
    if (!artist || artist.toLowerCase() !== creator.toLowerCase() || !licenceUrl || !credit.includes(licenceUrl)) {
      return { allowed: false, outcome: "held_fresh_rights_check", reason: "Creator or exact licence attribution changed since the plan was reviewed; a new rights review is required.", candidate };
    }
    if (verification.shareAlike && !/(?:adaptation|edit|short).{0,100}(?:licen[cs]ed|distributed).{0,120}(?:same|compatible|cc\s*by-sa)/i.test(credit)) {
      return { allowed: false, outcome: "held_fresh_rights_check", reason: "ShareAlike adaptation licensing is not documented in the current attribution.", candidate };
    }
  }
  return { allowed: true, candidate, seed };
}
