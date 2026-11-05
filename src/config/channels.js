// Multi-channel profile loading and validation.
// Safety invariants enforced here (fail-closed):
//  - channel ids are unique and URL-safe
//  - privacy defaults to "private"; public requires BOTH the channel flag
//    allowPublic=true AND the global env YOUTUBE_ALLOW_PUBLIC_PUBLISH=true
//  - publishing is disabled unless explicitly enabled per channel
//  - each channel may name its own refresh-token secret env var; the global
//    YOUTUBE_REFRESH_TOKEN is only a fallback for the first/primary channel.
import { readFile } from "node:fs/promises";

export function validateChannels(input, env = process.env) {
  const channels = Array.isArray(input) ? input : input?.channels;
  if (!Array.isArray(channels) || channels.length === 0) {
    throw new Error("Channel configuration must contain a non-empty channels array");
  }
  const seen = new Set();
  return channels.map((raw, index) => {
    const c = raw ?? {};
    const id = String(c.id ?? "");
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error(`Channel #${index + 1} has an invalid id "${id}"`);
    if (seen.has(id)) throw new Error(`Duplicate channel id "${id}"`);
    seen.add(id);
    const publishing = c.publishing ?? {};
    const requestedPrivacy = String(publishing.privacyStatus ?? "private");
    const globalPublicAllowed = String(env.YOUTUBE_ALLOW_PUBLIC_PUBLISH ?? "false") === "true";
    const privacyStatus = requestedPrivacy === "public" && publishing.allowPublic === true && globalPublicAllowed
      ? "public" : "private";
    return Object.freeze({
      id,
      name: String(c.name ?? id),
      platform: String(c.platform ?? "youtube"),
      countryCode: String(c.countryCode ?? ""),
      timezone: String(c.timezone ?? "UTC"),
      status: String(c.status ?? "setup_pending"),
      niche: String(c.niche ?? "research_pending"),
      nicheKeywords: Array.isArray(c.nicheKeywords) ? c.nicheKeywords.map(String) : [],
      refreshTokenEnv: String(c.refreshTokenEnv ?? (index === 0 ? "YOUTUBE_REFRESH_TOKEN" : "")),
      expectedChannelIdEnv: String(c.expectedChannelIdEnv ?? (index === 0 ? "YOUTUBE_EXPECTED_CHANNEL_ID" : "")),
      youtubeChannelId: String(c.youtubeChannelId ?? ""),
      targetAudience: String(c.targetAudience ?? ""),
      seedCandidateManifest: String(c.seedCandidateManifest ?? ""),
      operation: Object.freeze({
        enabled: c.operation?.enabled === true,
        paused: c.operation?.paused === true,
        postingDays: Array.isArray(c.operation?.postingDays) ? c.operation.postingDays.map(String) : [],
        postsPerDay: Math.max(0, Math.min(10, Number(c.operation?.postsPerDay ?? 1) || 0)),
        maxCandidatesPerDay: Math.max(1, Math.min(50, Number(c.operation?.maxCandidatesPerDay ?? 6) || 6)),
        productionEnabled: c.operation?.productionEnabled === true,
        publishingMode: ["disabled", "private_only", "approved_public"].includes(c.operation?.publishingMode) ? c.operation.publishingMode : "disabled"
      }),
      publishing: Object.freeze({
        enabled: publishing.enabled === true,
        privacyStatus,
        requestedPrivacyStatus: requestedPrivacy,
        publicBlocked: requestedPrivacy === "public" && privacyStatus !== "public",
        maxUploadsPerDay: Math.max(0, Math.min(20, Number(publishing.maxUploadsPerDay ?? 1) || 0)),
      }),
    });
  });
}

export async function loadChannels(path = process.env.CHANNEL_PROFILES_PATH ?? "config/channels.json", env = process.env) {
  const parsed = JSON.parse(await readFile(path, "utf8"));
  return validateChannels(parsed, env);
}
