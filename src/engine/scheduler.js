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
  const rv = candidate?.rightsVerification;
  if (rv) {
    // Uncertain rights are rejected, never guessed. Only independently
    // verified evidence (exact licence match on the source page) passes.
    if (rv.status === "reuse_prohibited") reasons.push("Independent rights check: reuse is PROHIBITED by the observed licence terms");
    else if (rv.status === "permission_unclear") reasons.push("Independent rights check: licence could not be reconciled exactly with the recorded claim (permission unclear)");
    else if (rv.status !== "rights_verified_with_evidence") reasons.push(`Independent rights check did not verify this source (status: ${rv.status}); recorded evidence alone is not sufficient for production`);
    if (rv.attributionRequired && !(lic.attributionRequirement || candidate?.attributionText)) reasons.push("Licence requires attribution but no attribution text is recorded for the posting package");
  } else if (candidate?.rightsEvidenceUrl?.startsWith("https://") || lic.evidenceUrl?.startsWith("https://")) {
    reasons.push("Rights evidence exists but was not independently verified in this cycle");
  }
  const licText = `${candidate?.license?.type ?? ""} ${candidate?.license?.usageTerms ?? ""}`;
  if (/noncommercial|no ?derivatives/i.test(licText)) reasons.push("Licence terms restrict commercial use or derivative works");
  return { eligible: reasons.length === 0, reasons };
}

export async function runChannelCycle({ channel, niche, state, candidateProvider, produceJob, now = new Date(), maxAttempts = 3, maxJobs = Infinity, persistRun = true, stopOnProduced = false }) {
  const run = { channelId: channel.id, niche: niche?.id ?? channel.niche, startedAt: now.toISOString(), discovered: 0, researchOnlyRejected: 0, rightsVerified: 0, eligible: 0, duplicates: 0, rejected: [], enqueued: 0, awaitingPlan: 0, attempted: 0, produced: 0, qcPassed: 0, completed: 0, failed: 0, retried: 0, status: "ok" };
  const finish = async () => {
    run.finishedAt = new Date().toISOString();
    if (persistRun) await state.appendRun(run);
    return run;
  };
  try {
    const control = await state.getControl();
    if (control.paused || channel.operation?.paused) { run.status = "paused"; return finish(); }
    if (channel.operation?.enabled !== true) { run.status = "disabled"; return finish(); }

    const candidates = await candidateProvider(channel, niche);
    run.discovered = candidates.length;
    const limit = Math.min(channel.operation?.maxCandidatesPerDay ?? 6, maxJobs);
    let accepted = 0;
    for (const candidate of candidates) {
      const isCorrection = Boolean(candidate?.supersedesCandidateId);
      const fingerprint = sourceFingerprint(candidate.sourceUrl ?? candidate.id ?? "", isCorrection ? candidate.id : "");
      if (!isCorrection && await state.hasUsedSource(candidate.sourceUrl ?? "", { rescreenRejected: true, reconsiderPlanned: !candidate.needsProductionPlan, reconsiderUnqueued: true })) {
        // Deduped, but still persist this cycle's live rights verification so
        // the audit record for already-used sources stays current.
        await state.refreshSourceRights(candidate).catch(() => null);
        run.duplicates += 1; continue;
      }
      if (candidate?.rightsVerification?.status === "rights_verified_with_evidence") run.rightsVerified += 1;
      if (candidate?.researchOnly) run.researchOnlyRejected += 1;
      const screen = screenCandidate(candidate);
      if (!screen.eligible) {
        await state.recordSource(candidate, "rejected");
        run.rejected.push({ title: candidate.title ?? null, sourceUrl: candidate.sourceUrl ?? null, reasons: screen.reasons });
        continue;
      }
      run.eligible += 1;
      if (candidate?.needsProductionPlan) {
        // Reusable footage without a reviewed narration/edit plan stays held.
        // Recording it as awaiting a plan prevents treating it as consumed.
        await state.recordSource(candidate, "awaiting_plan");
        run.awaitingPlan += 1;
        continue;
      }
      if (accepted >= limit) {
        // It was never attempted; keep it available for a later safe pass.
        await state.recordSource(candidate, "deferred_capacity");
        continue;
      }
      const { enqueued } = await state.enqueue({ fingerprint, type: "produce", candidate, channelId: channel.id });
      await state.recordSource(candidate, "eligible");
      if (enqueued) { run.enqueued += 1; accepted += 1; }
    }

    // Process this channel's queue (including leftovers from a crashed run).
    const queue = await state.getQueue();
    for (const job of queue.jobs) {
      if (job.status !== "queued" && !(job.status === "failed" && job.attempts < maxAttempts)) continue;
      if (run.attempted >= maxJobs) break;
      run.attempted += 1;
      if (job.status === "failed" || job.attempts > 0) run.retried += 1;
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
        // A completed job is an execution outcome, not necessarily a
        // produced video. Production counts are tracked separately so a
        // zero-production run can never masquerade as production success.
        if (result?.produced === true) { run.produced += 1; run.qcPassed += 1; }
      } catch (error) {
        job.status = job.attempts >= maxAttempts ? "failed" : "queued"; // queued = will retry next cycle; attempts bound the total
        if (job.status === "failed") run.failed += 1;
        job.lastError = String(error?.message ?? error).slice(0, 500); job.updatedAt = new Date().toISOString();
      }
      await state.saveQueue(queue);
      if (stopOnProduced && run.produced > 0) break;
    }
  } catch (error) {
    // Preserve counters from completed work if a later discovery/state step
    // fails; do not replace a partial pass with a fictitious zero-attempt run.
    run.status = "error";
    run.error = String(error?.message ?? error).slice(0, 500);
  }
  return finish();
}

