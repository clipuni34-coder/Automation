import { assertAssetRights } from "../rights/asset-rights.js";

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function classifyBeat(text, signals = {}) {
  const normalized = String(text ?? "").toLowerCase();
  if ((Number(signals.payoff) >= 6) || /\\b(the result|in the end|finally|turns out|that means|which is why|here is what happened|here's what happened)\\b/.test(normalized)) return "payoff";
  if ((Number(signals.hook) >= 6 || Number(signals.curiosity) >= 6) || /[?]|\\b(why|how|what if|the truth|the secret|the reason)\\b/.test(normalized)) return "hook";
  if ((Number(signals.emotion) >= 6) || /\\b(but|however|instead|until|except|despite|suddenly)\\b/.test(normalized)) return "tension";
  return "context";
}

export function buildReeditPlan({ source, transcriptSegments, targetDurationSeconds = 45, platform = "youtube_shorts", minMomentScore = 0, minimumMoments = 1 } = {}) {
  if (!source?.sourceUrl || !Number.isFinite(source.durationSeconds) || source.durationSeconds <= 0) throw new Error("A source video URL and positive durationSeconds are required");
  if (!Array.isArray(transcriptSegments) || transcriptSegments.length === 0) throw new Error("Timed transcript segments are required to plan a meaningful re-edit");
  const segments = transcriptSegments.map((segment, index) => {
    const start = Number(segment.start), end = Number(segment.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > source.durationSeconds + 0.05) throw new Error("Transcript segment " + (index + 1) + " has invalid timestamps");
    const text = String(segment.text ?? "").trim();
    if (!text) throw new Error("Transcript segment " + (index + 1) + " has no text");
    const signals = segment.signals ?? {};
    const hasMediaSignals = Number.isFinite(signals.visualActivity) && Number.isFinite(signals.speechContinuity);
    const score = clamp(hasMediaSignals
      ? (Number(signals.hook) || 0) * 0.225 + (Number(signals.emotion) || 0) * 0.18 + (Number(signals.curiosity) || 0) * 0.18 + (Number(signals.payoff) || 0) * 0.18 + (Number(signals.clarity) || 0) * 0.135 + signals.visualActivity * 0.05 + signals.speechContinuity * 0.05
      : (Number(signals.hook) || 0) * 0.25 + (Number(signals.emotion) || 0) * 0.2 + (Number(signals.curiosity) || 0) * 0.2 + (Number(signals.payoff) || 0) * 0.2 + (Number(signals.clarity) || 0) * 0.15, 0, 10);
    const words = Array.isArray(segment.words) ? segment.words.map((word) => ({ word: String(word.word ?? word.text ?? "").trim(), start: Number(word.start), end: Number(word.end) })).filter((word) => word.word && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start && word.start >= start && word.end <= end + 0.05) : [];
    return { id: segment.id ?? "segment-" + (index + 1), start, end, text, words, score: Number(score.toFixed(2)), signals: { hook: Number(signals.hook) || 0, curiosity: Number(signals.curiosity) || 0, emotion: Number(signals.emotion) || 0, payoff: Number(signals.payoff) || 0, clarity: Number(signals.clarity) || 0 }, beatRole: classifyBeat(text, signals), index };
  });
  const maxDuration = clamp(Number(targetDurationSeconds) || 45, 15, 90);
  const threshold = clamp(Number(minMomentScore), 0, 10);
  const eligible = segments.filter(segment => segment.score >= threshold);
  const chronological = [...eligible].sort((a, b) => a.start - b.start || a.end - b.end);

  // Prefer a coherent source-time window over collecting isolated high scores
  // from unrelated parts of a long video. Dialogue is never reordered.
  const maxSourceSpan = maxDuration * 3;
  let bestWindow = chronological;
  let bestWindowUtility = -Infinity;
  for (let left = 0; left < chronological.length; left += 1) {
    for (let right = left; right < chronological.length; right += 1) {
      const window = chronological.slice(left, right + 1);
      const sourceSpan = window.at(-1).end - window[0].start;
      if (sourceSpan > maxSourceSpan) break;
      const rankedWindow = [...window].sort((a, b) => b.score - a.score || a.start - b.start);
      const chosen = [];
      let chosenDuration = 0;
      for (const candidate of rankedWindow) {
        const duration = candidate.end - candidate.start;
        if (chosenDuration + duration > maxDuration) continue;
        if (chosen.some(item => candidate.start < item.end && candidate.end > item.start)) continue;
        chosen.push(candidate);
        chosenDuration += duration;
      }
      if (!chosen.length) continue;
      const average = chosen.reduce((sum, item) => sum + item.score, 0) / chosen.length;
      const density = chosenDuration / Math.max(sourceSpan, 1);
      const countBonus = Math.max(0, Math.min(chosen.length - 1, 4)) * 6;
      const utility = average + density * 2 + countBonus;
      if (utility > bestWindowUtility) {
        bestWindowUtility = utility;
        bestWindow = window;
      }
    }
  }
  const ranked = [...bestWindow].sort((a, b) => b.score - a.score || a.start - b.start);
  const selected = [];
  let used = 0;
  for (const segment of ranked) {
    const length = segment.end - segment.start;
    if (used + length > maxDuration) continue;
    if (selected.some(item => segment.start < item.end && segment.end > item.start)) continue;
    selected.push(segment);
    used += length;
  }
  const averageSelectedScore = selected.length ? Number((selected.reduce((sum, item) => sum + item.score, 0) / selected.length).toFixed(2)) : 0;
  const minimumAverageScore = 3.5;
  if (selected.length < Math.max(1, Number(minimumMoments) || 1) || averageSelectedScore < minimumAverageScore) {
    const referenceOnly = source.rightsStatus === "reference_only";
    return { mode: "standalone_reedit", status: referenceOnly ? "analysis_only" : "editorial_review_required", source: { sourceUrl: source.sourceUrl, title: source.title ?? null, creator: source.creator ?? null, durationSeconds: source.durationSeconds }, platform, targetDurationSeconds: 0, rights: { allowed: false, status: referenceOnly ? "reference_only" : "not_editorially_qualified", reasons: [referenceOnly ? "Reference-only videos may be analyzed but not rendered or republished." : "Selected moments did not meet the minimum editorial quality gate (average " + averageSelectedScore.toFixed(2) + "/10; minimum " + minimumAverageScore.toFixed(1) + "/10). Do not auto-render weak material."] }, editorialQuality: { status: selected.length < Math.max(1, Number(minimumMoments) || 1) ? "insufficient_moments" : "low_average_score", minimumScore: threshold, minimumAverageScore, averageSelectedScore, eligibleMoments: eligible.length, selectedMoments: selected.length, candidateCount: segments.length }, editDecisionList: [], editorialNotes: ["This source did not contain enough strong standalone moments for an automatic short. Review the candidate list or choose a stronger source."] };
  }
  // Select by score, but never reorder the creator's dialogue: preserve the original story chronology.
  const ordered = [...selected].sort((a,b) => a.start - b.start || a.end - b.end);
  const sourceSpanSeconds = Number((ordered.at(-1).end - ordered[0].start).toFixed(2));
  const selectedDurationSeconds = Number(ordered.reduce((sum, item) => sum + item.end - item.start, 0).toFixed(2));
  const sourceContinuity = Number((selectedDurationSeconds / Math.max(sourceSpanSeconds, 1)).toFixed(3));
  const opening = ordered[0];
  const strongestMoment = [...ordered].sort((a, b) => b.score - a.score || a.start - b.start)[0];
  const hookSourceText = strongestMoment.text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/)[0];
  let hookOverlayText = hookSourceText;
  if (hookOverlayText.length > 48) {
    const teaserWords = hookOverlayText.slice(0, 48).replace(/\s+\S*$/, "").trim().split(/\s+/);
    while (teaserWords.length && /^(and|or|but|to|of|for|with|as|because|that|from|by|in|on)$/i.test(teaserWords.at(-1))) teaserWords.pop();
    hookOverlayText = teaserWords.join(" ") + "…";
  }
  // Reserve restrained punch-ins for the strongest quarter of selected moments;
  // do not manufacture motion on weak material just to make the edit look busy.
  const punchInLimit = ordered.length === 2 ? 2 : Math.max(1, Math.ceil(ordered.length * 0.25));
  const punchInMoments = new Set([...ordered]
    .sort((a, b) => b.score - a.score || a.start - b.start)
    .filter((segment, index) => index < punchInLimit && segment.score >= 5.5));
  const rights = source.rightsStatus === "reference_only" ? { allowed: false, status: "reference_only", reasons: ["Reference-only videos may be analyzed but not rendered or republished"] } : assertAssetRights(source, { platform });
  return {
    mode: "standalone_reedit", status: rights.allowed ? "edit_plan_ready" : "analysis_only",
    source: { sourceUrl: source.sourceUrl, title: source.title ?? null, creator: source.creator ?? null, durationSeconds: source.durationSeconds, rightsStatus: source.rightsStatus, rightsEvidenceUrl: source.rightsEvidenceUrl ?? null, rightsEvidenceReference: source.rightsEvidenceReference ?? null, allowedPlatforms: source.allowedPlatforms ?? [], expiresAt: source.expiresAt ?? null, license: source.license ?? "Authorized source media" },
    rights, targetDurationSeconds: used, platform, editorialQuality: { status: "qualified_for_automated_edit", minimumScore: threshold, eligibleMoments: eligible.length, selectedMoments: selected.length, candidateCount: segments.length, averageSelectedScore, sourceSpanSeconds, selectedDurationSeconds, sourceContinuity, selectionStrategy: "best_scoring_chronological_story_window", beatRoles: ordered.map(item => ({ segmentId: item.id, role: item.beatRole })), storyArcCoverage: new Set(ordered.map(item => item.beatRole)).size },
    openingHook: { segmentId: opening.id, sourceIn: opening.start, sourceOut: opening.end, score: opening.score },
    hookOverlay: { text: hookOverlayText || strongestMoment.text.slice(0, 58), segmentId: teaserMoment.id, sourceIn: teaserMoment.start, score: teaserMoment.score, durationSeconds: 2.4, method: "hook_curiosity_first_teaser_without_dialogue_reordering" },
    editDecisionList: ordered.map((segment, index) => ({ order: index + 1, segmentId: segment.id, sourceIn: segment.start, sourceOut: segment.end, durationSeconds: Number((segment.end-segment.start).toFixed(2)), caption: segment.text, score: segment.score, beatRole: segment.beatRole, wordTimings: segment.words, treatment: {
        pacing: "tight",
        captions: "word_timed_karaoke",
        punchIn: punchInMoments.has(segment),
        motionTreatment: punchInMoments.has(segment)
          ? "impact_punch_in"
          : index === ordered.length - 1
            ? "settle_pullback"
            : index % 2 === 0 ? "subtle_push" : "steady_hold",
        transition: index ? "hard_cut" : "cold_open"
      } })),
    editorialNotes: ["Preserve original dialogue chronology; do not move a later sentence ahead of its context.", "Select the strongest complete moments within one compact chronological story window; avoid unrelated highlight hopping.", "Use a curiosity-led teaser where available; avoid exposing the payoff in the opening overlay.", "Remove dead air only where meaning and context remain intact.", "Use original narration/commentary where it adds genuine explanation or critique.", "Do not imply that reframing or captions alone create permission to reuse the source."]
  };
}
