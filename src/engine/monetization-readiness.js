// Per-channel monetization readiness. Tracks progress against current
// YouTube Partner Programme thresholds and flags policy risks. It never
// promises acceptance — YouTube reviews channels manually.
import { evaluateChannelMonetization } from "../strategy/monetization.js";

export const YPP_THRESHOLDS = {
  expanded: { subscribers: 500, validPublicWatchHours: 3000, shortsViews90d: 3000000, uploads90d: 3 },
  full: { subscribers: 1000, validPublicWatchHours: 4000, shortsViews90d: 10000000 }
};

export function assessMonetizationReadiness({ metrics = {}, productionHistory = [], policy = {} } = {}) {
  const subs = Number(metrics.subscribers ?? 0);
  const watchHours = Number(metrics.validPublicWatchHours ?? 0);
  const shortsViews = Number(metrics.shortsViews90d ?? 0);
  const pct = (v, t) => Math.min(100, Math.round((Number(v) / t) * 1000) / 10);
  const risks = [];
  const reused = productionHistory.filter((v) => v.originalContribution !== true);
  if (productionHistory.length && reused.length / productionHistory.length > 0.5) {
    risks.push({ level: "high", type: "reused_content_risk", detail: `${reused.length}/${productionHistory.length} recent videos lack a recorded original contribution (narration/commentary/transformation).` });
  }
  const rightsUnverified = productionHistory.filter((v) => v.rightsVerificationStatus !== "verified");
  if (rightsUnverified.length) risks.push({ level: "medium", type: "rights_not_independently_verified", detail: `${rightsUnverified.length} videos rely on recorded evidence that has not been independently verified.` });
  const titles = productionHistory.map((v) => String(v.title ?? "").toLowerCase().trim()).filter(Boolean);
  if (new Set(titles).size < titles.length) risks.push({ level: "medium", type: "repetitive_content_risk", detail: "Duplicate titles detected in recent production history; repetitive/mass-produced patterns are a YPP review risk." });
  if (policy.activeStrikes) risks.push({ level: "high", type: "community_guidelines_strikes", detail: `${policy.activeStrikes} active strike(s).` });
  return {
    thresholds: YPP_THRESHOLDS,
    progress: {
      subscribers: { current: subs, expandedPct: pct(subs, 500), fullPct: pct(subs, 1000) },
      validPublicWatchHours: { current: watchHours, expandedPct: pct(watchHours, 3000), fullPct: pct(watchHours, 4000) },
      shortsViews90d: { current: shortsViews, expandedPct: pct(shortsViews, 3000000), fullPct: pct(shortsViews, 10000000) }
    },
    expandedEligibleByNumbers: subs >= 500 && (watchHours >= 3000 || shortsViews >= 3000000),
    fullEligibleByNumbers: subs >= 1000 && (watchHours >= 4000 || shortsViews >= 10000000),
    risks,
    evaluation: evaluateChannelMonetization({ metrics, policyStatus: policy.status ?? "unknown", activeStrikes: policy.activeStrikes ?? 0 }),
    note: "Meeting numeric thresholds does not guarantee YPP acceptance; YouTube also reviews policy compliance and originality."
  };
}
