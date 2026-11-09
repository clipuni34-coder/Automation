// Daily production reporting. Execution success ("the workflow ran") and
// production success ("a video was actually produced and passed QC") are
// different claims and are reported separately. A production-enabled run
// that produced zero videos reports `no_production`, never success.
export function buildProductionReport(summary, { productionEnabled = false } = {}) {
  const channels = (summary?.runs ?? []).map((run) => {
    const produced = run.produced ?? 0;
    return {
      channelId: run.channelId,
      executionStatus: run.status ?? "unknown",
      discovered: run.discovered ?? 0,
      researchOnlyRejected: run.researchOnlyRejected ?? 0,
      rightsVerified: run.rightsVerified ?? 0,
      eligible: run.eligible ?? 0,
      rejected: (run.rejected ?? []).length,
      duplicates: run.duplicates ?? 0,
      enqueued: run.enqueued ?? 0,
      awaitingPlan: run.awaitingPlan ?? 0,
      attempted: run.attempted ?? 0,
      retry: run.retry ?? null,
      produced,
      qcPassed: run.qcPassed ?? 0,
      uploaded: 0, // uploads happen only in the separate per-video approval step
      productionOutcome: run.status === "paused" || run.status === "disabled"
        ? run.status
        : !productionEnabled
          ? "production_disabled"
          : produced > 0
            ? "produced"
            : "no_production"
    };
  });
  const totals = channels.reduce((acc, c) => {
    for (const k of ["discovered", "researchOnlyRejected", "rightsVerified", "eligible", "rejected", "duplicates", "enqueued", "awaitingPlan", "attempted", "produced", "qcPassed", "uploaded"]) acc[k] += c[k] ?? 0;
    return acc;
  }, { discovered: 0, researchOnlyRejected: 0, rightsVerified: 0, eligible: 0, rejected: 0, duplicates: 0, enqueued: 0, awaitingPlan: 0, attempted: 0, produced: 0, qcPassed: 0, uploaded: 0 });
  return {
    generatedAt: summary?.generatedAt ?? new Date().toISOString(),
    productionEnabled: Boolean(productionEnabled),
    totals,
    productionOutcome: !productionEnabled
      ? "production_disabled"
      : totals.produced > 0
        ? "produced"
        : "no_production",
    channels
  };
}
