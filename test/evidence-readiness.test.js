import test from "node:test";
import assert from "node:assert/strict";
import { evaluateEvidenceReadiness } from "../src/research/evidence-readiness.js";

test("requires opened passages from multiple independent domains", () => {
  const ledger = { claims: [{ id: "c1", claim: "Claim", sources: [
    { id: "s1", url: "https://www.example.org/a", extractionStatus: "opened", extractedContent: "x".repeat(200), sourceTypeCandidate: "other_or_unclassified" },
    { id: "s2", url: "https://example.org/b", extractionStatus: "opened", extractedContent: "y".repeat(200), sourceTypeCandidate: "other_or_unclassified" }
  ] }] };
  const report = evaluateEvidenceReadiness(ledger);
  assert.equal(report.status, "insufficient");
  assert.equal(report.claims[0].independentDomainCount, 1);
});

test("marks source coverage ready without claiming facts are verified", () => {
  const ledger = { claims: [{ id: "c1", claim: "Claim", sources: [
    { id: "s1", url: "https://example.org/a", extractionStatus: "opened", extractedContent: "x".repeat(200) },
    { id: "s2", url: "https://another.org/b", extractionStatus: "opened", extractedContent: "y".repeat(200) }
  ] }] };
  const report = evaluateEvidenceReadiness(ledger);
  assert.equal(report.status, "ready_for_human_review");
  assert.equal(report.claims[0].status, "evidence_pack_ready_for_human_review");
  assert.match(report.verificationPolicy, /does not establish accuracy/);
});

test("fails closed when ledger is missing or pages were not extracted", () => {
  assert.equal(evaluateEvidenceReadiness(null).status, "no_claims");
  const report = evaluateEvidenceReadiness({ claims: [{ id: "c1", claim: "Claim", sources: [
    { id: "s1", url: "https://example.org", extractionStatus: "pending", sourceExcerpt: "snippet" }
  ] }] });
  assert.equal(report.status, "insufficient");
  assert.equal(report.claims[0].openedSourceCount, 0);
});
