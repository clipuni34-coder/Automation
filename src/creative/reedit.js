import { assertAssetRights } from "../rights/asset-rights.js";
import { analyzeContextualStory } from "./contextual-story.js";

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function extractHookTeaser(text) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const cue = /\b(about to turn blue|can't breathe|cannot breathe|running out of air|running out of oxygen|wait until you see|you won't believe|the surprising part|what happens next|what happened next)\b/i.exec(normalized);
  if (cue) {
    const words = normalized.split(/\s+/);
    const cueWords = cue[0].split(/\s+/).length;
    const cueIndex = normalized.slice(0, cue.index).trim().split(/\s+/).filter(Boolean).length;
    const start = Math.max(0, cueIndex - 5);
    return words.slice(start, Math.min(words.length, cueIndex + cueWords + 2)).join(" ");
  }
  const sentence = normalized.split(/(?<=[.!?])\s+/)[0];
  return sentence;
}

function classifyBeat(text, signals = {}) {
  const normalized = String(text ?? "").toLowerCase();
  const payoffPhrase = /\b(the result is|the result was|in the end|finally|it turned out|turns out|that means|which is why|here is what happened|here's what happened|what happened next|the answer is|the answer was|the solution is|the solution was|managed to|made it out|escaped|survived|was rescued|found a way|reached the other side|solved the problem|got away)\b/.test(normalized);
  const hookPhrase = /[?]|^\s*(why|how|what if|what happens if)\b|\b(here is why|here's why|the truth is|the secret is|the reason is)\b/.test(normalized);
  const obstaclePhrase = /\b(collapsed|snapped|ran out|couldn't|could not|failed|trapped|stranded|in danger|at risk|blocked|broke down|stuck|threatened|injured|nearly drowned|almost died)\b/.test(normalized);
  const tensionPhrase = obstaclePhrase || (/\b(but|however|instead|until|except|despite|suddenly|unexpectedly)\b/.test(normalized) && /\b(problem|danger|wrong|risk|loss|failure|obstacle|crisis)\b/.test(normalized));
  const explanatoryWhy = /^\s*(that is why|that's why|this is why)\b/.test(normalized);
  const hook = Number(signals.hook) || 0;
  const curiosity = Number(signals.curiosity) || 0;
  const payoff = Number(signals.payoff) || 0;
  const emotion = Number(signals.emotion) || 0;
  // Absolute lexical scores are noisy. Require a clear textual cue or a
  // meaningful lead over competing beat signals before assigning a role.
  if (payoffPhrase || (payoff >= 7 && payoff >= hook + 2 && payoff >= curiosity + 2)) return "payoff";
  if (hookPhrase || (!explanatoryWhy && (hook >= 8 || curiosity >= 8) && Math.max(hook, curiosity) >= payoff + 3)) return "hook";
  if (tensionPhrase || (emotion >= 8 && emotion >= payoff + 3 && /\b(fear|afraid|danger|trapped|panic|terrified|crash|crisis)\b/.test(normalized))) return "tension";
  return "context";
}

function selectTightSemanticWindow(windowSegments, semanticWindow, transitions, maxDuration, maxSourceSpan) {
  const hookIndex = windowSegments.findIndex(item => item.id === semanticWindow.hookSegmentId);
  const payoffIndex = windowSegments.findIndex(item => item.id === semanticWindow.payoffSegmentId);
  if (hookIndex < 0 || payoffIndex <= hookIndex) return { segments: windowSegments, trimmed: false, reason: "invalid_hook_payoff_bounds" };
  const transitionByPair = new Map((transitions ?? []).map(item => [item.fromSegmentId + "->" + item.toSegmentId, item]));
  let best = null;
  for (let left = 0; left <= hookIndex; left += 1) {
    for (let right = payoffIndex; right < windowSegments.length; right += 1) {
      const candidate = windowSegments.slice(left, right + 1);
      if (candidate.length < 3) continue;
      const duration = candidate.reduce((sum, item) => sum + item.end - item.start, 0);
      const sourceSpan = candidate.at(-1).end - candidate[0].start;
      if (duration > maxDuration || sourceSpan > maxSourceSpan) continue;
      const path = candidate.slice(0, -1).map((item, index) => transitionByPair.get(item.id + "->" + candidate[index + 1].id));
      if (path.some(item => !item || item.relationship !== "connected" || item.evidenceValidated !== true || Number(item.confidence) < 0.7)) continue;
      const averageScore = candidate.reduce((sum, item) => sum + item.score, 0) / candidate.length;
      const roles = new Set(candidate.map(item => item.semanticAssessment?.role).filter(Boolean));
      const storyCoverage = ["setup", "tension"].filter(role => roles.has(role)).length;
      const durationFit = Math.min(duration / 24, 1);
      const utility = averageScore + storyCoverage * 0.2 + durationFit * 0.1;
      if (!best || utility > best.utility || (utility === best.utility && candidate.length < best.segments.length)) {
        best = { segments: candidate, utility, averageScore, duration, storyCoverage };
      }
    }
  }
  if (!best) return { segments: [], trimmed: false, reason: "no_connected_hook_to_payoff_subwindow" };
  return {
    segments: best.segments,
    trimmed: best.segments.length < windowSegments.length,
    originalSegmentIds: windowSegments.map(item => item.id),
    selectedSegmentIds: best.segments.map(item => item.id),
    averageScore: Number(best.averageScore.toFixed(2)),
    durationSeconds: Number(best.duration.toFixed(2)),
    sourceSpanSeconds: Number((best.segments.at(-1).end - best.segments[0].start).toFixed(2)),
    setupOrTensionRoles: best.storyCoverage,
    method: "highest_quality_connected_contiguous_hook_to_payoff_subwindow"
  };
}

function selectConnectedSemanticExcerpt(segments, semanticWindow, transitions, maxDuration, maxSourceSpan) {
  if (!Array.isArray(segments) || !Array.isArray(transitions) || !transitions.length) return null;
  const ordered = [...segments].sort((a, b) => a.index - b.index || a.start - b.start);
  const transitionByPair = new Map(transitions.map(item => [item.fromSegmentId + "->" + item.toSegmentId, item]));
  const candidates = [];
  for (let left = 0; left < ordered.length; left += 1) {
    for (let right = left + 1; right < Math.min(ordered.length, left + 5); right += 1) {
      const excerpt = ordered.slice(left, right + 1);
      if (!excerpt.every((item, index) => index === 0 || item.index === excerpt[index - 1].index + 1)) continue;
      const roles = excerpt.map(item => item.semanticAssessment?.role);
      const hasPayoff = roles.includes("payoff");
      const hasSupportingBeat = roles.some(role => ["context", "setup", "tension", "hook", "emotion"].includes(role));
      if (!hasPayoff || !hasSupportingBeat) continue;
      if (excerpt.some(item => !item.semanticAssessment?.evidenceValidated
        || Number(item.semanticAssessment.confidence) < 0.8
        || Number(item.semanticAssessment.compellingScore) < 6)) continue;
      const path = excerpt.slice(0, -1).map((item, index) => transitionByPair.get(item.id + "->" + excerpt[index + 1].id));
      if (path.some(item => !item || item.relationship !== "connected" || item.evidenceValidated !== true || Number(item.confidence) < 0.85)) continue;
      const duration = excerpt.reduce((sum, item) => sum + item.end - item.start, 0);
      const sourceSpan = excerpt.at(-1).end - excerpt[0].start;
      const averageScore = excerpt.reduce((sum, item) => sum + item.score, 0) / excerpt.length;
      if (duration > maxDuration || sourceSpan > maxSourceSpan || averageScore < 5.5) continue;
      const confidence = Math.min(
        ...excerpt.map(item => Number(item.semanticAssessment.confidence)),
        ...path.map(item => Number(item.confidence))
      );
      const roleCoverageBonus = new Set(roles.filter(role => ["context", "setup", "tension", "hook", "payoff"].includes(role))).size * 0.25;
      const lengthBonus = (excerpt.length - 2) * 0.25;
      const utility = averageScore + roleCoverageBonus + lengthBonus - sourceSpan * 0.001;
      candidates.push({
        segments: excerpt,
        averageScore: Number(averageScore.toFixed(2)),
        durationSeconds: Number(duration.toFixed(2)),
        sourceSpanSeconds: Number(sourceSpan.toFixed(2)),
        selectedSegmentIds: excerpt.map(item => item.id),
        confidence: Number(confidence.toFixed(2)),
        modelWindowArcStatus: semanticWindow?.arcStatus ?? "not_provided",
        modelWindowConfidence: semanticWindow?.confidence ?? null,
        summary: excerpt.map(item => item.text).join(" ").replace(/\s+/g, " ").trim().slice(0, 500),
        method: "quote_validated_connected_excerpt",
        limitation: "This is a connected excerpt from the larger source, not a claim that the full story arc is present.",
        utility
      });
    }
  }
  return candidates.sort((a, b) => b.utility - a.utility || a.sourceSpanSeconds - b.sourceSpanSeconds)[0] ?? null;
}

function summarizeNarrativeStructure(segments) {
  const roles = ["hook", "tension", "payoff"];
  const evidence = roles.map(role => {
    const match = segments.find(segment => segment.beatRole === role);
    return match ? { role, segmentId: match.id, text: match.text.slice(0, 180) } : null;
  }).filter(Boolean);
  const indexes = evidence.map(item => segments.findIndex(segment => segment.id === item.segmentId));
  const ordered = indexes.length >= 2 && indexes.every((value, index) => index === 0 || value > indexes[index - 1]);
  const complete = evidence.length === 3 && ordered;
  return {
    status: complete ? "ordered_arc_detected" : evidence.length >= 2 && ordered ? "partial_arc_detected" : "no_ordered_arc_detected",
    sequence: evidence.map(item => item.role),
    evidence,
    method: "conservative_lexical_sequence_heuristic",
    limitation: "Beat labels are text-cue estimates, not verified semantic understanding or proof that the story is compelling."
  };
}

export function buildReeditPlan({ source, transcriptSegments, targetDurationSeconds = 45, platform = "youtube_shorts", minMomentScore = 0, minimumMoments = 1, narrativeSemanticAnalysis = null } = {}) {
  if (!source?.sourceUrl || !Number.isFinite(source.durationSeconds) || source.durationSeconds <= 0) throw new Error("A source video URL and positive durationSeconds are required");
  if (!Array.isArray(transcriptSegments) || transcriptSegments.length === 0) throw new Error("Timed transcript segments are required to plan a meaningful re-edit");
  const semanticMomentById = new Map((narrativeSemanticAnalysis?.momentAssessments ?? []).map(item => [String(item.segmentId), item]));
  const segments = transcriptSegments.map((segment, index) => {
    const start = Number(segment.start), end = Number(segment.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > source.durationSeconds + 0.05) throw new Error("Transcript segment " + (index + 1) + " has invalid timestamps");
    const text = String(segment.text ?? "").trim();
    if (!text) throw new Error("Transcript segment " + (index + 1) + " has no text");
    const signals = segment.signals ?? {};
    const hasMediaSignals = Number.isFinite(signals.visualActivity) && Number.isFinite(signals.speechContinuity);
    const heuristicScore = clamp(hasMediaSignals
      ? (Number(signals.hook) || 0) * 0.225 + (Number(signals.emotion) || 0) * 0.18 + (Number(signals.curiosity) || 0) * 0.18 + (Number(signals.payoff) || 0) * 0.18 + (Number(signals.clarity) || 0) * 0.135 + signals.visualActivity * 0.05 + signals.speechContinuity * 0.05
      : (Number(signals.hook) || 0) * 0.25 + (Number(signals.emotion) || 0) * 0.2 + (Number(signals.curiosity) || 0) * 0.2 + (Number(signals.payoff) || 0) * 0.2 + (Number(signals.clarity) || 0) * 0.15, 0, 10);
    const semanticAssessment = semanticMomentById.get(String(segment.id ?? "segment-" + (index + 1))) ?? null;
    const semanticScoreTrusted = semanticAssessment && semanticAssessment.evidenceValidated === true && Number(semanticAssessment.confidence) >= 0.7;
    const semanticWeight = semanticScoreTrusted && Number(semanticAssessment.confidence) >= 0.8 ? 0.7 : 0.6;
    const score = clamp(semanticScoreTrusted ? heuristicScore * (1 - semanticWeight) + Number(semanticAssessment.compellingScore) * semanticWeight : heuristicScore, 0, 10);
    const words = Array.isArray(segment.words) ? segment.words.map((word) => ({ word: String(word.word ?? word.text ?? "").trim(), start: Number(word.start), end: Number(word.end) })).filter((word) => word.word && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start && word.start >= start && word.end <= end + 0.05) : [];
    return { id: segment.id ?? "segment-" + (index + 1), start, end, text, words, score: Number(score.toFixed(2)), heuristicScore: Number(heuristicScore.toFixed(2)), semanticAssessment: semanticAssessment ? { compellingScore: semanticAssessment.compellingScore, confidence: semanticAssessment.confidence, role: semanticAssessment.role, selfContained: semanticAssessment.selfContained, evidenceValidated: semanticAssessment.evidenceValidated === true, rationale: semanticAssessment.rationale } : null, signals: { hook: Number(signals.hook) || 0, curiosity: Number(signals.curiosity) || 0, emotion: Number(signals.emotion) || 0, payoff: Number(signals.payoff) || 0, clarity: Number(signals.clarity) || 0 }, beatRole: semanticAssessment && Number(semanticAssessment.confidence) >= 0.75 ? semanticAssessment.role : classifyBeat(text, signals), index };
  });
  const maxDuration = clamp(Number(targetDurationSeconds) || 45, 15, 90);
  const threshold = clamp(Number(minMomentScore), 0, 10);
  const eligible = segments.filter(segment => segment.score >= threshold);
  const chronological = [...eligible].sort((a, b) => a.start - b.start || a.end - b.end);

  // Prefer a coherent source-time window over collecting isolated high scores
  // from unrelated parts of a long video. Dialogue is never reordered.
  const maxSourceSpan = maxDuration * 3;
  const semanticWindow = narrativeSemanticAnalysis?.storyWindow;
  const semanticWindowSegments = Array.isArray(semanticWindow?.segmentIds)
    ? semanticWindow.segmentIds.map(id => segments.find(segment => segment.id === id)).filter(Boolean)
    : [];
  const semanticWindowSourceSpan = semanticWindowSegments.length
    ? semanticWindowSegments.at(-1).end - semanticWindowSegments[0].start : Infinity;
  const semanticWindowStructureQualified = semanticWindow?.evidenceValidated === true
    && semanticWindow.arcStatus === "complete"
    && Number(semanticWindow.confidence) >= 0.75
    && semanticWindowSegments.length === semanticWindow.segmentIds.length
    && semanticWindowSegments.length >= 3
    && semanticWindowSegments.every((item, index) => index === 0 || item.index === semanticWindowSegments[index - 1].index + 1)
    && semanticWindowSegments.some(item => item.id === semanticWindow.hookSegmentId)
    && semanticWindowSegments.some(item => item.id === semanticWindow.payoffSegmentId)
    && semanticWindowSegments.findIndex(item => item.id === semanticWindow.hookSegmentId) < semanticWindowSegments.findIndex(item => item.id === semanticWindow.payoffSegmentId)
    && semanticWindowSourceSpan <= maxSourceSpan;
  const semanticWindowTrim = semanticWindowStructureQualified
    ? selectTightSemanticWindow(semanticWindowSegments, semanticWindow, narrativeSemanticAnalysis?.transitions, maxDuration, maxSourceSpan)
    : null;
  const semanticWindowQualified = semanticWindowStructureQualified
    && semanticWindowTrim?.segments?.length >= 3
    && Number(semanticWindowTrim.durationSeconds) <= maxDuration
    && Number(semanticWindowTrim.sourceSpanSeconds) <= maxSourceSpan;
  const semanticConnectedExcerpt = !semanticWindowQualified
    ? selectConnectedSemanticExcerpt(segments, semanticWindow, narrativeSemanticAnalysis?.transitions, maxDuration, maxSourceSpan)
    : null;
  const semanticConnectedExcerptQualified = Boolean(semanticConnectedExcerpt);
  const semanticSelectionQualified = semanticWindowQualified || semanticConnectedExcerptQualified;
  let bestWindow = semanticWindowQualified ? semanticWindowTrim.segments : semanticConnectedExcerptQualified ? semanticConnectedExcerpt.segments : chronological;
  let bestWindowUtility = semanticSelectionQualified ? Number(semanticWindow.confidence) * 100 : -Infinity;
  if (!semanticSelectionQualified) for (let left = 0; left < chronological.length; left += 1) {
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
  const selected = semanticSelectionQualified ? [...bestWindow] : [];
  let used = selected.reduce((sum, item) => sum + item.end - item.start, 0);
  if (!semanticSelectionQualified) for (const segment of ranked) {
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
    const topCandidates = [...segments]
      .sort((a, b) => b.score - a.score || a.start - b.start)
      .slice(0, 5)
      .map(segment => ({
        segmentId: segment.id,
        sourceIn: Number(segment.start.toFixed(2)),
        sourceOut: Number(segment.end.toFixed(2)),
        score: segment.score,
        beatRole: segment.beatRole,
        text: segment.text.slice(0, 240),
        signalScores: { ...segment.signals },
        weakSignals: Object.entries(segment.signals)
          .filter(([, value]) => Number(value) < 5)
          .map(([name]) => name)
      }));
    return { mode: "standalone_reedit", status: referenceOnly ? "analysis_only" : "editorial_review_required", source: { sourceUrl: source.sourceUrl, title: source.title ?? null, creator: source.creator ?? null, durationSeconds: source.durationSeconds, excerptStartSeconds: Number(source.excerptStartSeconds) || 0 }, platform, targetDurationSeconds: 0, rights: { allowed: false, status: referenceOnly ? "reference_only" : "not_editorially_qualified", reasons: [referenceOnly ? "Reference-only videos may be analyzed but not rendered or republished." : "Selected moments did not meet the minimum editorial quality gate (average " + averageSelectedScore.toFixed(2) + "/10; minimum " + minimumAverageScore.toFixed(1) + "/10). Do not auto-render weak material."] }, editorialQuality: { status: selected.length < Math.max(1, Number(minimumMoments) || 1) ? "insufficient_moments" : "low_average_score", minimumScore: threshold, minimumAverageScore, averageSelectedScore, eligibleMoments: eligible.length, selectedMoments: selected.length, candidateCount: segments.length, candidateDiagnostics: { method: "top_five_heuristic_candidate_score_breakdown", topCandidates, limitation: "These are transcript and FFmpeg-derived heuristic signals, not semantic understanding or visual-content verification." } }, editDecisionList: [], editorialNotes: ["This source did not contain enough strong standalone moments for an automatic short. Review the top candidate evidence and signal breakdown, or choose a stronger source."] };
  }
  // Select by score, but never reorder the creator's dialogue: preserve the original story chronology.
  const ordered = [...selected].sort((a,b) => a.start - b.start || a.end - b.end);
  const sourceSpanSeconds = Number((ordered.at(-1).end - ordered[0].start).toFixed(2));
  const selectedDurationSeconds = Number(ordered.reduce((sum, item) => sum + item.end - item.start, 0).toFixed(2));
  const sourceContinuity = Number((selectedDurationSeconds / Math.max(sourceSpanSeconds, 1)).toFixed(3));
  const contextualStoryAnalysis = analyzeContextualStory(ordered);
  const narrativeStructure = summarizeNarrativeStructure(ordered);
  narrativeStructure.contextualContinuity = contextualStoryAnalysis;
  const beatIndexes = narrativeStructure.evidence
    .map(item => ordered.findIndex(segment => segment.id === item.segmentId))
    .filter(index => index >= 0);
  const firstBeatIndex = beatIndexes.length ? Math.min(...beatIndexes) : -1;
  const lastBeatIndex = beatIndexes.length ? Math.max(...beatIndexes) : -1;
  const arcTransitions = firstBeatIndex >= 0
    ? contextualStoryAnalysis.transitions.slice(firstBeatIndex, lastBeatIndex)
    : [];
  const contextuallyConnected = beatIndexes.length >= 2
    && arcTransitions.length === lastBeatIndex - firstBeatIndex
    && arcTransitions.every(transition => transition.linked);
  narrativeStructure.semanticContextAnalysis = narrativeSemanticAnalysis ?? { status: "not_configured", qualified: false, method: "semantic_provider_not_configured" };
narrativeStructure.semanticStoryWindow = semanticWindowQualified ? { ...semanticWindow, qualified: true } : semanticConnectedExcerptQualified ? { ...semanticWindow, arcStatus: "partial", qualified: true, selectionType: "connected_excerpt", modelArcStatus: semanticConnectedExcerpt.modelWindowArcStatus, modelConfidence: semanticConnectedExcerpt.modelWindowConfidence, confidence: semanticConnectedExcerpt.confidence, summary: semanticConnectedExcerpt.summary, selectedSegmentIds: semanticConnectedExcerpt.selectedSegmentIds, limitation: semanticConnectedExcerpt.limitation } : { status: semanticWindow?.arcStatus ?? "not_qualified", qualified: false, confidence: semanticWindow?.confidence ?? null, summary: semanticWindow?.summary ?? null, rationale: semanticWindow?.rationale ?? null };
  const semanticTransitions = narrativeSemanticAnalysis?.transitions ?? [];
  const semanticByPair = new Map(semanticTransitions.map(item => [item.fromSegmentId + "->" + item.toSegmentId, item]));
  const semanticOrderedSegments = [...segments].sort((a, b) => a.start - b.start || a.end - b.end);
  const selectedBeatIds = narrativeStructure.evidence.map(item => item.segmentId);
  const selectedBeatIndexes = selectedBeatIds.map(id => semanticOrderedSegments.findIndex(segment => segment.id === id)).filter(index => index >= 0);
  const semanticPath = selectedBeatIndexes.length >= 2
    ? semanticOrderedSegments.slice(Math.min(...selectedBeatIndexes), Math.max(...selectedBeatIndexes)).map((segment, index, path) => {
        const next = semanticOrderedSegments[semanticOrderedSegments.indexOf(segment) + 1];
        return next ? semanticByPair.get(segment.id + "->" + next.id) : null;
      })
    : [];
  const semanticBeatTransitions = semanticPath.filter(Boolean);
  const semanticCoverageComplete = semanticPath.length > 0 && semanticBeatTransitions.length === semanticPath.length;
  const semanticBeatSequenceQualified = semanticCoverageComplete && semanticBeatTransitions.every(item => item.relationship === "connected" && item.confidence >= 0.7);
  narrativeStructure.semanticContinuityQualification = {
    status: !narrativeSemanticAnalysis ? "not_configured"
      : semanticBeatSequenceQualified ? "semantic_beat_sequence_connected"
      : narrativeSemanticAnalysis.status === "provider_error" ? "provider_error"
      : narrativeSemanticAnalysis.status === "not_configured" ? "not_configured"
      : "semantic_beat_sequence_not_qualified",
    qualified: semanticBeatSequenceQualified,
    checkedTransitions: semanticBeatTransitions.length,
    requiredTransitions: semanticPath.length,
    method: narrativeSemanticAnalysis?.method ?? "not_configured",
    limitation: narrativeSemanticAnalysis?.limitation ?? "No semantic provider result is available."
  };
  narrativeStructure.contextualContinuityQualification = {
    status: beatIndexes.length < 2 ? "insufficient_beat_evidence"
      : contextuallyConnected ? "beat_sequence_contextually_linked"
      : "beat_sequence_has_disconnected_context",
    qualified: contextuallyConnected,
    checkedTransitions: arcTransitions.length,
    disconnectedTransitions: arcTransitions.filter(transition => !transition.linked).map(transition => ({
      fromSegmentId: transition.fromSegmentId,
      toSegmentId: transition.toSegmentId
    })),
    limitation: "This qualification uses adjacent lexical continuity only. A linked sequence is not proof of semantic coherence, and a disconnected sequence may still be coherent through paraphrase or implied references."
  };
  const opening = ordered[0];
  // Prefer a curiosity-led teaser so the opening creates an information gap.
  const semanticHookCandidate = semanticWindowQualified
    ? ordered.find(item => item.id === semanticWindow.hookSegmentId)
    : semanticConnectedExcerptQualified ? ordered.find(item => item.beatRole === "tension") : null;
  const hookCandidate = semanticHookCandidate ?? [...ordered].sort((a, b) => {
    const value = item => item.signals.hook * 0.45 + item.signals.curiosity * 0.4 + item.signals.clarity * 0.15 - item.signals.payoff * 0.2;
    return value(b) - value(a) || b.score - a.score || a.start - b.start;
  })[0];
  const teaserMoment = semanticHookCandidate ?? (Number(hookCandidate.signals.hook || 0) + Number(hookCandidate.signals.curiosity || 0) >= 6 ? hookCandidate : null);
  const hookSourceText = teaserMoment ? (extractHookTeaser(teaserMoment.text) || (Number(teaserMoment.signals.hook || 0) >= 8 ? teaserMoment.text.replace(/\\s+/g, " ").trim().split(/(?<=[.!?])\\s+/)[0] : "")) : "";
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
  const semanticHookForFraming = semanticWindowQualified
    ? ordered.find(segment => segment.id === semanticWindow.hookSegmentId)
    : semanticConnectedExcerptQualified ? ordered.find(segment => segment.beatRole === "tension") : null;
  if (semanticHookForFraming && semanticHookForFraming.score >= 5.5) punchInMoments.add(semanticHookForFraming);
  const rights = source.rightsStatus === "reference_only" ? { allowed: false, status: "reference_only", reasons: ["Reference-only videos may be analyzed but not rendered or republished"] } : assertAssetRights(source, { platform });
  return {
    mode: "standalone_reedit", status: rights.allowed ? "edit_plan_ready" : "analysis_only",
    source: { sourceUrl: source.sourceUrl, title: source.title ?? null, creator: source.creator ?? null, durationSeconds: source.durationSeconds, excerptStartSeconds: Number(source.excerptStartSeconds) || 0, rightsStatus: source.rightsStatus, rightsEvidenceUrl: source.rightsEvidenceUrl ?? null, rightsEvidenceReference: source.rightsEvidenceReference ?? null, allowedPlatforms: source.allowedPlatforms ?? [], expiresAt: source.expiresAt ?? null, license: source.license ?? "Authorized source media" },
    rights, targetDurationSeconds: used, platform, editorialQuality: { status: "qualified_for_automated_edit", minimumScore: threshold, eligibleMoments: eligible.length, selectedMoments: selected.length, candidateCount: segments.length, averageSelectedScore, sourceSpanSeconds, selectedDurationSeconds, sourceContinuity, selectionStrategy: semanticWindowQualified ? "semantic_complete_story_window" : semanticConnectedExcerptQualified ? "semantic_connected_excerpt" : semanticMomentById.size === segments.length ? "semantic_plus_heuristic_chronological_story_window" : "best_scoring_chronological_story_window", semanticStoryWindow: { qualified: semanticSelectionQualified, arcStatus: semanticConnectedExcerptQualified ? "partial" : semanticWindow?.arcStatus ?? "not_provided", confidence: semanticConnectedExcerptQualified ? semanticConnectedExcerpt.confidence : semanticWindow?.confidence ?? null, summary: semanticConnectedExcerptQualified ? semanticConnectedExcerpt.summary : semanticWindow?.summary ?? null, modelRecommendedSegmentIds: semanticWindow?.segmentIds ?? [], selectedSegmentIds: semanticWindowQualified ? semanticWindowTrim.selectedSegmentIds : semanticConnectedExcerptQualified ? semanticConnectedExcerpt.selectedSegmentIds : [], trim: semanticWindowTrim, connectedExcerpt: semanticConnectedExcerptQualified ? semanticConnectedExcerpt : null }, semanticMomentAssessment: { status: semanticMomentById.size === segments.length ? "complete" : "not_complete", assessedMoments: semanticMomentById.size, totalMoments: segments.length, trustedMoments: segments.filter(item => item.semanticAssessment && item.semanticAssessment.evidenceValidated && Number(item.semanticAssessment.confidence) >= 0.7).length, scoreBlend: "30_percent_heuristic_70_percent_semantic_when_confidence_at_least_0.8_and_evidence_validated; otherwise_40_percent_heuristic_60_percent_semantic" }, contextualStoryAnalysis, beatRoles: ordered.map(item => ({ segmentId: item.id, role: item.beatRole })), storyArcCoverage: new Set(ordered.map(item => item.beatRole)).size, narrativeStructure },
    openingHook: { segmentId: opening.id, sourceIn: opening.start, sourceOut: opening.end, score: opening.score },
    hookOverlay: teaserMoment ? { text: hookOverlayText, segmentId: teaserMoment.id, sourceIn: teaserMoment.start, score: teaserMoment.score, durationSeconds: 2.4, method: "evidence_backed_cue_teaser_without_dialogue_reordering" } : null,
    editDecisionList: ordered.map((segment, index) => ({ order: index + 1, segmentId: segment.id, sourceIn: segment.start, sourceOut: segment.end, durationSeconds: Number((segment.end-segment.start).toFixed(2)), caption: segment.text, score: segment.score, beatRole: segment.beatRole, wordTimings: segment.words, treatment: {
        pacing: "tight",
        captions: "word_timed_karaoke",
        punchIn: punchInMoments.has(segment),
        motionTreatment: punchInMoments.has(segment)
          ? "impact_punch_in"
          : segment.beatRole === "payoff" || index === ordered.length - 1
            ? "settle_pullback"
            : segment.beatRole === "tension"
              ? "subtle_push"
              : segment.beatRole === "setup"
                ? "steady_hold"
                : index % 2 === 0 ? "subtle_push" : "steady_hold",
        transition: index ? "hard_cut" : "cold_open"
      } })),
    editorialNotes: ["Preserve original dialogue chronology; do not move a later sentence ahead of its context.", semanticConnectedExcerptQualified ? "This is a connected excerpt from a larger story, not a claim that the full story arc is present; human review is required before publication." : "Select the strongest complete moments within one compact chronological story window; avoid unrelated highlight hopping.", "Require beat-to-beat contextual continuity as supporting evidence; disconnected beat sequences remain flagged for human review, while lexical links cannot prove semantic coherence or causality.", "Use a curiosity-led teaser where available; avoid exposing the payoff in the opening overlay.", "Remove dead air only where meaning and context remain intact.", "Use original narration/commentary where it adds genuine explanation or critique.", "Do not imply that reframing or captions alone create permission to reuse the source."]
  };
}
