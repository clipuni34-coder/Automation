const HOUR = 60 * 60 * 1000;

export function scoreCandidate(candidate, previousObservations = []) {
  const now = Date.parse(candidate.observedAt ?? new Date().toISOString());
  const published = Date.parse(candidate.publishedAt ?? "");
  const ageHours = Number.isFinite(published) ? Math.max(0, (now - published) / HOUR) : null;
  const recency = ageHours === null ? 35 : clamp(100 - Math.log2(ageHours + 1) * 13, 0, 100);

  const { views, likes, comments } = candidate.metrics ?? {};
  const engagementRate = Number.isFinite(views) && views > 0
    ? ((likes ?? 0) + (comments ?? 0)) / views
    : null;
  const engagement = engagementRate === null
    ? 35
    : clamp((Math.log10(engagementRate * 10000 + 1) / 2) * 100, 0, 100);

  const prior = [...previousObservations]
    .filter((item) => item.id === candidate.id && Date.parse(item.observedAt) < now)
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
  let velocity = null;
  if (prior && Number.isFinite(views) && Number.isFinite(prior.metrics?.views)) {
    const elapsedHours = (now - Date.parse(prior.observedAt)) / HOUR;
    if (elapsedHours > 0 && elapsedHours <= 24 * 14) {
      velocity = Math.max(0, views - prior.metrics.views) / elapsedHours;
    }
  }
  const velocityScore = velocity === null
    ? 30
    : clamp(Math.log10(velocity + 1) * 22, 0, 100);

  const completeness = [
    candidate.title,
    candidate.sourceUrl,
    candidate.publishedAt,
    candidate.creator,
    Number.isFinite(views)
  ].filter(Boolean).length / 5 * 100;

  const score = Math.round(
    recency * 0.25 +
    engagement * 0.20 +
    velocityScore * 0.35 +
    completeness * 0.20
  );

  return {
    score,
    components: {
      recency: round(recency),
      engagement: round(engagement),
      velocity: round(velocityScore),
      completeness: round(completeness)
    },
    evidence: {
      ageHours: ageHours === null ? null : round(ageHours),
      engagementRate: engagementRate === null ? null : round(engagementRate, 5),
      viewsPerHour: velocity === null ? null : round(velocity, 2),
      velocityMeasured: velocity !== null
    },
    confidence: velocity === null ? "low" : "medium"
  };
}

export function topicKey(title = "") {
  return title.toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .sort()
    .join(" ");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}
