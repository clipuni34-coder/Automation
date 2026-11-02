import test from "node:test";
import assert from "node:assert/strict";
import { evaluateProductionGate } from "../src/creative/production-gate.js";

const approved = {
  claimsToVerify: [],
  briefDigest: "sha256:exact-brief",
  humanEditorialReview: {
    status: "approved",
    approvedAt: "2026-11-02T12:00:00.000Z",
    reviewer: "channel-owner",
    briefDigest: "sha256:exact-brief"
  }
};
const cleanLedger = { totalClaims: 0, verifiedClaims: 0, unresolvedClaims: 0, claims: [] };

test("production gate holds generated briefs without explicit human approval", () => {
  const result = evaluateProductionGate({ editorial: { claimsToVerify: [] }, claimLedger: cleanLedger });
  assert.equal(result.status, "held");
  assert.equal(result.productionEligible, false);
  assert.ok(result.reasons.some((reason) => /human editorial approval/.test(reason)));
});

test("production gate holds every unresolved or unverified factual claim", () => {
  const ledger = {
    totalClaims: 1, verifiedClaims: 0, unresolvedClaims: 1,
    claims: [{ id: "claim-1", verificationDecision: "not_verified" }]
  };
  const result = evaluateProductionGate({
    editorial: { ...approved, claimsToVerify: [] }, claimLedger: ledger
  });
  assert.equal(result.productionEligible, false);
  assert.ok(result.reasons.some((reason) => /verification decision/.test(reason)));
  assert.ok(result.reasons.some((reason) => /human verification/.test(reason)));
});

test("production gate holds claims still listed for verification", () => {
  const result = evaluateProductionGate({
    editorial: { ...approved, claimsToVerify: ["A factual claim"] }, claimLedger: cleanLedger
  });
  assert.equal(result.productionEligible, false);
  assert.ok(result.reasons.some((reason) => /still lists factual claims/.test(reason)));
});

test("production gate passes only when every claim and the exact brief are human-approved", () => {
  const ledger = {
    totalClaims: 1, verifiedClaims: 1, unresolvedClaims: 0,
    claims: [{ id: "claim-1", verificationDecision: "verified_by_human" }]
  };
  const result = evaluateProductionGate({
    editorial: {
      ...approved,
      claimsToVerify: [],
      humanEditorialReview: { ...approved.humanEditorialReview, briefDigest: "sha256:exact-brief" }
    },
    claimLedger: ledger
  });
  assert.equal(result.status, "passed");
  assert.equal(result.productionEligible, true);
  assert.deepEqual(result.reasons, []);
});

test("production gate rejects approval copied from a different brief", () => {
  const result = evaluateProductionGate({
    editorial: { ...approved, briefDigest: "sha256:new-brief" }, claimLedger: cleanLedger
  });
  assert.equal(result.productionEligible, false);
  assert.ok(result.reasons.some((reason) => /exact brief/.test(reason)));
});
