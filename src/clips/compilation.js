import { assertAssetRights } from "../rights/asset-rights.js";

export function buildCompilationPlan({ title, clips, platform = "youtube_shorts", maxClips = 10, targetDurationSeconds = 55, introCommentary, outroCommentary } = {}) {
  if (!Array.isArray(clips) || clips.length < 2) throw new Error("A compilation needs at least two candidate clips");
  if (!String(introCommentary ?? "").trim() || !String(outroCommentary ?? "").trim()) throw new Error("Original intro and outro commentary are required");
  const unique = new Map();
  for (const [index, clip] of clips.entries()) {
    if (!clip?.sourceId || !clip.sourceUrl || !Number.isFinite(clip.start) || !Number.isFinite(clip.end) || clip.start < 0 || clip.end <= clip.start) throw new Error("Clip " + (index + 1) + " needs sourceId, HTTPS sourceUrl and valid segment timestamps");
    if (unique.has(clip.sourceId + ":" + clip.start + ":" + clip.end)) continue;
    unique.set(clip.sourceId + ":" + clip.start + ":" + clip.end, clip);
  }
  const ranked = [...unique.values()].map(clip => {
    const rights = clip.rightsStatus === "reference_only" ? { allowed: false, reasons: ["Reference-only clip cannot be rendered"] } : assertAssetRights(clip, { platform });
    return { ...clip, rights, score: Number(clip.score) || 0 };
  }).filter(clip => clip.rights.allowed).sort((a,b) => b.score - a.score || a.start - b.start).slice(0, Math.max(2, Math.min(20, maxClips)));
  if (ranked.length < 2) return { mode: "viral_compilation", status: "blocked_rights", title: title ?? "Untitled compilation", rejectedCount: clips.length - ranked.length, requiredRights: "Two or more individually cleared source clips are required", clips: [] };
  let remaining = Math.max(15, Math.min(90, Number(targetDurationSeconds) || 55));
  const intro = String(introCommentary).trim(), outro = String(outroCommentary).trim();
  const entries = ranked.map((clip, index) => ({ rank: index + 1, sourceId: clip.sourceId, sourceUrl: clip.sourceUrl, creator: clip.creator ?? null, start: clip.start, end: clip.end, score: clip.score, rightsStatus: clip.rightsStatus, rightsEvidenceReference: clip.rightsEvidenceReference ?? null, commentaryPrompt: clip.editorialContext ?? "Explain why this moment earns its place and add context." }));
  return { mode: "viral_compilation", status: "compilation_plan_ready", title: title ?? "Top moments", platform, targetDurationSeconds: remaining, introCommentary: intro, outroCommentary: outro, sequence: entries, structure: ["Original hook and premise", "Ranked moments with brief original commentary/context", "Escalating sequence with strongest payoff near the end", "Original closing line and audience prompt"], rightsPolicy: "Only sequence entries with individually approved rights evidence. A plan is not permission to download or publish source media." };
}
