const MAX_CLAIMS = 8;
const MAX_SOURCES_PER_CLAIM = 5;

function classifySource(url) {
  let hostname;
  try { hostname = new URL(url).hostname.toLowerCase().replace(/^www\\./, ""); }
  catch { return "unknown"; }
  if (hostname.endsWith(".gov") || hostname.endsWith(".gov.uk") || hostname.endsWith(".uscourts.gov") ||
      /(^|\\.)(justice|court|parliament)\\.[a-z.]+$/.test(hostname)) return "government_or_court_candidate";
  if (hostname === "pubmed.ncbi.nlm.nih.gov" || hostname === "doi.org" || hostname.endsWith(".edu") ||
      hostname.endsWith(".nature.com") || hostname.endsWith(".science.org") || hostname.endsWith(".nejm.org") ||
      hostname.endsWith(".thelancet.com")) return "academic_or_journal_candidate";
  return "other_or_unclassified";
}

/** Search results are leads only; no automated classification verifies a claim. */
export async function buildClaimLedger({ claims = [], search, maxClaims = MAX_CLAIMS, maxSourcesPerClaim = MAX_SOURCES_PER_CLAIM } = {}) {
  if (typeof search !== "function") throw new Error("A research search function is required");
  const uniqueClaims = [...new Set(claims.map((claim) => String(claim ?? "").trim()).filter(Boolean))]
    .slice(0, Math.max(0, Math.min(MAX_CLAIMS, Number(maxClaims) || MAX_CLAIMS)));
  const ledger = [];
  for (const [index, claim] of uniqueClaims.entries()) {
    const query = '"' + claim + '" official primary source evidence';
    try {
      const result = await search({ query });
      const sources = (Array.isArray(result.results) ? result.results : []).filter((item) => {
        try { return ["http:", "https:"].includes(new URL(item.url).protocol); } catch { return false; }
      }).slice(0, Math.max(1, Math.min(MAX_SOURCES_PER_CLAIM, Number(maxSourcesPerClaim) || MAX_SOURCES_PER_CLAIM)))
        .map((item, sourceIndex) => ({
          id: "claim-" + (index + 1) + "-source-" + (sourceIndex + 1),
          title: String(item.title ?? "").slice(0, 300), url: item.url, publishedAt: item.publishedAt ?? null,
          searchRelevance: Number.isFinite(item.score) ? item.score : null,
          sourceExcerpt: String(item.content ?? "").slice(0, 2000),
          sourceTypeCandidate: classifySource(item.url), verification: "unverified_search_result"
        }));
      ledger.push({
        id: "claim-" + (index + 1), claim,
        status: sources.length ? "needs_source_review" : (result.status === "not_configured" ? "research_not_configured" : "no_sources_found"),
        query, searchedAt: new Date().toISOString(), sources, verificationDecision: "not_verified",
        reviewNote: "A search result, domain label, or excerpt does not prove this claim. Open the original source, confirm the relevant passage and context, and record a human verification decision before publication."
      });
    } catch (error) {
      ledger.push({ id: "claim-" + (index + 1), claim, status: "search_failed", query,
        searchedAt: new Date().toISOString(), sources: [], verificationDecision: "not_verified",
        error: String(error.message ?? error).slice(0, 500),
        reviewNote: "Research failed; do not infer or publish this claim." });
    }
  }
  return { schemaVersion: 1, status: uniqueClaims.length ? "review_required" : "no_claims",
    generatedAt: new Date().toISOString(), totalClaims: uniqueClaims.length, verifiedClaims: 0,
    unresolvedClaims: ledger.length, claims: ledger,
    policy: "No claim is automatically marked verified. Primary-source candidates require inspection of the original source and a recorded editorial decision." };
}
