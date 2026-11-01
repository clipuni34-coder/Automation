const HOUR = 60 * 60 * 1000;
const MIN_BREAKOUT_VIEWS_PER_HOUR = 100;
const BREAKOUT_ACCELERATION = 2.5;

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

  const history = previousObservations
    .filter((item) => item.id === candidate.id && Date.parse(item.observedAt) < now
      && Number.isFinite(item.metrics?.views))
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const prior = history.at(-1);
  let velocity = null;
  if (prior && Number.isFinite(views)) {
    const elapsedHours = (now - Date.parse(prior.observedAt)) / HOUR;
    if (elapsedHours > 0 && elapsedHours <= 24 * 14) {
      velocity = Math.max(0, views - prior.metrics.views) / elapsedHours;
    }
  }

  let previousVelocity = null;
  if (history.length >= 2) {
    const earlier = history.at(-2);
    const intervalHours = (Date.parse(prior.observedAt) - Date.parse(earlier.observedAt)) / HOUR;
    if (intervalHours > 0 && intervalHours <= 24 * 14) {
      previousVelocity = Math.max(0, prior.metrics.views - earlier.metrics.views) / intervalHours;
    }
  }

  const accelerationRatio = velocity !== null && previousVelocity !== null
    ? velocity / Math.max(previousVelocity, 1)
    : null;
  const breakoutSignal = accelerationRatio !== null
    && velocity >= MIN_BREAKOUT_VIEWS_PER_HOUR
    && accelerationRatio >= BREAKOUT_ACCELERATION
    && ageHours !== null && ageHours <= 24 * 14;
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
    completeness * 0.20 +
    (breakoutSignal ? 10 : 0)
  );

  return {
    score: Math.min(100, score),
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
      previousViewsPerHour: previousVelocity === null ? null : round(previousVelocity, 2),
      accelerationRatio: accelerationRatio === null ? null : round(accelerationRatio, 2),
      velocityMeasured: velocity !== null,
      breakoutSignal,
      breakoutRule: `>=${MIN_BREAKOUT_VIEWS_PER_HOUR} views/hour and >=${BREAKOUT_ACCELERATION}x prior interval velocity, with 3 observations and age <=14 days`
    },
    confidence: history.length >= 2 && velocity !== null ? "high"
      : velocity !== null ? "medium" : "low"
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