// A bounded, production-only retry stays INSIDE a single scheduled run.
// Held items stay held; later passes look for other independently screened,
// fully planned candidates. Research-only/unplanned footage remains blocked.
// This function never uploads or changes the external scheduler.
export async function runChannelWithProductionRetries({ channel, niche, state, candidateProvider, produceJob, now = new Date(), maxPasses = 3, maxJobs = 4 }) {
  const passesLimit = Math.max(1, Math.min(3, Number.isInteger(maxPasses) ? maxPasses : 3));
  const configuredLimit = channel.operation?.maxCandidatesPerDay;
  const dailyLimit = Number.isInteger(configuredLimit) ? Math.max(0, configuredLimit) : 4;
  const jobsLimit = Math.max(0, Math.min(4, dailyLimit, Number.isInteger(maxJobs) ? maxJobs : 4));
  const passes = [];
  let attempted = 0;
  let stopReason = "passes_exhausted";
  for (let pass = 0; pass < passesLimit; pass += 1) {
    let result;
    try {
      result = await runChannelCycle({
        channel, niche, state, produceJob,
        candidateProvider: (activeChannel, activeNiche) => candidateProvider(activeChannel, activeNiche, { pass }),
        now: pass === 0 ? now : new Date(),
        maxJobs: jobsLimit - attempted,
        persistRun: false,
        stopOnProduced: true
      });
    } catch (error) {
      result = { channelId: channel.id, niche: niche?.id ?? channel.niche, status: "error", error: String(error?.message ?? error).slice(0, 500), attempted: 0, rejected: [], startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() };
    }
    passes.push(result);
    attempted += result.attempted ?? 0;
    if (result.status !== "ok") { stopReason = result.status; break; }
    if ((result.produced ?? 0) > 0) { stopReason = "produced"; break; }
    if ((result.deferred ?? 0) > 0) { stopReason = "production_deferred"; break; }
    if (attempted >= jobsLimit) { stopReason = "attempt_limit_reached"; break; }
  }
  const first = passes[0];
  const last = passes.at(-1);
  const sumKeys = ["discovered", "researchOnlyRejected", "rightsVerified", "eligible", "duplicates", "enqueued", "awaitingPlan", "attempted", "produced", "qcPassed", "completed", "failed", "retried", "deferred"];
  const total = Object.fromEntries(sumKeys.map((key) => [key, passes.reduce((n, run) => n + (run[key] ?? 0), 0)]));
  const aggregate = {
    channelId: channel.id,
    niche: niche?.id ?? channel.niche,
    startedAt: first.startedAt,
    finishedAt: last.finishedAt,
    status: last.status,
    ...total,
    rejected: passes.flatMap((run) => run.rejected ?? []),
    retry: {
      countBasis: "candidate observations across passes; repeated candidates can appear more than once",
      passes: passes.length,
      maxPasses: passesLimit,
      maxProductionAttempts: jobsLimit,
      stopReason,
      passResults: passes.map((run, index) => ({ pass: index + 1, discovered: run.discovered ?? 0, enqueued: run.enqueued ?? 0, awaitingPlan: run.awaitingPlan ?? 0, attempted: run.attempted ?? 0, produced: run.produced ?? 0, status: run.status }))
    },
    ...(last.error ? { error: last.error } : {})
  };
  await state.appendRun(aggregate);
  return aggregate;
}

export async function runDailyOperations({ channels, nicheRegistry, openState, candidateProvider, produceJob, retryPolicyForChannel = () => null, now = new Date() }) {
  const runs = [];
  for (const channel of channels) {
    try {
      const niche = resolveChannelNiche(channel, nicheRegistry);
      const state = await openState(channel.id);
      const retry = retryPolicyForChannel(channel);
      runs.push(retry
        ? await runChannelWithProductionRetries({ channel, niche, state, candidateProvider, produceJob, now, ...retry })
        : await runChannelCycle({ channel, niche, state, candidateProvider, produceJob, now }));
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
