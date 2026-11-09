// Decisions about when an old, completed job is genuinely eligible for
// another production attempt. A quality/rights hold is a decision, not a
// transient failure; repeatedly resetting it without changing the input
// wastes every daily slot and can never make the output safe.
import { validateNarratedEntry } from "../production/narrated-plan.js";

export function isDailyProductionSeed(seed) {
  return Boolean(seed && seed.testOnly !== true);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function planKey(seed) {
  // Only compare fields that can materially change what gets produced.
  // Metadata such as a fetched timestamp or spelling in a display label
  // must not repeatedly reopen a held item.
  return JSON.stringify(stable({
    productionMode: seed?.productionMode ?? null,
    sourceUrl: seed?.sourceUrl ?? null,
    window: seed?.window ?? null,
    narrationScript: seed?.narrationScript ?? null,
    hookText: seed?.hookText ?? null,
    storyBeats: seed?.storyBeats ?? null,
    visualSubject: seed?.visualSubject ?? null,
    muteOriginalAudio: seed?.muteOriginalAudio === true,
    processing: seed?.processing ?? null
  }));
}

export function isTransientProductionOutcome(outcome) {
  if (!["rejected_source_unavailable", "held_tts_unavailable"].includes(outcome?.status)) return false;
  return /429|\b5\d\d\b|network|fetch|timeout|timed out|connect|unreachable|temporar|econn|enotfound|quota|resource_exhausted/i.test(String(outcome.reason ?? ""));
}

function localDay(value, timeZone) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const part = (name) => parts.find((x) => x.type === name)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch { return null; }
}

// A confirmed transient dependency outage can be retried on a later local
// day; editorial decisions, rights conflicts and unknown errors stay held.
export function transientNextDayDecision(job, currentSeed, { now = new Date(), timeZone = "Africa/Lagos" } = {}) {
  if (job?.status !== "failed" || !isDailyProductionSeed(currentSeed)) return false;
  if (job?.candidate?.id !== currentSeed.id || job?.candidate?.sourceUrl !== currentSeed.sourceUrl) return false;
  if (!/^(Temporary production dependency failure:|Fresh rights verification temporarily unavailable:)/.test(String(job.lastError ?? ""))) return false;
  const failedDay = localDay(job.updatedAt, timeZone);
  const today = localDay(now, timeZone);
  return Boolean(failedDay && today && failedDay < today);
}

export function ttsConfigurationRequeueDecision(job, currentSeed, { ttsConfigured = false } = {}) {
  if (!ttsConfigured || job?.status !== "completed" || job?.result?.produced !== false || job?.result?.outcome !== "held_tts_not_configured") return false;
  if (!isDailyProductionSeed(currentSeed) || currentSeed.productionMode !== "narrated") return false;
  if (job?.candidate?.id !== currentSeed.id || job?.candidate?.sourceUrl !== currentSeed.sourceUrl) return false;
  return validateNarratedEntry(currentSeed).valid;
}

export function narratedRequeueDecision(job, currentSeed) {
  const no = (reason) => ({ requeue: false, reason });
  if (job?.status !== "completed" || job?.result?.produced !== false) return no("not_a_held_completed_job");
  if (!isDailyProductionSeed(currentSeed)) return no("test_only_or_missing");
  if (currentSeed.productionMode !== "narrated") return no("no_narrated_plan");
  if (job?.candidate?.id !== currentSeed.id || job?.candidate?.sourceUrl !== currentSeed.sourceUrl) return no("candidate_identity_changed");
  const validation = validateNarratedEntry(currentSeed);
  if (!validation.valid) return no("updated_narration_plan_incomplete");
  const previousSeed = job.candidate?.seedManifestEntry;
  if (!previousSeed) return no("previous_plan_unknown");
  if (planKey(previousSeed) === planKey(currentSeed)) return no("plan_unchanged");
  if (previousSeed.productionMode !== "narrated") {
    // This transition was designed for non-speech source footage that was
    // previously rejected because transcript-based production could not run.
    // Do not bypass or reopen a rights, overlay, privacy or licence hold.
    const outcome = String(job.result?.outcome ?? "");
    const reason = String(job.result?.reason ?? "");
    const noUsableSpeech = outcome === "rejected_no_speech" || /no usable speech|no intelligible spoken|no transcript moments/i.test(reason);
    return noUsableSpeech ? { requeue: true, reason: "new_narrated_plan_for_no_speech" } : no("previous_failure_not_no_speech");
  }
  // A genuinely revised edit/narration may resolve an earlier visual or story
  // hold. Rights and the complete production/QC pipeline still run again.
  return { requeue: true, reason: "production_plan_changed" };
}
