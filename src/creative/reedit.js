import { assertAssetRights } from "../rights/asset-rights.js";

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

export function buildReeditPlan({ source, transcriptSegments, targetDurationSeconds = 45, platform = "youtube_shorts" } = {}) {
  if (!source?.sourceUrl || !Number.isFinite(source.durationSeconds) || source.durationSeconds <= 0) throw new Error("A source video URL and positive durationSeconds are required");
  if (!Array.isArray(transcriptSegments) || transcriptSegments.length === 0) throw new Error("Timed transcript segments are required to plan a meaningful re-edit");
  const segments = transcriptSegments.map((segment, index) => {
    const start = Number(segment.start), end = Number(segment.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > source.durationSeconds + 0.05) throw new Error("Transcript segment " + (index + 1) + " has invalid timestamps");
    const text = String(segment.text ?? "").trim();
    if (!text) throw new Error("Transcript segment " + (index + 1) + " has no text");
    const signals = segment.signals ?? {};
    const score = clamp((Number(signals.hook) || 0) * 0.25 + (Number(signals.emotion) || 0) * 0.2 + (Number(signals.curiosity) || 0) * 0.2 + (Number(signals.payoff) || 0) * 0.2 + (Number(signals.clarity) || 0) * 0.15, 0, 10);
    return { id: segment.id ?? "segment-" + (index + 1), start, end, text, score: Number(score.toFixed(2)), index };
  });
  const maxDuration = clamp(Number(targetDurationSeconds) || 45, 15, 90);
  const ranked = [...segments].sort((a,b) => b.score - a.score || a.start - b.start);
  const selected = [];
  let used = 0;
  for (const segment of ranked) {
    const length = segment.end - segment.start;
    if (used + length > maxDuration) continue;
    if (selected.some(item => segment.start < item.end && segment.end > item.start)) continue;
    selected.push(segment); used += length;
  }
  if (!selected.length) throw new Error("No transcript segments fit the requested re-edit duration");
  selected.sort((a,b) => a.start - b.start);
  const rights = source.rightsStatus === "reference_only" ? { allowed: false, status: "reference_only", reasons: ["Reference-only videos may be analyzed but not rendered or republished"] } : assertAssetRights(source, { platform });
  return {
    mode: "standalone_reedit", status: rights.allowed ? "edit_plan_ready" : "analysis_only",
    source: { sourceUrl: source.sourceUrl, title: source.title ?? null, creator: source.creator ?? null, durationSeconds: source.durationSeconds },
    rights, targetDurationSeconds: used, platform,
    editDecisionList: selected.map((segment, index) => ({ order: index + 1, segmentId: segment.id, sourceIn: segment.start, sourceOut: segment.end, durationSeconds: Number((segment.end-segment.start).toFixed(2)), caption: segment.text, score: segment.score, treatment: { pacing: "tight", captions: "kinetic_emphasis", punchIn: segment.score >= 7, transition: index ? "hard_cut" : "cold_open" } })),
    editorialNotes: ["Open on the strongest complete thought; do not misrepresent the original context.", "Remove dead air only where meaning and context remain intact.", "Use original narration/commentary where it adds genuine explanation or critique.", "Do not imply that reframing or captions alone create permission to reuse the source."]
  };
}
