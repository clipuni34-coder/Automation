import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { generateEditorialPlan } from "./provider.js";
import { searchTopic, extractSources } from "../research/tavily.js";
import { buildClaimLedger } from "../research/claim-ledger.js";
import { assessClaimEvidence } from "../research/evidence-assessment.js";
import { evaluateProductionGate } from "./production-gate.js";
import { applyEditorialEvidenceHold } from "./evidence-hold.js";
import { evaluateEvidenceReadiness } from "../research/evidence-readiness.js";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: npm run create-brief -- <research-dossier.json>");
  process.exitCode = 1;
} else {
  try {
    const dossier = JSON.parse(await readFile(resolve(inputPath), "utf8"));
    const result = await generateEditorialPlan({ dossier });
    if (result.status !== "ok") {
      console.log(JSON.stringify({ status: result.status, topic: dossier.topic }));
    } else {
      // Pass 1 proposes a story and identifies its factual claims.
      const firstPassLedger = await buildClaimLedger({
        claims: result.plan.claimsToVerify, search: searchTopic, extract: extractSources
      });

      // Keep the revision prompt bounded while retaining opened source passages.
      const revisionLedger = {
        ...firstPassLedger,
        claims: firstPassLedger.claims.map((claim) => ({
          ...claim,
          sources: (claim.sources ?? []).slice(0, 3).map((source) => ({
            ...source,
            sourceExcerpt: String(source.sourceExcerpt ?? "").slice(0, 500),
            extractedContent: String(source.extractedContent ?? "").slice(0, 3500)
          }))
        }))
      };
      const revisionDraft = {
        workingTitle: result.plan.workingTitle,
        recommendedAngle: result.plan.recommendedAngle,
        fullScript: result.plan.fullScript,
        claimsToVerify: result.plan.claimsToVerify
      };

      // Pass 2 rewrites against opened source text, not discovery snippets or model memory.
      const groundedResult = await generateEditorialPlan({
        dossier: { ...dossier, claimEvidenceLedger: revisionLedger, firstPassEditorialDraft: revisionDraft }
      });
      if (groundedResult.status !== "ok") {
        throw new Error("Evidence-grounded revision did not complete; refusing to save a production brief.");
      }

      // Re-check the claims in the revised script, because the model may have changed them.
      const claimLedger = await buildClaimLedger({
        claims: groundedResult.plan.claimsToVerify, search: searchTopic, extract: extractSources
      });
      const evidenceAssessment = await assessClaimEvidence({ claimLedger });
      const assessedById = new Map(evidenceAssessment.claims.map((item) => [item.claimId, item.assessment]));
      for (const claim of claimLedger.claims) {
        claim.evidenceAssessment = assessedById.get(claim.id) ?? {
          decision: "not_addressed", confidence: "low", rationale: evidenceAssessment.status === "not_configured"
            ? "Evidence assessment provider is not configured." : "No assessment available; human review required.",
          evidence: [], requiresHumanReview: true, verificationDecision: "not_verified"
        };
      }
      claimLedger.evidenceAssessment = {
        status: evidenceAssessment.status, assessed: evidenceAssessment.assessed,
        model: evidenceAssessment.model ?? null, error: evidenceAssessment.error ?? null,
        policy: "AI evidence relationships are advisory only. No claim is verified without human editorial review."
      };
      const evidenceReadiness = evaluateEvidenceReadiness(claimLedger);
      const evidenceHeldPlan = applyEditorialEvidenceHold({ plan: groundedResult.plan, claimLedger });
      const editorial = {
        ...dossier.editorial, ...evidenceHeldPlan, claimLedger, evidenceReadiness,
        status: "brief_generated", provider: groundedResult.provider,
        generatedAt: new Date().toISOString(),
        humanEditorialReview: dossier.editorial?.humanEditorialReview ?? null
      };
      // Bind any later human approval to this exact brief, not just the topic.
      const digestInput = JSON.stringify({ topic: dossier.topic, editorial: {
        ...editorial, briefDigest: undefined, productionGate: undefined,
        humanEditorialReview: undefined
      } });
      editorial.briefDigest = "sha256:" + createHash("sha256").update(digestInput).digest("hex");
      editorial.productionGate = evaluateProductionGate({ editorial, claimLedger });
      const output = { ...dossier, editorial };
      const outputPath = resolve(inputPath.replace(/\.json$/i, "") + ".creative.json");
      await writeFile(outputPath, JSON.stringify(output, null, 2) + "\n", { mode: 0o600 });
      console.log(JSON.stringify({
        status: "ok", topic: dossier.topic, provider: groundedResult.provider, outputPath,
        claims: claimLedger.totalClaims, extractedSources: claimLedger.sourceExtraction.extracted,
        evidenceReadiness: evidenceReadiness.status,
        extractionStatus: claimLedger.sourceExtraction.status,
        productionGate: editorial.productionGate.status,
        productionEligible: editorial.productionGate.productionEligible,
        holdReasons: editorial.productionGate.reasons
      }));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
