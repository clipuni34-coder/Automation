import test from "node:test";
import assert from "node:assert/strict";
import { buildClaimLedger } from "../src/research/claim-ledger.js";

test("claim ledger records source leads but never auto-verifies claims", async () => {
  const ledger = await buildClaimLedger({
    claims: ["The court dismissed count one", "The court dismissed count one"],
    search: async () => ({ status: "ok", results: [
      { title: "Court docket", url: "https://www.nysd.uscourts.gov/example", content: "Docket excerpt", score: 0.9 },
      { title: "News report", url: "https://news.example.com/story", content: "News excerpt", score: 0.8 },
      { title: "Unsafe", url: "javascript:alert(1)", content: "Ignore" }
    ] })
  });
  assert.equal(ledger.totalClaims, 1); assert.equal(ledger.verifiedClaims, 0);
  assert.equal(ledger.claims[0].status, "needs_source_review");
  assert.equal(ledger.claims[0].verificationDecision, "not_verified");
  assert.equal(ledger.claims[0].sources.length, 2);
  assert.equal(ledger.claims[0].sources[0].sourceTypeCandidate, "government_or_court_candidate");
  assert.equal(ledger.claims[0].sources[0].verification, "unverified_search_result");
  assert.equal(ledger.claims[0].sources[0].extractionStatus, "pending");
});

test("claim ledger safely records unavailable research", async () => {
  const ledger = await buildClaimLedger({ claims: ["A claim"], search: async () => ({ status: "not_configured", results: [] }) });
  assert.equal(ledger.claims[0].status, "research_not_configured");
  assert.equal(ledger.claims[0].verificationDecision, "not_verified");
});

test("claim ledger isolates a failed search and continues", async () => {
  let calls = 0;
  const ledger = await buildClaimLedger({ claims: ["First claim", "Second claim"], search: async () => {
    calls += 1; if (calls === 1) throw new Error("provider unavailable");
    return { status: "ok", results: [{ title: "Lead", url: "https://example.org", content: "Excerpt" }] };
  } });
  assert.equal(ledger.claims[0].status, "search_failed");
  assert.equal(ledger.claims[1].status, "needs_source_review");
  assert.equal(ledger.verifiedClaims, 0);
});

test("claim ledger retries an empty exact claim search with a shorter query", async () => {
  const queries = [];
  const ledger = await buildClaimLedger({
    claims: ["A very long claim sentence. Additional details and context."],
    search: async ({ query }) => {
      queries.push(query);
      if (queries.length === 1) return { status: "ok", results: [] };
      return { status: "ok", results: [
        { title: "Primary record", url: "https://example.gov/record", content: "Relevant source excerpt", score: 0.95 }
      ] };
    }
  });
  assert.equal(queries.length, 2);
  assert.equal(ledger.claims[0].sources.length, 1);
  assert.equal(ledger.claims[0].verificationDecision, "not_verified");
});

test("claim ledger extracts selected source pages and preserves unverified status", async () => {
  let receivedUrls = [];
  const ledger = await buildClaimLedger({
    claims: ["Claim supported by a public source"],
    search: async () => ({ status: "ok", results: [
      { title: "Primary record", url: "https://example.gov/record", content: "Search snippet" },
      { title: "Private host", url: "https://localhost/private", content: "No" }
    ] }),
    extract: async ({ urls }) => {
      receivedUrls = urls;
      return { status: "ok", results: [{ url: "https://example.gov/record", rawContent: "Original page text with relevant passage." }], failedResults: [] };
    }
  });
  assert.deepEqual(receivedUrls, ["https://example.gov/record"]);
  assert.equal(ledger.sourceExtraction.extracted, 1);
  assert.equal(ledger.claims[0].sources[0].extractionStatus, "opened");
  assert.equal(ledger.claims[0].sources[0].extractedContent, "Original page text with relevant passage.");
  assert.equal(ledger.claims[0].verificationDecision, "not_verified");
  assert.equal(ledger.verifiedClaims, 0);
});

test("claim ledger marks extraction errors without losing search leads", async () => {
  const ledger = await buildClaimLedger({
    claims: ["Claim"],
    search: async () => ({ status: "ok", results: [{ title: "Lead", url: "https://example.org", content: "Snippet" }] }),
    extract: async () => { throw new Error("extract unavailable"); }
  });
  assert.equal(ledger.claims[0].sources.length, 1);
  assert.equal(ledger.claims[0].sources[0].extractionStatus, "failed");
  assert.equal(ledger.claims[0].verificationDecision, "not_verified");
});
