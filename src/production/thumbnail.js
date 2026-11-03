/**
 * Choose a representative thumbnail frame from the strongest selected moment,
 * not the first frame of the finished edit (which is often a source slate/logo).
 * Timeline order remains unchanged; this only selects a frame for the cover image.
 */
export function selectThumbnailTime(plan, renderedDurationSeconds) {
  const moments = Array.isArray(plan?.editDecisionList) ? plan.editDecisionList : [];
  if (!moments.length || !Number.isFinite(Number(renderedDurationSeconds)) || renderedDurationSeconds <= 0) {
    return 0;
  }
  let timelineStart = 0;
  let best = null;
  for (const moment of moments) {
    const duration = Number(moment.sourceOut) - Number(moment.sourceIn);
    if (!Number.isFinite(duration) || duration <= 0) continue;
    const score = Number.isFinite(Number(moment.score)) ? Number(moment.score) : 0;
    if (!best || score > best.score) {
      best = { score, start: timelineStart, duration };
    }
    timelineStart += duration;
  }
  if (!best) return Math.min(1.5, renderedDurationSeconds / 2);
  const midpoint = best.start + best.duration * 0.5;
  return Math.max(0, Math.min(renderedDurationSeconds - 0.15, midpoint));
}
