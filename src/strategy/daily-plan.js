import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const DAY = 86400000;
const EMPTY = { version: 1, plans: [], outcomes: [] };

export function classifyFormat(candidate) {
  const text = `${candidate.title ?? ""} ${candidate.description ?? ""}`.toLowerCase();
  const rules = [
    ["gaming_highlight", /roblox|minecraft|fortnite|gameplay|gaming|streamer|twitch|speedrun|gamer/],
    ["creator_moment", /ishowspeed|mrbeast|streamer|podcast|interview|reaction|creator|influencer/],
    ["sports_moment", /football|soccer|nba|basketball|ufc|boxing|tennis|goal|match|athlete|sports/],
    ["food_discovery", /food|recipe|cooking|chef|restaurant|street food|taste test/],
    ["ranked_explainer", /top \d+|ranking|best .* ever|worst .* ever|facts|history|science|explained|how /],
    ["funny_or_surprising_moment", /funny|hilarious|unexpected|surprising|caught on camera|fail|prank|wild moment/]
  ];
  return rules.find(([, pattern]) => pattern.test(text))?.[0] ?? "story_or_topic_explainer";
}

function freshness(candidate, now) {
  const published = Date.parse(candidate.publishedAt ?? "");
  if (!Number.isFinite(published)) return 25;
  const ageDays = Math.max(0, (now - published) / DAY);
  return Math.max(0, Math.round(100 - ageDays * 4));
}

function confidenceValue(candidate) {
  return candidate.confidence === "high" ? 1 : candidate.confidence === "medium" ? 0.65 : 0.35;
}

function opportunity(candidate, now) {
  const components = candidate.scoreComponents ?? {};
  const score = Number.isFinite(candidate.score) ? candidate.score : 0;
  const freshnessScore = freshness(candidate, now);
  const engagement = Number.isFinite(components.engagement) ? components.engagement : 25;
  const velocity = Number.isFinite(components.velocity) ? components.velocity : 20;
  const confidence = confidenceValue(candidate);
  const total = Math.round(score * 0.55 + freshnessScore * 0.15 + engagement * 0.10 + velocity * 0.10 + confidence * 10);
  return { score: Math.min(100, total), components: { discovery: score, freshness: freshnessScore, engagement, velocity, confidence: candidate.confidence ?? "low" } };
}

function angleFor(candidate, format) {
  const title = String(candidate.title ?? "").replace(/\s+/g, " ").trim();
  const templates = {
    gaming_highlight: `The moment that changed this game: ${title}`,
    creator_moment: `The context behind this creator moment: ${title}`,
    sports_moment: `Why this moment matters: ${title}`,
    food_discovery: `What makes this food moment worth watching: ${title}`,
    ranked_explainer: `The detail most people miss about: ${title}`,
    funny_or_surprising_moment: `The setup, the unexpected moment, and the payoff: ${title}`,
    story_or_topic_explainer: `The most interesting question behind: ${title}`
  };
  return templates[format];
}

function safeSource(candidate) {
  return {
    platform: candidate.platform ?? "unknown",
    url: candidate.sourceUrl,
    creator: candidate.creator ?? null,
    publishedAt: candidate.publishedAt ?? null,
    observedMetrics: candidate.metrics ?? {},
    rightsStatus: candidate.rightsStatus ?? "reference_only",
    permittedUse: candidate.rightsStatus === "owned_by_user" || candidate.rightsStatus === "licensed" || candidate.rightsStatus === "permission_granted" || candidate.rightsStatus === "public_domain"
      ? "eligible_for_rights_review"
      : "research_reference_only"
  };
}

