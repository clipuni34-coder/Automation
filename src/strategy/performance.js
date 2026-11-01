function nonNegative(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function percent(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 10000) / 100 : null;
}

export function summarizeVideoPerformance(metrics = {}) {
  const views = nonNegative(metrics.views);
  const likes = nonNegative(metrics.likes);
  const comments = nonNegative(metrics.comments);
  const shares = nonNegative(metrics.shares);
  const duration = nonNegative(metrics.durationSeconds);
  const averageView = nonNegative(metrics.averageViewDurationSeconds);
  const impressions = nonNegative(metrics.impressions);
  return {
    views,
    likes,
    comments,
    shares,
    subscribersGained: nonNegative(metrics.subscribersGained),
    averageViewDurationSeconds: averageView || null,
    averagePercentViewed: duration > 0 && averageView > 0 ? Math.min(100, Math.round(averageView / duration * 10000) / 100) : null,
    engagementRate: percent(likes + comments + shares, views),
    likeRate: percent(likes, views),
    commentRate: percent(comments, views),
    shareRate: percent(shares, views),
    impressionsClickThroughRate: Number.isFinite(metrics.impressionsClickThroughRate) ? metrics.impressionsClickThroughRate : null,
    viewedVsSwipedAwayPercent: Number.isFinite(metrics.viewedVsSwipedAwayPercent) ? metrics.viewedVsSwipedAwayPercent : null,
    dataCompleteness: ["views","likes","comments","shares"].filter(key => Number.isFinite(metrics[key])).length / 4
  };
}

export function recommendNextExperiment({ current, baseline = {}, sampleSize = 1 } = {}) {
  const performance = summarizeVideoPerformance(current);
  const suggestions = [];
  if (sampleSize < 3) {
    suggestions.push("Collect at least three comparable uploads before treating this result as a channel-level pattern.");
  }
  if (performance.averagePercentViewed !== null && Number.isFinite(baseline.averagePercentViewed) && performance.averagePercentViewed < baseline.averagePercentViewed * 0.8) {
    suggestions.push("Test a faster opening and earlier payoff; average viewed percentage is materially below this channel's baseline.");
  }
  if (performance.viewedVsSwipedAwayPercent !== null && Number.isFinite(baseline.viewedVsSwipedAwayPercent) && performance.viewedVsSwipedAwayPercent < baseline.viewedVsSwipedAwayPercent * 0.85) {
    suggestions.push("Test a clearer first-frame promise and stronger opening visual; the Shorts viewed-versus-swiped signal is below baseline.");
  }
  if (performance.impressionsClickThroughRate !== null && Number.isFinite(baseline.impressionsClickThroughRate) && performance.impressionsClickThroughRate < baseline.impressionsClickThroughRate * 0.8) {
    suggestions.push("Test a more specific title and a clearer thumbnail promise without misleading viewers.");
  }
  if (performance.commentRate !== null && Number.isFinite(baseline.commentRate) && performance.commentRate < baseline.commentRate * 0.8) {
    suggestions.push("Test a genuine, topic-relevant question that invites useful discussion; do not solicit spam or manufacture comments.");
  }
  if (!suggestions.length) suggestions.push("No strong underperformance signal is available against the supplied baseline; keep the current format and continue collecting comparable results.");
  return {
    performance,
    sampleSize,
    baseline,
    nextExperiments: suggestions,
    caveat: "Use platform-reported metrics with their reporting window and attribution. Small samples and changing distribution make results noisy; no metric predicts guaranteed virality."
  };
}
