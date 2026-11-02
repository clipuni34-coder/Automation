const MIN_INDEPENDENT_DOMAINS = 2;
const MIN_CLAIM_TERM_COVERAGE = 0.6;
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "by", "during", "for", "from",
  "he", "her", "him", "his", "i", "in", "is", "it", "of", "on", "or", "she", "that",
  "the", "their", "them", "they", "this", "to", "was", "were", "with", "you", "your"
]);
const NON_INDEPENDENT_HOSTS = [
  /(^|\.)instagram\.com$/,
  /(^|\.)facebook\.com$/,
  /(^|\.)tiktok\.com$/,
  /(^|\.)youtube\.com$/,
  /(^|\.)youtu\.be$/,
  /(^|\.)reddit\.com$/,
  /(^|\.)x\.com$/,
  /(^|\.)twitter\.com$/,
  /(^|\.)threads\.net$/,
  /(^|\.)wikipedia\.org$/,
  /(^|\.)wikimedia\.org$/
];

function hostnameOf(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

function isEligibleDomain(host) {
  return Boolean(host) && !NON_INDEPENDENT_HOSTS.some((pattern) => pattern.test(host));
}

function significantTerms(value) {
  return [...new Set(String(value ?? "").toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) ?? [])]
    .filter((term) => !STOP_WORDS.has(term));
}

/**
 * A conservative lexical screen, not a semantic fact checker. It requires
 * claim-specific terms (and every numeric literal) to appear in an opened
 * passage. Human review remains mandatory for accuracy and source quality.
 */
function assessDirectSupport(claimText, passage) {
  const normalizedPassage = String(passage ?? "").toLowerCase();
  const terms = significantTerms(claimText);
  const matchedTerms = terms.filter((term) => normalizedPassage.includes(term));
  const numbers = String(claimText ?? "").match(/\b\d+(?:\.\d+)?%?\b/g) ?? [];
  const missingNumbers = numbers.filter((number) => !normalizedPassage.includes(number.toLowerCase()));
  const coverage = terms.length ? matchedTerms.length / terms.length : 0;
  return {
    termCoverage: Number(coverage.toFixed(2)),
    matchedTerms,
    missingNumbers,
    directlyTraceable: terms.length > 0 && coverage >= MIN_CLAIM_TERM_COVERAGE && missingNumbers.length === 0
  };
}

/**
 * Deterministic evidence-pack readiness audit. Search snippets, social posts,
 * encyclopedias and numeric mismatches cannot satisfy minimum source coverage.
 * It never establishes truth; human review remains mandatory.
 */
export function evaluateEvidenceReadiness(claimLedger, { minIndependentDomains = MIN_INDEPENDENT_DOMAINS } = {}) {
  const claims = Array.isArray(claimLedger?.claims) ? claimLedger.claims : [];
  const perClaim = claims.map((claim) => {
    const opened = (claim.sources ?? []).filter((source) =>
      source.extractionStatus === "opened" && String(source.extractedContent ?? "").trim().length >= 160
    );
    const assessed = opened.map((source) => ({
      source,
      host: hostnameOf(source.url),
      support: assessDirectSupport(claim.claim, source.extractedContent)
    }));
    const supporting = assessed.filter(({ host, support }) => isEligibleDomain(host) && support.directlyTraceable);
    const domains = [...new Set(supporting.map(({ host }) => host))];
    const primaryCandidates = supporting.filter(({ source }) =>
      source.sourceTypeCandidate === "government_or_court_candidate" ||
      source.sourceTypeCandidate === "academic_or_journal_candidate"
    );
    const reasons = [];
    if (opened.length === 0) reasons.push("No original source page was successfully opened.");
    if (supporting.length === 0) reasons.push("No eligible opened passage contains enough claim-specific wording and all numeric details.");
    if (domains.length < minIndependentDomains) reasons.push(\`Fewer than \${minIndependentDomains} eligible domains contain claim-traceable passages.\`);
    const status = reasons.length ? "insufficient_for_editorial_review" : "evidence_pack_ready_for_human_review";
    return {
      claimId: claim.id,
      claim: claim.claim,
      openedSourceCount: opened.length,
      claimTraceableSourceCount: supporting.length,
      eligibleSupportingDomainCount: domains.length,
      supportingDomains: domains,
      primarySourceCandidateCount: primaryCandidates.length,
      sourceChecks: assessed.map(({ source, host, support }) => ({
        sourceId: source.id,
        domain: host,
        eligibleDomain: isEligibleDomain(host),
        ...support
      })),
      status,
      reasons,
      sourceIds: supporting.map(({ source }) => source.id)
    };
  });
  const insufficient = perClaim.filter((item) => item.status !== "evidence_pack_ready_for_human_review");
  return {
    status: claims.length === 0 ? "no_claims" : insufficient.length ? "insufficient" : "ready_for_human_review",
    claimsChecked: claims.length,
    claimsWithSufficientSourceCoverage: claims.length - insufficient.length,
    claimsInsufficient: insufficient.length,
    minIndependentDomains,
    minClaimTermCoverage: MIN_CLAIM_TERM_COVERAGE,
    claims: perClaim,
    verificationPolicy: "This is a conservative lexical traceability and domain-coverage screen only. It does not establish semantic support, factual accuracy, source independence in substance, or human verification. Every claim still requires human review against the original source."
  };
}
