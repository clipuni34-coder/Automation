// Central daily scheduler. Every channel runs independently inside its own
// try/catch: a failure (or a pause, or missing credentials) on one channel
// is recorded and never stops the others. Jobs are persisted in channel
// state, deduplicated by source fingerprint, and retried with a bounded
// attempt count so a restarted run resumes instead of repeating work.
import { sourceFingerprint } from "./state.js";
import { resolveChannelNiche } from "./niches.js";

const APPROVED_RIGHTS = new Set(["owned_by_user", "permission_granted", "licensed", "public_domain"]);

export function screenCandidate(candidate) {
  const reasons = [];
  if (!candidate?.sourceUrl?.startsWith("https://")) reasons.push("Source URL is missing or not HTTPS");
  if (!candidate?.creator) reasons.push("Original creator/publisher is not recorded");
  const lic = candidate?.license ?? {};
  if (!APPROVED_RIGHTS.has(lic.rightsStatus ?? candidate?.rightsStatus)) reasons.push("Reuse rights status is not approved");
  if (!candidate?.rightsEvidenceUrl?.startsWith("https://") && !lic.evidenceUrl?.startsWith("https://")) reasons.push("Licence evidence URL is missing");
  if (candidate?.researchOnly) reasons.push("Research reference only — no reuse evidence; not eligible for production");
  return { eligible: reasons.length === 0, reasons };
}

export async function runChannelCycle({ channel, niche, state, candidateProvider, produceJob, now = new Date(), maxAttempts = 3 }) {
  const run = { channelId: channel.id, niche: niche?.id ?? channel.niche, startedAt: now.toISOString(), discovered: 0, duplicates: 0, rejected: [], enqueued: 0, completed: 0, failed: 0, retried: 0, status: "ok" };
  const control = await state.getControl();
  if (control.paused || channel.operation?.paused) { run.status = "paused"; run.finishedAt = new Date().toISOString(); await state.appendRun(run); return run; }
  if (channel.operation?.enabled !== true) { run.status = "disabled"; run.finishedAt = new Date().toISOString(); await state.appendRun(run); return run; }

  const candidates = await candidateProvider(channel, niche);
  run.discovered = candidates.length;
  const limit = channel.operation?.maxCandidatesPerDay ?? 6;
  let accepted = 0;
  for (const candidate of candidates) {
    const fingerprint = sourceFingerprint(candidate.sourceUrl ?? candidate.id ?? "");
    if (await state.hasUsedSource(candidate.sourceUrl ?? "")) { run.duplicates += 1; continue; }
    const screen = screenCandidate(candidate);
    await state.recordSource(candidate, screen.eligible ? "eligible" : "rejected");
    if (!screen.eligible) { run.rejected.push({ title: candidate.title ?? null, sourceUrl: candidate.sourceUrl ?? null, reasons: screen.reasons }); continue; }
    if (accepted >= limit) continue;
    const { enqueued } = await state.enqueue({ fingerprint, type: "produce", candidate, channelId: channel.id });
    if (enqueued) { run.enqueued += 1; accepted += 1; }
  }

  // Process this channel's queue (including leftovers from a crashed run).
  const queue = await state.getQueue();
  for (const job of queue.jobs) {
    if (job.status !== "queued" && !(job.status === "failed" && job.attempts < maxAttempts)) continue;
    if (job.status === "failed") run.retried += 1;
    job.status = "running"; job.attempts += 1; job.updatedAt = new Date().toISOString();
    await state.saveQueue(queue);
    try {
      const result = await produceJob(job, channel, niche);
      if (result?.deferred) {
        // Not a failure and not a completion: production was disabled for
        // this cycle. Keep the job queued and do not burn a retry attempt,
        // so the next production-enabled cycle actually produces it.
        job.status = "queued"; job.attempts = Math.max(0, job.attempts - 1);
        job.result = result; job.updatedAt = new Date().toISOString();
        run.deferred = (run.deferred ?? 0) + 1;
        await state.saveQueue(queue);
        continue;
      }
      job.status = "completed"; job.result = result ?? { ok: true }; job.finishedAt = new Date().toISOString();
      run.completed += 1;
    } catch (error) {
      job.status = job.attempts >= maxAttempts ? "failed" : "queued"; // queued = will retry next cycle; attempts bound the total
      if (job.status === "failed") run.failed += 1;
      job.lastError = String(error?.message ?? error).slice(0, 500); job.updatedAt = new Date().toISOString();
    }
    await state.saveQueue(queue);
  }
  run.finishedAt = new Date().toISOString();
  await state.appendRun(run);
  return run;
}

export async function runDailyOperations({ channels, nicheRegistry, openState, candidateProvider, produceJob, now = new Date() }) {
  const runs = [];
  for (const channel of channels) {
    try {
      const niche = resolveChannelNiche(channel, nicheRegistry);
      const state = await openState(channel.id);
      runs.push(await runChannelCycle({ channel, niche, state, candidateProvider, produceJob, now }));
    } catch (error) {
      runs.push({ channelId: channel.id, status: "error", error: String(error?.message ?? error).slice(0, 500) });
    }
  }
  return {
    generatedAt: new Date(now).toISOString(),
    channelsRun: runs.length,
    completedChannels: runs.filter((r) => r.status === "ok").length,
    runs
  };
}
