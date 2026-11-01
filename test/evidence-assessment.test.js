import test from "node:test";
import assert from "node:assert/strict";
import { assessClaimEvidence } from "../src/research/evidence-assessment.js";

const ledger = {
  claims: [{
    id: "claim-1", claim: "The report says revenue increased.",
    sources: [
      { id: "claim-1-source-1", title: "Report", url: "https://example.org/report", publishedAt: null,
        extractionStatus: "opened", extractedContent: "Revenue increased by 12% in the reported period.", sourceExcerpt: "" },
      { id: "claim-1-source-2", title: "Unrelated", url: "https://example.org/other", publishedAt: null,
        extractionStatus: "failed", extractedContent: null, sourceExcerpt: "Weather was sunny." }
    ]
  }]
};

test("evidence assessment returns source-linked advisory relationships without verifying claims", async () => {
  let request;
  const result = await assessClaimEvidence({
    claimLedger: ledger, apiKey: "test-key",
    fetchImpl: async (url, options) => {
      request = { url, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        assessments: [{
          claimId: "claim-1", decision: "supports", confidence: "medium",
          rationale: "The extracted passage directly states an increase.",
          evidence: [{ sourceId: "claim-1-source-1", relation: "supports", passage: "Revenue increased by 12%." }]
        }]
      }) }] } }] }) };
    }
  });
  assert.equal(result.status, "ok");
  assert.equal(result.assessed, 1);
  assert.equal(result.claims[0].assessment.decision, "supports");
  assert.equal(result.claims[0].assessment.verificationDecision, "not_verified");
  assert.equal(result.claims[0].assessment.requiresHumanReview, true);
  assert.match(request.url, /gemini-3\.8-flash/);
  const prompt = request.body.contents[0].parts[0].text;
  assert.match(prompt, /Revenue increased by 12%/);
  assert.match(prompt, /Weather was sunny/);
});

test("evidence assessment rejects evidence references to unknown sources", async () => {
  const result = await assessClaimEvidence({
    claimLedger: ledger, apiKey: "test-key",
    fetchImpl: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      assessments: [{ claimId: "claim-1", decision: "supports", confidence: "high", rationale: "Text", evidence: [
        { sourceId: "made-up-source", relation: "supports", passage: "Invented" }
      ] }]
    }) }] } }] }) })
  });
  assert.equal(result.status, "ok");
  assert.deepEqual(result.claims[0].assessment.evidence, []);
  assert.equal(result.claims[0].assessment.verificationDecision, "not_verified");
});

test("evidence assessment reports missing provider without inventing a decision", async () => {
  const result = await assessClaimEvidence({ claimLedger: ledger, apiKey: "" });
  assert.equal(result.status, "not_configured");
  assert.equal(result.assessed, 0);
});

test("evidence assessment fails closed when provider output is unusable", async () => {
  const result = await assessClaimEvidence({
    claimLedger: ledger, apiKey: "test-key",
    fetchImpl: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }) })
  });
  assert.equal(result.status, "failed");
  assert.equal(result.assessed, 0);
});
