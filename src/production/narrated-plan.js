// Pure planning helpers for the narration-first production pathway.
// Worthwhile real footage without usable speech (funny animal/mascot
// moments, surprising events) is NOT auto-rejected anymore: an original
// commentary script written for the clip is narrated (TTS), the footage
// is re-edited vertically around the narrated story beats, captions are
// burned from the script, and the same technical QC applies. These
// helpers are pure so the timing/caption logic is unit-testable.
import { validateOpeningHookText } from "./narrated-captions.js";

export function splitScriptSentences(script) {
  return String(script ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function validateNarratedEntry(entry) {
  const reasons = [];
  if (entry?.productionMode !== "narrated") reasons.push("productionMode is not 'narrated'");
  const script = String(entry?.narrationScript ?? "");
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  if (words < 25) reasons.push(`Narration script too short (${words} words; minimum 25 for a complete story beat structure)`);
  if (words > 90) reasons.push(`Narration script too long (${words} words; maximum 90 for a Short)`);
  if (!entry?.postingTitle || entry.postingTitle.length < 10) reasons.push("postingTitle missing or too short");
  if (!entry?.hookText || entry.hookText.length < 8) reasons.push("hookText missing (the opening line must be planned, not improvised)");
  // Complete-story structure: hook, development and payoff must be
  // planned beats, and the script itself must contain at least three
  // sentences so the beats can actually land. A single gag or an
  // unfinished setup is not a story.
  const beats = entry?.storyBeats ?? {};
  for (const beat of ["hook", "development", "payoff"]) {
    if (!String(beats[beat] ?? "").trim()) reasons.push(`storyBeats.${beat} is missing: a complete Short needs a planned hook, development and payoff`);
  }
  const sentences = splitScriptSentences(script);
  if (sentences.length < 3) reasons.push(`Narration script has only ${sentences.length} sentence(s); at least 3 are required for hook, development and payoff`);
  if (entry?.hookText && sentences.length && !sentences[0].toLowerCase().includes(String(entry.hookText).trim().toLowerCase().slice(0, 24))) {
    reasons.push("The script's opening sentence does not contain the planned hookText: the opening must be the planned hook, not an unrelated start");
  }
  // Narration must describe THIS footage: the recorded visual subject
  // must actually be mentioned in the script.
  if (!entry?.visualSubject) reasons.push("visualSubject missing: the footage's actual subject must be recorded so narration can be checked against it");
  else if (!script.toLowerCase().includes(String(entry.visualSubject).toLowerCase())) reasons.push(`Narration script never mentions the recorded visual subject ("${entry.visualSubject}"); narration must describe the footage it plays over`);
  return { valid: reasons.length === 0, reasons, narrationWords: words };
}

// A compelling hook is an editorial judgment, not a motion score. Require a
// recorded review of the FIRST TWO SECONDS of the exact source and edit window.
// Hash the downloaded source separately in the producer before trusting it.
// This validates the evidence record; it cannot itself judge the action.
export function validateVisualHookReview(entry) {
  const review = entry?.visualHookReview ?? {};
  const reasons = [];
  const start = Number(entry?.window?.startSeconds ?? 0);
  const reviewedStart = Number(review.windowStartSeconds);
  const action = Number(review.firstActionSourceSeconds);
  const through = Number(review.reviewedThroughSourceSeconds);
  if (review.status !== "editorial_reviewed") reasons.push("The visual opening has not been editorially reviewed.");
  if (review.sourceUrl !== entry?.sourceUrl || !/^[a-f0-9]{64}$/i.test(String(review.sourceSha256 ?? ""))) reasons.push("Opening review must identify the exact source URL and SHA-256.");
  if (!Number.isFinite(start) || start < 0 || review.windowStartSeconds == null || !Number.isFinite(reviewedStart) || Math.abs(reviewedStart - start) > 0.001) reasons.push("Opening review does not match the edit-window start.");
  if (review.firstActionSourceSeconds == null || !Number.isFinite(action) || action < start || action > start + 2) reasons.push("The reviewed action must begin within the first two seconds.");
  if (review.reviewedThroughSourceSeconds == null || !Number.isFinite(through) || through < start + 1.5 || through < action) reasons.push("Review evidence must cover the opening, not a single still.");
  if (String(review.visualAction ?? "").trim().length < 20) reasons.push("The visible opening action needs a specific editorial description.");
  if (String(review.reviewMethod ?? "").trim().length < 15 || !String(review.reviewedBy ?? "").trim()) reasons.push("Record who reviewed the opening and how it was reviewed.");
  const openingText = validateOpeningHookText(entry?.narrationScript, review.onScreenText);
  if (!openingText.valid) reasons.push(...openingText.reasons);
  return { valid: reasons.length === 0, reasons };
}

// Original audio is optional. Reusing the picture licence is NOT enough to
// clear every music, voice, or effect in the source audio. Default to muted;
// an explicit opt-in must document clearance for all underlying elements.
// A plan's explicit mute always wins (notably the Skomer seal plan).
export function validateOriginalAudioPlan(entry) {
  if (entry?.muteOriginalAudio === true) return { valid: true, mix: false, reason: "explicitly_muted" };
  const audio = entry?.sourceAudio ?? {};
  if (audio.enabled !== true) return { valid: true, mix: false, reason: "muted_by_default" };
  const approved = new Set(["owned_by_user", "permission_granted", "licensed", "public_domain"]);
  const reasons = [];
  if (!approved.has(audio.rightsStatus)) reasons.push("audio rights status is not approved");
  try { if (new URL(audio.rightsEvidenceUrl).protocol !== "https:") throw new Error("not HTTPS"); } catch { reasons.push("HTTPS audio-rights evidence is missing"); }
  if (!String(audio.license ?? "").trim() || /noncommercial|no[ -]?derivatives|\bcc[ -]?by[ -]?nc\b|\bcc[ -]?by[ -]?nd\b/i.test(String(audio.license ?? ""))) reasons.push("audio licence is missing or restricts commercial/derivative use");
  if (audio.allAudioElementsCleared !== true || audio.commercialUseAllowed !== true || audio.derivativesAllowed !== true) reasons.push("clearance of every audio element for commercial derivative use is not recorded");
  if (String(audio.basis ?? "").trim().length < 20 || String(audio.attribution ?? "").trim().length < 8) reasons.push("audio clearance basis or attribution is missing");
  return { valid: reasons.length === 0, mix: reasons.length === 0, reason: reasons.length ? reasons.join("; ") : "individually_cleared", attribution: audio.attribution ?? null };
}

export function shouldMixOriginalAudio(probe, entry) {
  const decision = validateOriginalAudioPlan(entry);
  return probe?.hasAudio === true && decision.valid && decision.mix;
}

// Even legacy plans without a specific payoff minimum may not cut off the
// generated narration at the end of the declared footage or the actual file.
export function validateNarrationWindowBounds(entry, narrationSeconds, sourceDurationSeconds) {
  const start = Number(entry?.window?.startSeconds ?? 0);
  const declaredLength = Number(entry?.window?.seconds ?? 30);
  const length = Math.min(declaredLength, 60);
  const reasons = [];
  if (!Number.isFinite(start) || start < 0 || !Number.isFinite(length) || length <= 0) reasons.push("The selected source window is invalid.");
  if (!Number.isFinite(narrationSeconds) || narrationSeconds <= 0) reasons.push("Narration duration is unavailable.");
  if (!Number.isFinite(sourceDurationSeconds) || sourceDurationSeconds <= start) reasons.push("The selected window is not present in the source.");
  if (!reasons.length && narrationSeconds > Math.min(length, sourceDurationSeconds - start) + 0.05) reasons.push("Narration would be cut off before it finishes.");
  return { valid: reasons.length === 0, reasons };
}

// Optional, fail-closed timing guard for a plan whose visual payoff occurs
// late in the source window. Keep the existing pathway unchanged for plans
// that do not declare minimumStorySeconds. A narration that is too short to
// reach the payoff, or too long to fit the source, must not pass as a story.
export function validateStoryWindowTiming(entry, narrationSeconds, sourceDurationSeconds) {
  const minimum = entry?.window?.minimumStorySeconds;
  if (minimum == null) return { valid: true, reasons: [] };
  const start = Number(entry?.window?.startSeconds ?? 0);
  const length = Number(entry?.window?.seconds);
  const required = Number(minimum);
  const reasons = [];
  if (!(Number.isFinite(start) && start >= 0 && Number.isFinite(length) && length > 0 && Number.isFinite(required) && required > 0 && required <= length)) reasons.push("The planned source window or minimum story duration is invalid.");
  if (!(Number.isFinite(narrationSeconds) && narrationSeconds > 0)) reasons.push("Narration duration is unavailable.");
  if (!(Number.isFinite(sourceDurationSeconds) && sourceDurationSeconds + 0.05 >= start + length)) reasons.push("The complete planned source window is not present.");
  const renderedSeconds = Math.min(length, Math.max(10, narrationSeconds + 1));
  // The FFmpeg output uses -shortest. When the source is silent or muted,
  // narration can end the actual output before the nominal video window.
  // Conservatively require the speech itself to reach the payoff even when
  // an original-audio bed might otherwise extend playback by one second.
  const guaranteedSeconds = Math.min(renderedSeconds, narrationSeconds);
  if (guaranteedSeconds + 0.01 < required) reasons.push("Narration would end the edit before the planned visual payoff.");
  if (narrationSeconds > length + 0.05) reasons.push("Narration is longer than the planned footage and would be cut off.");
  return { valid: reasons.length === 0, reasons, renderedSeconds, guaranteedSeconds };
}

// Soft editorial targets, never an instruction to truncate or pad a story.
// Loop quality is a human judgment about the actual end-to-start transition.
export function buildCreativeReviewChecklist(durationSeconds) {
  const duration = Number(durationSeconds);
  const available = Number.isFinite(duration) && duration > 0;
  return {
    durationSeconds: available ? duration : null,
    durationTargetSeconds: [15, 20],
    durationStatus: !available ? "unavailable" : duration >= 15 && duration <= 20 ? "within_target" : "outside_target_review",
    loopStatus: "review_required",
    loopReview: "Compare the final moment with the opening in a continuous replay; preserve the complete visual payoff and narration.",
    analyticsReview: "Check 24-48 hours after an approved upload, if Studio data is available."
  };
}

// Decide how to handle a source-overlay detection BEFORE rendering.
// Only edge bands (top/bottom) up to 25% of frame height may be reframed
// away; anything larger, central, or on both bands is held — we never
// cover important subjects just to pass QC.
export function decideOverlayCorrection(detection) {
  const overlays = detection?.overlays ?? [];
  if (!detection || detection.status !== "ok") return { action: "hold", reason: "Overlay detection could not be completed on the source window" };
  if (!overlays.length) return { action: "none", reason: null };
  if (overlays.length > 1) return { action: "hold", reason: "Source overlays on multiple bands cannot be reframed away safely" };
  const [o] = overlays;
  if (o.band !== "top" && o.band !== "bottom") return { action: "hold", reason: `Source overlay is in the ${o.band} band; only top/bottom edge bands can be reframed safely` };
  if (o.fraction > 0.25) return { action: "hold", reason: `Source overlay band is ${(o.fraction * 100).toFixed(0)}% of frame height (> 25%): reframing would damage the subject` };
  return { action: "reframe", band: o.band, fraction: o.fraction, reason: null };
}
