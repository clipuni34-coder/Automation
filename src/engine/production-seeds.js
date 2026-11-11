// Primeplug's current production manifest: configured seeds plus independently
// recorded planning decisions from this channel only. This function does not
// approve, render or publish anything.
import { sameSourceUrl } from "./source-identity.js";
import { materializeReviewedBootstrap, reviewedPlanningSeeds } from "./planning-inbox.js";

export async function mergeReviewedProductionSeeds({ channel, configured, state, bootstrapPath = null } = {}) {
  if (!Array.isArray(configured)) throw new Error("Seed manifest is not an array.");
  const seeds = [...configured];
  if (channel?.id !== "Primeplug") return { seeds, invalid: [], materialized: 0 };
  if (!state || state.channelId !== channel.id) throw new Error("Planning state does not match the requested channel.");
  const materialized = await materializeReviewedBootstrap(state, { bootstrapPath });
  const planning = await reviewedPlanningSeeds(state, { bootstrapPath });
  const invalid = [...planning.invalid];
  for (const seed of planning.seeds) {
    if (seeds.some((existing) => existing.id === seed.id || sameSourceUrl(existing.sourceUrl, seed.sourceUrl))) {
      invalid.push({ key: seed.id, reasons: ["Reviewed candidate overlaps a configured source or id."] });
      continue;
    }
    seeds.push(seed);
  }
  return { seeds, invalid, materialized: materialized.added };
}
