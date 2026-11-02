import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { evaluateProductionGate } from "../src/creative/production-gate.js";

const inputPath = resolve(process.argv[2] ?? "approved-artifact/research-1793632303859.creative.json");
const outputPath = resolve(process.argv[3] ?? "research-approved-mclintock.creative.json");
const document = JSON.parse(await readFile(inputPath, "utf8"));
const editorial = document.editorial;

const expectedOriginalDigest = "sha256:7756af6901b5d31170bf8aecfe44f9ac8d016e4566205d44b575ebb51521897d";
const approvedClaims = [
  "McLintock! was released in 1963.",
  "John Wayne played rancher G.W. McLintock in McLintock! (1963).",
  "G.W. McLintock shoots Devlin Warren with a blank cartridge following Becky's demand in McLintock! (1963)."
];

if (editorial?.briefDigest !== expectedOriginalDigest) {
  throw new Error("The downloaded brief digest does not match the exact brief approved by the channel owner.");
}
if (JSON.stringify(editorial.claimsToVerify) !== JSON.stringify(approvedClaims)) {
  throw new Error("The factual claims differ from the three claims explicitly approved by the channel owner.");
}
if (!Array.isArray(editorial.claimLedger?.claims) || editorial.claimLedger.claims.length !== approvedClaims.length ||
    editorial.claimLedger.claims.some((claim, index) => claim.claim !== approvedClaims[index])) {
  throw new Error("The claim ledger does not match the approved claim list.");
}

const approvedAt = new Date().toISOString();
for (const claim of editorial.claimLedger.claims) {
  claim.status = "verified_by_human";
  claim.verificationDecision = "verified_by_human";
  claim.reviewNote = "The channel owner explicitly approved this exact claim in ChatGPT after source review. Supporting references: AFI Catalog for release and film details; IMDb full cast for John Wayne's role; PBS film excerpt for the blank-cartridge dialogue.";
}
editorial.claimLedger.status = "human_reviewed";
editorial.claimLedger.verifiedClaims = approvedClaims.length;
editorial.claimLedger.unresolvedClaims = 0;
editorial.claimLedger.humanReviewedAt = approvedAt;
editorial.claimLedger.humanReviewer = "channel-owner-approved-in-chat";
editorial.claimsToVerify = [];

editorial.humanEditorialReview = {
  status: "approved",
  approvedAt,
  reviewer: "channel-owner-approved-in-chat",
  approvalScope: "The three listed factual claims in this exact creative brief only. This approval does not grant copyright, licensing, or reuse rights to the reference video.",
  sourceReview: {
    releaseAndFilm: "https://catalog.afi.com/Film/21556-MCLINTOCK",
    cast: "https://www.imdb.com/title/tt0057298/fullcredits/",
    scene: "https://www.pbs.org/video/mclintock-1963-d2qm3e/"
  }
};

const digestInput = {
  topic: document.topic,
  editorial: {
    ...editorial,
    briefDigest: undefined,
    productionGate: undefined,
    humanEditorialReview: undefined
  }
};
editorial.briefDigest = "sha256:" + createHash("sha256").update(JSON.stringify(digestInput)).digest("hex");
editorial.humanEditorialReview.briefDigest = editorial.briefDigest;
editorial.productionGate = evaluateProductionGate({ editorial, claimLedger: editorial.claimLedger });

if (!editorial.productionGate.productionEligible) {
  throw new Error("Approved brief still fails production gate: " + editorial.productionGate.reasons.join(" "));
}

await writeFile(outputPath, JSON.stringify(document, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({
  status: "approved_for_test_render",
  outputPath,
  approvedClaims: approvedClaims.length,
  briefDigest: editorial.briefDigest,
  productionGate: editorial.productionGate
}, null, 2));
