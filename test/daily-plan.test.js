import test from "node:test";
import assert from "node:assert/strict";
import { buildDailyPlan, classifyFormat } from "../src/strategy/daily-plan.js";

const candidate = (id, title, score = 80, rightsStatus = "reference_only") => ({
  id, title, sourceUrl: `https://www.youtube.com/watch?v=${id}`, platform: "youtube",
  publishedAt: "2026-10-31T12:00:00.000Z", creator: "Creator",
  metrics: { views: 100000, likes: 5000, comments: 400 },
  score, scoreComponents: { engagement: 70, velocity: 65 },
  confidence: "low", momentum: "unverified", rightsStatus
});

test("classifies broad content formats without forcing a single niche", () => {
  assert.equal(classifyFormat(candidate("a", "Roblox streamer makes impossible comeback")), "gaming_highlight");
  assert.equal(classifyFormat(candidate("b", "Top 10 unbelievable football goals")), "sports_moment");
  assert.equal(classifyFormat(candidate("c", "The funniest unexpected street prank")), "funny_or_surprising_moment");
  assert.equal(classifyFormat(candidate("d", "How the ocean creates giant waves")), "ranked_explainer");
});

test("ranks unique opportunities and clearly marks reference-only footage", () => {
  const discovery = { candidates: [
    candidate("one", "Roblox streamer makes impossible comeback"),
    candidate("two", "Roblox streamer makes impossible comeback"),
    candidate("three", "Unexpected animal rescue caught on camera", 65)
  ], runs: [{ completedAt: "2026-11-01T08:00:00.000Z" }] };
  const result = buildDailyPlan({ discovery, now: new Date("2026-11-01T09:00:00.000Z") });
  assert.equal(result.latestPlan.recommendations.length, 2);
  assert.equal(result.latestPlan.recommendations[0].candidateId, "one");
  assert.equal(result.latestPlan.recommendations[0].source.permittedUse, "research_reference_only");
  assert.match(result.latestPlan.recommendations[0].productionRoute, /rights-cleared footage/);
  assert.equal(result.latestPlan.channelProfilesUsed[0].niche, "unselected");
  assert.ok(result.latestPlan.constraints.some((line) => line.includes("not a guarantee")));
});

test("does not repeat candidates already recommended in saved plan history", () => {
  const discovery = { candidates: [candidate("one", "Funny unexpected moment")] };
  const history = { version: 1, plans: [{ recommendations: [{ candidateId: "one" }] }], outcomes: [] };
  const result = buildDailyPlan({ discovery, history, now: new Date("2026-11-01T09:00:00.000Z") });
  assert.equal(result.latestPlan.recommendations.length, 0);
});

test("routes recommendations independently to matching active channel niches", () => {
  const discovery = { candidates: [
    candidate("game", "Roblox streamer makes an impossible comeback"),
    candidate("food", "Street food chef creates a giant sandwich")
  ] };
  const channelProfiles = [
    { id: "gaming-channel", name: "Gaming", status: "active", niche: "gaming", nicheKeywords: ["roblox", "gaming"] },
    { id: "food-channel", name: "Food", status: "active", niche: "food", nicheKeywords: ["food", "chef", "recipe"] }
  ];
  const result = buildDailyPlan({ discovery, channelProfiles, now: new Date("2026-11-01T09:00:00.000Z") });
  const assigned = Object.fromEntries(result.latestPlan.recommendations.map(item => [item.candidateId, item.channelId]));
  assert.equal(assigned.game, "gaming-channel");
  assert.equal(assigned.food, "food-channel");
  assert.equal(result.latestPlan.channelProfilesUsed.length, 2);
});
