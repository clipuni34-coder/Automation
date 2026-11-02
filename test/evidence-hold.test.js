import test from "node:test";
import assert from "node:assert/strict";
import { applyEditorialEvidenceHold } from "../src/creative/evidence-hold.js";

test("holds all production-facing copy when factual claims remain unresolved", () => {
  const plan = {
    workingTitle: "A bold title",
    hookOptions: ["A risky hook"],
    fullScript: "A complete but unverified narration.",
    scriptBeats: [{ narration: "Unverified statement" }],
    visualPlan: [{ visual: "A scene depicting the statement" }],
    callToAction: "Comment below",
    claimsToVerify: ["A factual claim"]
  };
  const result = applyEditorialEvidenceHold({
    plan,
    claimLedger: { unresolvedClaims: 1, claims: [{ verificationDecision: "not_verified" }] },
    now: () => "2026-11-02T00:00:00.000Z"
  });
  assert.equal(result.scriptReadiness.status, "held_for_fact_check");
  assert.equal(result.fullScript, "");
  assert.deepEqual(result.hookOptions, []);
  assert.deepEqual(result.scriptBeats, []);
  assert.deepEqual(result.visualPlan, []);
  assert.equal(result.callToAction, "");
  assert.equal(result.reviewOnlyDraft.fullScript, plan.fullScript);
  assert.equal(result.reviewOnlyDraft.status, "not_for_production");
});

test("does not hold content when no claims remain unresolved", () => {
  const plan = { fullScript: "Verified draft", claimsToVerify: [] };
  const result = applyEditorialEvidenceHold({
    plan,
    claimLedger: { unresolvedClaims: 0, claims: [{ verificationDecision: "verified_by_human" }] }
  });
  assert.equal(result.fullScript, "Verified draft");
  assert.equal(result.scriptReadiness.held, false);
});

test("fails closed when the claim ledger is missing but claims are listed", () => {
  const result = applyEditorialEvidenceHold({
    plan: { fullScript: "Potentially unsafe", claimsToVerify: ["Claim"] },
    claimLedger: null
  });
  assert.equal(result.fullScript, "");
  assert.equal(result.scriptReadiness.status, "held_for_fact_check");
});

test("holds a complete-sounding script when the model omits its claim inventory", () => {
  const result = applyEditorialEvidenceHold({
    plan: { workingTitle: "An interesting story", fullScript: "This narration contains factual statements but lists no claims.", claimsToVerify: [] },
    claimLedger: { totalClaims: 0, verifiedClaims: 0, unresolvedClaims: 0, claims: [] },
    now: () => "2026-11-02T00:00:00.000Z"
  });
  assert.equal(result.scriptReadiness.status, "held_for_fact_check");
  assert.equal(result.fullScript, "");
  assert.match(result.reviewOnlyDraft.reason, /no factual-claim inventory/i);
});
