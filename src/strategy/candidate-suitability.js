import { isIP } from "node:net";

const EXCLUDED_TITLE = [
  /\bfull\s+(?:match|game|episode|movie|album|concert|song|livestream|live stream)\b/i,
  /\bcomplete\s+(?:match|game|episode|movie|concert)\b/i,
  /\bjuego\s+completo\b/i,
  /\blive\s+now\b/i,
  /\b24\s*\/\s*7\b/i,
  /\bofficial\s+(?:music\s+)?video\b/i,
  /\b(?:fan|character|movie|tv|scene)\s+edit\b/i,
  /\bfull\s+replay\b/i,
  /\bhighlights?\s+compilation\b/i
];

function isSafeHttpsReference(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password &&
      Boolean(host) && !isIP(host) && host !== "localhost" &&
      !host.endsWith(".localhost") && !host.endsWith(".local") &&
      !host.endsWith(".internal");
  } catch {
    return false;
  }
}

export function assessCandidateSuitability(candidate = {}) {
  const title = String(candidate.title ?? "");
  const reasons = [];
  for (const pattern of EXCLUDED_TITLE) {
    if (pattern.test(title)) reasons.push("likely_complete_broadcast_or_existing_copyrighted_entertainment_upload");
  }
  if (candidate.platform && candidate.platform !== "youtube" && candidate.platform !== "rss") {
    reasons.push("unsupported_discovery_platform");
  }
  if (!isSafeHttpsReference(candidate.sourceUrl)) {
    reasons.push("missing_safe_reference_url");
  }
  if (!title.trim()) reasons.push("missing_title");
  return {
    eligible: reasons.length === 0,
    reasons: [...new Set(reasons)],
    policy: "Reference videos are research leads only. Eligibility does not grant rights to reuse their media."
  };
}
