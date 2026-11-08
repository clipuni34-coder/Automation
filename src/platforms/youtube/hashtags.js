// Visible YouTube hashtags belong in the title or description, not merely
// in snippet.tags (which is a separate, generally invisible metadata field).
// Keep these few, topical and idempotent; never truncate existing attribution.
const VALID_TAG = /^[\p{L}\p{N}_]+$/u;
export const MAX_VISIBLE_HASHTAGS = 5;
export const MAX_DESCRIPTION_BYTES = 5000;

export function normalizeHashtags(values) {
  if (!Array.isArray(values)) return [];
  const result = [];
  const seen = new Set();
  for (const item of values) {
    if (typeof item !== "string") continue;
    const cleaned = item.normalize("NFKC").trim().replace(/^#+/, "");
    if (!cleaned || !VALID_TAG.test(cleaned)) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(`#${cleaned}`);
    if (result.length >= MAX_VISIBLE_HASHTAGS) break;
  }
  return result;
}

export function appendVisibleHashtags(description, values) {
  const base = String(description ?? "");
  if (Buffer.byteLength(base, "utf8") > MAX_DESCRIPTION_BYTES) {
    throw new Error("YouTube description already exceeds 5,000 UTF-8 bytes; refusing to truncate existing content or credits.");
  }
  const existing = new Set();
  for (const match of base.matchAll(/(?:^|\s)#([\p{L}\p{N}_]+)/gu)) existing.add(match[1].normalize("NFKC").toLowerCase());
  const valid = normalizeHashtags(values);
  const missing = valid.filter((tag) => !existing.has(tag.slice(1).toLowerCase()));
  const added = missing.slice(0, Math.max(0, MAX_VISIBLE_HASHTAGS - existing.size));
  if (!added.length) return { description: base, added: [], reason: missing.length ? "existing_hashtag_limit" : "already_present_or_none" };
  const updated = `${base}${base ? "\n\n" : ""}${added.join(" ")}`;
  if (Buffer.byteLength(updated, "utf8") > MAX_DESCRIPTION_BYTES) {
    throw new Error("Visible hashtags would exceed YouTube's 5,000-byte description limit; refusing to truncate existing content or credits.");
  }
  return { description: updated, added, reason: null };
}
