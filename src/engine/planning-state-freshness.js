// GitHub Actions checks out state once at the start of a long production
// run. A reviewer might commit a revocation while it runs. Immediately
// before launching an inbox candidate, fetch the state ref and defer if its
// planning decisions changed since checkout. This is not a distributed lock;
// a later change can still race rendering, and publication remains a separate
// approval. A network/verification error fails closed and preserves the job.
import { spawnSync } from "node:child_process";

export function checkRemotePlanningState({ stateRoot, channelId = "Primeplug", gitPath = "git", timeoutMs = 60000 } = {}) {
  if (channelId !== "Primeplug" || !stateRoot) return { fresh: false, reason: "Invalid planning state scope." };
  const run = (args) => spawnSync(gitPath, ["-C", stateRoot, ...args], { encoding: "utf8", timeout: timeoutMs, maxBuffer: 1024 * 1024 });
  const fetched = run(["fetch", "--no-tags", "origin", "+refs/heads/automation-state:refs/remotes/origin/automation-state"]);
  if (fetched.status !== 0) return { fresh: false, reason: "The current remote planning state could not be verified." };
  const diff = run(["diff", "--quiet", "HEAD", "refs/remotes/origin/automation-state", "--", `${channelId}/planning-inbox.json`]);
  if (diff.status === 0) return { fresh: true, reason: null };
  if (diff.status === 1) return { fresh: false, reason: "Remote planning decisions changed during this run; refresh state before producing." };
  return { fresh: false, reason: "The current remote planning state could not be compared." };
}
