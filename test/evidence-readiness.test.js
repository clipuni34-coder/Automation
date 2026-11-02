import test from "node:test";
import assert from "node:assert/strict";
import { evaluateEvidenceReadiness } from "../src/research/evidence-readiness.js";

const passage = "Brian Scalabrine played professional basketball for the Boston Celtics and New Jersey Nets over multiple NBA seasons. The career profile documents his time in the league and the context of his playing career.";

test("requires claim-traceable passages from multiple eligible domains", () => {
  const ledger = { claims: [{ id: "c1", claim: "Brian Scalabrine played professional basketball in the NBA", sources: [
    { id: "s1", url: "https://www.example.org/a", extractionStatus: "opened", extractedContent: passage },
    { id: "s2", url: "https://example.org/b", extractionStatus: "opened", extractedContent: passage }
  ] }] };
  const report = evaluateEvidenceReadiness(ledger);
  assert.equal(report.status, "insufficient");
  assert.equal(report.claims[0].eligibleSupportingDomainCount, 1);
});

test("does not treat opened pages as support when a numeric claim is absent", () => {
  const ledger = { claims: [{ id: "c1", claim: "Brian Scalabrine averaged 3.1 points and 2.0 rebounds per game", sources: [
    { id: "s1", url: "https://stats-one.example/a", extractionStatus: "opened", extractedContent: passage },
    { id: "s2", url: "https://stats-two.example/b", extractionStatus: "opened", extractedContent: passage }
  ] }] };
  const report = evaluateEvidenceReadiness(ledger);
  assert.equal(report.status, "insufficient");
  assert.equal(report.claims[0].claimTraceableSourceCount, 0);
  assert.ok(report.claims[0].sourceChecks.every((item) => item.missingNumbers.length === 2));
});

test("excludes social and encyclopedia domains from independent evidence coverage", () => {
  const ledger = { claims: [{ id: "c1", claim: "Brian Scalabrine played professional basketball in the NBA", sources: [
    { id: "s1", url: "https://instagram.com/p/1", extractionStatus: "opened", extractedContent: passage },
    { id: "s2", url: "https://en.wikipedia.org/wiki/Brian_Scalabrine", extractionStatus: "opened", extractedContent: passage },
    { id: "s3", url: "https://stats.example.org/player", extractionStatus: "opened", extractedContent: passage },
    { id: "s4", url: "https://archive.example.net/player", extractionStatus: "opened", extractedContent: passage }
  ] }] };
  const report = evaluateEvidenceReadiness(ledger);
  assert.equal(report.status, "ready_for_human_review");
  assert.deepEqual(report.claims[0].supportingDomains.sort(), ["archive.example.net", "stats.example.org"]);
  assert.match(report.verificationPolicy, /does not establish semantic support/);
});

test("fails closed when ledger is missing or pages were not extracted", () => {
  assert.equal(evaluateEvidenceReadiness(null).status, "no_claims");
  const report = evaluateEvidenceReadiness({ claims: [{ id: "c1", claim: "Brian Scalabrine played in the NBA", sources: [
    { id: "s1", url: "https://example.org", extractionStatus: "pending", sourceExcerpt: passage }
  ] }] });
  assert.equal(report.status, "insufficient");
  assert.equal(report.claims[0].openedSourceCount, 0);
});
