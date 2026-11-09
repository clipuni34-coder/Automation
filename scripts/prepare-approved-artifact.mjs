// Prepare a single explicitly approved, previously produced video. This step
// only restores exact bytes and writes a local reservation; it never uploads.
import { restoreAndReserveApprovedArtifact } from "../src/production/approved-artifact.js";

const result = await restoreAndReserveApprovedArtifact({
  stateRoot: process.env.STATE_DIR,
  artifactRoot: process.env.APPROVED_ARTIFACT_ROOT,
  approvedCandidateId: process.env.APPROVED_CANDIDATE_ID,
  approvedSha256: process.env.APPROVED_SHA256,
  approvedAudience: process.env.APPROVED_AUDIENCE,
  attemptId: process.env.UPLOAD_ATTEMPT_ID
});
console.log(JSON.stringify(result, null, 2));
