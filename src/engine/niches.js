// Niche registry: niches are data, not code. Add a niche by adding an entry
// to config/niches.json (or any registry file) — the engine picks it up
// without changes. A channel references a niche by id and may override
// individual discovery/editorial settings.
import { readFile } from "node:fs/promises";

export async function loadNicheRegistry(path = "config/niches.json") {
  const parsed = JSON.parse(await readFile(path, "utf8"));
  const niches = Array.isArray(parsed) ? parsed : parsed.niches;
  if (!Array.isArray(niches) || niches.length === 0) throw new Error("Niche registry is empty");
  const map = new Map();
  for (const niche of niches) {
    if (!niche.id || map.has(niche.id)) throw new Error(`Niche registry has a missing or duplicate id: ${niche.id ?? "(missing)"}`);
    map.set(niche.id, niche);
  }
  return map;
}

export function resolveChannelNiche(channel, registry) {
  const base = registry.get(channel.niche);
  if (!base) throw new Error(`Channel ${channel.id} references unknown niche "${channel.niche}". Add it to the niche registry — no code change is needed.`);
  const overrides = channel.nicheOverrides ?? {};
  return {
    ...base,
    ...overrides,
    discovery: { ...(base.discovery ?? {}), ...(overrides.discovery ?? {}) },
    editorial: { ...(base.editorial ?? {}), ...(overrides.editorial ?? {}) },
    channelId: channel.id,
    channelName: channel.name,
    targetAudience: channel.targetAudience || base.targetAudience || ""
  };
}

export function buildDiscoveryConfig(channel, niche, env = process.env) {
  return {
    youtubeApiKey: env.YOUTUBE_DATA_API_KEY ?? "",
    searchQueries: niche.discovery?.searchQueries ?? [],
    regions: niche.discovery?.regions ?? ["US"],
    categories: niche.discovery?.categories ?? [],
    rssFeeds: niche.discovery?.rssFeeds ?? [],
    searchRegion: channel.countryCode || "US",
    searchMaxResults: 20
  };
}