export function buildDailyPlan({ discovery, history = EMPTY, now = new Date(), channelProfiles = [] }) {
  const timestamp = now instanceof Date ? now : new Date(now);
  const nowMs = timestamp.getTime();
  const candidates = (discovery?.candidates ?? [])
    .filter((item) => item?.id && item?.title && item?.sourceUrl)
    .map((candidate) => {
      const format = classifyFormat(candidate);
      const ranked = opportunity(candidate, nowMs);
      return { candidate, format, ...ranked };
    })
    .sort((a, b) => b.score - a.score);

  const seenTopics = new Set();
  const rankedUnique = candidates.filter(({ candidate }) => {
    const key = candidate.topicKey || candidate.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seenTopics.has(key)) return false;
    seenTopics.add(key);
    return true;
  });

  const priorIds = new Set((history.plans ?? []).flatMap((plan) => plan.recommendations ?? []).map((item) => item.candidateId));
  const eligible = rankedUnique.filter(({ candidate }) => !priorIds.has(candidate.id));
  const channel = channelProfiles[0] ?? {
    id: "channel-lab",
    name: "Channel research lab",
    niche: "unselected",
    status: "exploration",
    note: "Temporary research bucket; niche selection is intentionally deferred until evidence is collected."
  };

  const recommendations = eligible.slice(0, 5).map(({ candidate, format, score, components }, index) => ({
    rank: index + 1,
    candidateId: candidate.id,
    title: candidate.title,
    format,
    opportunityScore: score,
    scoreBreakdown: components,
    confidence: candidate.confidence ?? "low",
    momentum: candidate.momentum ?? "unverified",
    whySelected: [
      `Discovery opportunity score: ${components.discovery}/100.`,
      components.confidence === "high" ? "Repeated observations support a stronger momentum estimate." : "Momentum confidence is limited; collect another observation before treating this as a breakout.",
      candidate.evidence?.breakoutSignal ? "Observed view acceleration meets the current breakout heuristic." : "No confirmed breakout acceleration is claimed."
    ],
    creativeAngle: angleFor(candidate, format),
    productionRoute: "Create an original, transformative treatment using owned or rights-cleared footage; use this source as research/reference only unless separate reuse rights are verified.",
    source: safeSource(candidate),
    channelId: channel.id,
    status: "research_recommended"
  }));

  const plan = {
    id: `daily-${timestamp.toISOString().slice(0, 10)}`,
    generatedAt: timestamp.toISOString(),
    timezone: "UTC",
    channelProfilesUsed: channelProfiles.length ? channelProfiles : [channel],
    discoveryRunAt: discovery?.runs?.at(-1)?.completedAt ?? null,
    coverage: {
      candidateCount: candidates.length,
      uniqueTopicCount: rankedUnique.length,
      recommendations: recommendations.length,
      sourcePlatforms: [...new Set(candidates.map(({ candidate }) => candidate.platform ?? "unknown"))]
    },
    recommendations,
    backlog: eligible.slice(5, 15).map(({ candidate, format, score }) => ({
      candidateId: candidate.id, title: candidate.title, format, opportunityScore: score,
      sourceUrl: candidate.sourceUrl, rightsStatus: candidate.rightsStatus ?? "reference_only"
    })),
    constraints: [
      "This is a ranked editorial opportunity list, not a guarantee of views or virality.",
      "A public source URL or attribution does not grant permission to download, edit or republish the source footage.",
      "Trend acceleration requires repeated observations; first-seen candidates remain low confidence.",
      "No channel niche is permanently selected by this exploration-stage plan."
    ]
  };

  return { ...history, version: 1, plans: [...(history.plans ?? []), plan].slice(-90), outcomes: history.outcomes ?? [], latestPlan: plan };
}

export async function readStrategyHistory(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    return { ...EMPTY, ...parsed, plans: Array.isArray(parsed.plans) ? parsed.plans : [], outcomes: Array.isArray(parsed.outcomes) ? parsed.outcomes : [] };
  } catch (error) {
    if (error.code === "ENOENT") return structuredClone(EMPTY);
    throw error;
  }
}

export async function writeStrategyHistory(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(temp, filePath);
}
