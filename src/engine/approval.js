// Per-video upload approval.
//
// Approval is NOT a global switch. An approval identifies exactly one
// candidate id AND the exact SHA-256 of the rendered output that was
// QC-passed and reviewed. It authorizes that one file only:
//   - a different candidate with the same approval does not match;
//   - the same candidate re-rendered (different hash) does not match;
//   - superseded outputs never match (handled by the caller excluding
//     superseded ids before matching);
//   - no approval (missing id or hash) authorizes nothing.
export function matchApproval(awaiting, { approvedCandidateId = "", approvedSha256 = "" } = {}) {
  const id = String(approvedCandidateId ?? "").trim();
  const sha = String(approvedSha256 ?? "").trim().toLowerCase();
  if (!id || !sha) {
    return { job: null, reasons: ["No per-video approval recorded (an approval must name one candidate id and its exact output SHA-256)"] };
  }
  if (!/^[a-f0-9]{64}$/.test(sha)) {
    return { job: null, reasons: ["Approved SHA-256 is not a valid 64-character hex hash; approval cannot be matched"] };
  }
  const job = (awaiting ?? []).find((j) => j.candidate?.id === id && String(j.result?.sha256 ?? "").toLowerCase() === sha);
  if (!job) {
    return { job: null, reasons: [`No awaiting video matches the approved candidate id "${id}" with SHA-256 ${sha.slice(0, 12)}… (wrong video, re-rendered hash, superseded output, or already uploaded)`] };
  }
  return { job, reasons: [] };
}
