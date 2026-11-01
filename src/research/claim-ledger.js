import { isIP } from "node:net";

const MAX_CLAIMS = 8;
const MAX_SOURCES_PER_CLAIM = 5;
const MAX_EXTRACT_URLS = 20;

function isSafePublicHttpsUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password ||
        !host || host === "localhost" || host.endsWith(".localhost") ||
        host.endsWith(".local") || host.endsWith(".internal") || isIP(host)) return false;
    return true;
  } catch { return false; }
}

function classifySource(url) {
  let hostname;
  try { hostname = new URL(url).hostname.toLowerCase(); }
  catch { return "unknown"; }
  if (hostname.endsWith(".gov") || hostname.endsWith(".gov.uk") || hostname.endsWith(".uscourts.gov")) {
    return "government_or_court_candidate";
  }
  if (hostname === "pubmed.ncbi.nlm.nih.gov" || hostname === "doi.org" || hostname.endsWith(".edu") ||
      hostname.endsWith(".nature.com") || hostname.endsWith(".science.org") || hostname.endsWith(".nejm.org") ||
      hostname.endsWith(".thelancet.com")) return "academic_or_journal_candidate";
  return "other_or_unclassified";
}

/** Search results and extracted pages are evidence leads, never automatic verification. */
export async function buildClaimLedger({
  claims = [], search, extract = null,
  maxClaims = MAX_CLAIMS, maxSourcesPerClaim = MAX_SOURCES_PER_CLAIM
} = {}) {
  if (typeof search !== "function") throw new Error("A research search function is required");
  const uniqueClaims = [...new Set(claims.map((claim) => String(claim ?? "").trim()).filter(Boolean))]
    .slice(0, Math.max(0, Math.min(MAX_CLAIMS, Number(maxClaims) || MAX_CLAIMS)));
  const ledger = [];
  for (const [index, claim] of uniqueClaims.entries()) {
    const query = claim.slice(0, 400);
    try {
      let result = await search({ query });
      if (result.status === "ok" && (!Array.isArray(result.results) || result.results.length === 0)) {
        const fallbackQuery = claim.split(/[.!?;:]/)[0].trim().slice(0, 180) || claim.slice(0, 180);
        if (fallbackQuery && fallbackQuery !== query) result = await search({ query: fallbackQuery });
      }
      const sources = (Array.isArray(result.results) ? result.results : [])
        .filter((item) => { try { return ["http:", "https:"].includes(new URL(item.url).protocol); } catch { return false; } })
        .slice(0, Math.max(1, Math.min(MAX_SOURCES_PER_CLAIM, Number(maxSourcesPerClaim) || MAX_SOURCES_PER_CLAIM)))
        .map((item, sourceIndex) => ({
          id: "claim-" + (index + 1) + "-source-" + (sourceIndex + 1),
          title: String(item.title ?? "").slice(0, 300), url: item.url, publishedAt: item.publishedAt ?? null,
          searchRelevance: Number.isFinite(item.score) ? item.score : null,
          sourceExcerpt: String(item.content ?? "").slice(0, 2000),
          sourceTypeCandidate: classifySource(item.url),
          extractionStatus: isSafePublicHttpsUrl(item.url) ? "pending" : "not_eligible",
          extractedContent: null,
          verification: "unverified_search_result"
        }));
      ledger.push({
        id: "claim-" + (index + 1), claim,
        status: sources.length ? "needs_source_review" : (result.status === "not_configured" ? "research_not_configured" : "no_sources_found"),
        query, searchedAt: new Date().toISOString(), sources, verificationDecision: "not_verified",
        reviewNote: "Search results and extracted text are leads, not proof. Check the original source, passage, date, context and whether it directly supports this claim. Record a human decision before publication."
      });
    } catch (error) {
      ledger.push({
        id: "claim-" + (index + 1), claim, status: "search_failed", query,
        searchedAt: new Date().toISOString(), sources: [], verificationDecision: "not_verified",
        error: String(error.message ?? error).slice(0, 500),
        reviewNote: "Research failed; do not infer or publish this claim."
      });
    }
  }

  let extractionStatus = typeof extract === "function" ? "not_run" : "not_configured";
  let extractedCount = 0;
  let failedCount = 0;
  if (typeof extract === "function") {
    const eligibleSources = ledger.flatMap((item) => item.sources)
      .filter((source) => isSafePublicHttpsUrl(source.url)).slice(0, MAX_EXTRACT_URLS);
    try {
      const extracted = await extract({
        urls: eligibleSources.map((source) => source.url),
        query: "Extract factual passages relevant to the claims being checked."
      });
      extractionStatus = extracted.status ?? "unknown";
      const byUrl = new Map((extracted.results ?? []).map((item) => [item.url, item]));
      const failedUrls = new Set((extracted.failedResults ?? []).map((item) => item.url));
      for (const item of ledger) {
        for (const source of item.sources) {
          const page = byUrl.get(source.url);
          if (page?.rawContent) {
            source.extractionStatus = "opened";
            source.extractedContent = String(page.rawContent).slice(0, 12000);
            source.extractedAt = new Date().toISOString();
            extractedCount += 1;
          } else if (failedUrls.has(source.url)) {
            source.extractionStatus = "failed";
            failedCount += 1;
          }
        }
      }
    } catch (error) {
      extractionStatus = "failed";
      for (const item of ledger) for (const source of item.sources) {
        if (source.extractionStatus === "pending") source.extractionStatus = "failed";
      }
      failedCount = eligibleSources.length;
      // Keep the failure visible without converting it into a claim decision.
      for (const item of ledger) if (item.sources.length) item.extractionError = String(error.message ?? error).slice(0, 300);
    }
  }

  return {
    schemaVersion: 1, status: uniqueClaims.length ? "review_required" : "no_claims",
    generatedAt: new Date().toISOString(), totalClaims: uniqueClaims.length,
    verifiedClaims: 0, unresolvedClaims: ledger.length, claims: ledger,
    sourceExtraction: { status: extractionStatus, attempted: Math.min(MAX_EXTRACT_URLS,
      ledger.flatMap((item) => item.sources).filter((source) => isSafePublicHttpsUrl(source.url)).length),
      extracted: extractedCount, failed: failedCount },
    policy: "No claim is automatically marked verified. Extracted passages must be checked against the original source and claim context, with a recorded editorial decision."
  };
}
