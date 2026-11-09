// Speech-aligned, short-form captions for the narrated production pathway.
// The transcript is generated from the actual narration audio, not from a
// duration estimate. A transcript that cannot be matched to the planned text
// is a HOLD: we do not invent timings or silently fall back to sentence timing.

export const CAPTION_FONT_SIZE = 64;
export const HOOK_FONT_SIZE = 76;
export const MAX_HOOK_WORDS = 5;
export const CAPTION_X = 490;
// These positions avoid the usual extreme top/bottom/right Shorts controls.
// They are not a guarantee for every device or every moving subject.
export const CAPTION_Y = Object.freeze({ top: 480, lower: 1325 });
export const MAX_CAPTION_WORDS = 4;
export const MAX_CAPTION_CHARS = 25;
const MAX_TEXT_WIDTH = 740;
const MAX_CUE_SECONDS = 2.7;
const MAX_WORD_GAP = 0.5;
// Do not smooth over short words, negations, or numbers: mishearing one can
// reverse the meaning even if the rest of the sentence matches perfectly.
const CRITICAL_WORDS = new Set(["no", "not", "never", "none", "nothing", "nobody", "without", "cannot", "cant", "wont", "isnt", "arent", "wasnt", "werent", "didnt", "doesnt", "dont"]);

function normalizedWord(value) {
  return String(value ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]/gu, "");
}

function scriptWords(script) {
  const result = [];
  let leading = "";
  for (const raw of String(script ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean)) {
    if (normalizedWord(raw)) {
      result.push(leading ? `${leading} ${raw}` : raw);
      leading = "";
    } else if (result.length) result[result.length - 1] += ` ${raw}`;
    else leading = leading ? `${leading} ${raw}` : raw;
  }
  if (leading && result.length) result[result.length - 1] += ` ${leading}`;
  return result;
}

function similarity(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(previous[j] + 1, next[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = next;
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

// Conservative approximate width for the selected bold font, including outline.
// One short line is easier to place inside the practical safe area than a long
// two-line sentence. Exceptional wide words are held rather than overflowed.
export function estimatedCaptionWidth(text, fontSize = CAPTION_FONT_SIZE) {
  let ems = 0;
  for (const c of String(text)) {
    if (/\s/.test(c)) ems += 0.38;
    else if (/[ilI1.,'’!|:;]/.test(c)) ems += 0.4;
    else if (/[MW@%]/.test(c)) ems += 1.05;
    else if (/[A-Z0-9]/.test(c)) ems += 0.83;
    else ems += 0.72;
  }
  return ems * fontSize + 24;
}

function hookLineBreak(words) {
  let line = "", lineCount = 1, breakAfter = null;
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (estimatedCaptionWidth(next, HOOK_FONT_SIZE) > MAX_TEXT_WIDTH) {
      if (!line || ++lineCount > 2 || estimatedCaptionWidth(words[i], HOOK_FONT_SIZE) > MAX_TEXT_WIDTH) return { valid: false, breakAfter: null };
      breakAfter = i; line = words[i];
    } else line = next;
  }
  return { valid: true, breakAfter };
}

// The immediate visual hook must be an editorially checked, short PREFIX of
// what the narrator actually says. That lets one on-screen element serve both
// muted viewers and captions without covering the picture with duplicate text.
export function validateOpeningHookText(script, hookText) {
  const planned = scriptWords(script);
  const hook = scriptWords(hookText);
  const reasons = [];
  if (!String(hookText ?? "").trim() || !hook.length || hook.length > MAX_HOOK_WORDS || String(hookText ?? "").trim().length > MAX_CAPTION_CHARS) reasons.push("On-screen hook must be a short phrase of at most five words and 25 characters.");
  const effective = planned.slice(0, hook.length);
  const wrapping = hookLineBreak(effective);
  if (effective.join(" ").length > MAX_CAPTION_CHARS || !wrapping.valid) reasons.push("On-screen hook is too wide for two safe caption lines.");
  if (hook.length > planned.length || hook.some((word, i) => normalizedWord(word) !== normalizedWord(planned[i]))) reasons.push("On-screen hook must match the first spoken script words in order.");
  return { valid: reasons.length === 0, reasons, wordCount: hook.length, lineBreakAfter: wrapping.breakAfter };
}

/**
 * Match script words in order to Whisper's word timestamps. The script supplies
 * spelling and punctuation; timestamps are measured on the generated voice.
 * A few phonetic substitutions can be tolerated (e.g. a proper name), but
 * inserted/omitted words, low agreement, bad timestamps, or missing words hold
 * the video. No unmatched word is interpolated.
 */
export function buildSpeechAlignedCaptionCues({ script, transcription, durationSeconds, openingHookText = null } = {}) {
  const hold = (reason, metrics = {}) => ({ status: "hold", reason, cues: [], metrics });
  const planned = scriptWords(script);
  const heard = transcription?.words;
  const duration = Number(durationSeconds);
  if (!planned.length || !Number.isFinite(duration) || duration <= 0) return hold("Script or narration duration is unavailable.");
  const opening = openingHookText == null ? null : validateOpeningHookText(script, openingHookText);
  if (opening && !opening.valid) return hold(`The immediate visual hook is invalid: ${opening.reasons.join(" ")}`);
  if (transcription?.status !== "transcribed" || !Array.isArray(heard) || !heard.length) return hold("Word-timed transcription is unavailable.");
  if (Number(transcription.droppedWordCount ?? 0) !== 0) return hold("Transcription dropped one or more word timestamps.");
  if (heard.length !== planned.length) return hold("Recognized and planned word counts differ; no timing interpolation is permitted.", { plannedWords: planned.length, recognizedWords: heard.length });

  const words = [];
  let exact = 0;
  let previousStart = -1;
  let previousEnd = -1;
  for (let i = 0; i < planned.length; i++) {
    const item = heard[i] ?? {};
    const expected = normalizedWord(planned[i]);
    const recognized = normalizedWord(item.word ?? item.text);
    const score = similarity(expected, recognized);
    const start = Number(item.start), rawEnd = Number(item.end);
    const probability = item.probability == null ? null : Number(item.probability);
    const critical = expected.length <= 3 || recognized.length <= 1 || CRITICAL_WORDS.has(expected) || CRITICAL_WORDS.has(recognized) || /\d/.test(expected + recognized);
    if (score !== 1 && critical) return hold(`A short, negative or numeric word ${i + 1} did not match exactly.`, { wordIndex: i });
    // A clipped prefix at the very start (e.g. Whisper hearing "Me" for
    // "Meet") can still carry the measured onset. No timing is interpolated.
    const firstWordPrefix = i === 0 && recognized.length >= 2 && expected.length >= 4 && expected.startsWith(recognized) && expected.length - recognized.length <= 2;
    if (!expected || !recognized || (score < 0.65 && !firstWordPrefix)) return hold(`Recognized word ${i + 1} does not match the planned narration closely enough.`, { wordIndex: i, plannedWords: planned.length });
    if (!Number.isFinite(start) || !Number.isFinite(rawEnd) || start < 0 || start >= duration || rawEnd - start < 0.01 || start + 1e-6 < previousStart || rawEnd + 1e-6 < previousEnd || start < previousEnd - 0.08 || rawEnd > duration + 0.05) {
      return hold(`Word timestamp ${i + 1} is invalid, out of order, overlapping, or beyond the narration.`, { wordIndex: i });
    }
    if (probability !== null && (!Number.isFinite(probability) || probability < 0.15 || probability > 1)) return hold(`Recognition confidence for word ${i + 1} is too low.`, { wordIndex: i });
    if (score === 1) exact++;
    if (planned[i].length > MAX_CAPTION_CHARS || estimatedCaptionWidth(planned[i]) > MAX_TEXT_WIDTH) return hold(`Word ${i + 1} is too wide for the caption safe area.`, { wordIndex: i });
    words.push({ text: planned[i], start, end: Math.min(rawEnd, duration), recognitionMatch: score === 1 ? "exact" : "approximate" });
    previousStart = start;
    previousEnd = rawEnd;
  }
  const exactRatio = exact / planned.length;
  if (exactRatio < 0.9) return hold("Too many recognized words differ from the planned narration.", { plannedWords: planned.length, exactRatio: Number(exactRatio.toFixed(3)) });

  const cues = [];
  if (opening) {
    const hookWords = words.slice(0, opening.wordCount);
    // This is a visual card from the first frame, not a fabricated speech
    // timestamp. Its individual highlights still use the measured word times.
    const hookEnd = Math.min(hookWords.at(-1).end, words[opening.wordCount]?.start ?? duration);
    cues.push({ index: 0, text: hookWords.map((w) => w.text).join(" "), start: 0, speechStart: hookWords[0].start, end: hookEnd, hook: true, visualHook: true, lineBreakAfter: opening.lineBreakAfter, words: hookWords });
  }
  let group = [];
  const flush = () => {
    if (!group.length) return;
    cues.push({ index: cues.length, text: group.map((w) => w.text).join(" "), start: group[0].start, end: group.at(-1).end, hook: cues.length === 0, words: group });
    group = [];
  };
  for (const word of words.slice(opening?.wordCount ?? 0)) {
    const nextText = [...group.map((w) => w.text), word.text].join(" ");
    const prior = group.at(-1);
    const fontSize = cues.length === 0 ? HOOK_FONT_SIZE : CAPTION_FONT_SIZE;
    if (group.length && (
      group.length >= MAX_CAPTION_WORDS || nextText.length > MAX_CAPTION_CHARS || estimatedCaptionWidth(nextText, fontSize) > MAX_TEXT_WIDTH ||
      word.end - group[0].start > MAX_CUE_SECONDS || word.start - prior.end > MAX_WORD_GAP || /[.!?][”"')\]]*$/.test(prior.text)
    )) flush();
    if (!group.length && cues.length === 0 && estimatedCaptionWidth(word.text, HOOK_FONT_SIZE) > MAX_TEXT_WIDTH) return hold("The first caption word is too wide for the hook band.");
    group.push(word);
  }
  flush();
  return {
    status: "aligned", reason: null, cues,
    metrics: { plannedWords: planned.length, recognizedWords: heard.length, exactWords: exact, approximateWords: planned.length - exact, exactRatio: Number(exactRatio.toFixed(3)), cueCount: cues.length }
  };
}

function beatAt(plan, t) {
  const beats = plan?.beats ?? [];
  return beats.find((beat, i) => t >= beat.startSeconds && (i === beats.length - 1 || t < beat.startSeconds + beat.seconds)) ?? null;
}

// The existing tracker reports a motion peak, NOT a subject bounding box. Map
// that peak into output coordinates and choose the more distant of two practical
// UI-safe caption bands. This reduces potential obstruction; it cannot prove a
// face, whole animal, or changing platform overlay is clear. Human review stays
// mandatory before any upload.
function outputMotionY(sample, plan, { sourceWidth, sourceHeight, overlayDecision } = {}) {
  const beat = beatAt(plan, Number(sample.t));
  const y = Number(sample.peakY);
  if (!beat || !Number.isFinite(y) || y < 0 || y > 1 || !(sourceWidth > 0) || !(sourceHeight > 0)) return null;
  const cut = overlayDecision?.action === "reframe" ? Number(overlayDecision.fraction) + 0.02 : 0;
  const topCut = overlayDecision?.action === "reframe" && overlayDecision.band === "top" ? cut : 0;
  const postHeight = sourceHeight * (1 - cut);
  const localY = y * sourceHeight - topCut * sourceHeight;
  if (!(postHeight > 0) || localY < 0 || localY > postHeight) return null;
  if (beat.mode === "crop") return localY / postHeight;
  const cropWidth = sourceWidth * Number(beat.widthFraction ?? beat.windowFraction);
  if (!(cropWidth > 0)) return null;
  const scale = 1080 / cropWidth;
  return ((1920 - postHeight * scale) / 2 + localY * scale) / 1920;
}

export function placeCaptionCues(cues, { track, framingPlan, sourceWidth, sourceHeight, overlayDecision } = {}) {
  const measured = (track?.samples ?? []).filter((s) => s.peakX != null && Number(s.prominence) >= 1.6 && s.peakY != null)
    .map((s) => ({ t: Number(s.t), y: outputMotionY(s, framingPlan, { sourceWidth, sourceHeight, overlayDecision }) }))
    .filter((s) => Number.isFinite(s.t) && Number.isFinite(s.y) && s.y >= 0 && s.y <= 1);
  let previous = "top";
  let unmeasured = 0;
  const placed = (cues ?? []).map((cue) => {
    let samples = measured.filter((s) => s.t >= cue.start - 0.2 && s.t <= cue.end + 0.2);
    if (!samples.length) samples = measured.filter((s) => Math.abs(s.t - (cue.start + cue.end) / 2) <= 1.5);
    if (!samples.length) { unmeasured++; return { ...cue, position: previous, placementEvidence: "unmeasured" }; }
    const risk = (band) => samples.reduce((sum, s) => sum + Math.exp(-(((s.y - CAPTION_Y[band] / 1920) / 0.16) ** 2)), 0) / samples.length;
    const top = risk("top"), lower = risk("lower");
    const best = top <= lower ? "top" : "lower";
    // Avoid distracting jumps when the two bands are nearly equally safe.
    const oldRisk = previous === "top" ? top : lower;
    const bestRisk = best === "top" ? top : lower;
    const position = oldRisk <= bestRisk + 0.12 ? previous : best;
    previous = position;
    return { ...cue, position, placementEvidence: "motion_peak_heuristic" };
  });
  return { cues: placed, metrics: { measuredFrames: measured.length, unmeasuredCues: unmeasured, method: "motion_peak_heuristic_not_subject_bounds", humanReviewRequired: true } };
}

function assTime(seconds) {
  const cs = Math.max(0, Math.round(Number(seconds) * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100), fraction = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(fraction).padStart(2, "0")}`;
}
function assEscape(text) {
  return String(text ?? "").replace(/[\r\n\t]+/g, " ").replace(/\\/g, "").replace(/\{/g, "(").replace(/\}/g, ")");
}
function assPhrase(words, lineBreakAfter, active = -1) {
  return words.map((word, i) => {
    const separator = i === 0 ? "" : (i === lineBreakAfter ? "\\N" : " ");
    const text = assEscape(word.text);
    return separator + (i === active ? `{\\c&H00D8FF&}${text}{\\c&HFFFFFF&}` : text);
  }).join("");
}

// Base phrase plus a transparent-to-timing coloured word layer: the active
// word is highlighted only between its own measured onset and end. Pauses show
// the base phrase with no active word; no karaoke duration is manufactured.
export function buildAssDocument(cues, { title = "" } = {}) {
  const header = `[Script Info]
Title: ${assEscape(title)}
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Hook,DejaVu Sans,${HOOK_FONT_SIZE},&H00FFFFFF,&H0000D8FF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,5,2,5,160,210,0,1
Style: Body,DejaVu Sans,${CAPTION_FONT_SIZE},&H00FFFFFF,&H0000D8FF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,5,2,5,160,210,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = [];
  for (const cue of cues ?? []) {
    const style = cue.hook ? "Hook" : "Body";
    const pos = `{\\an5\\pos(${CAPTION_X},${CAPTION_Y[cue.position] ?? CAPTION_Y.top})}`;
    const words = cue.words ?? [];
    const text = words.length ? assPhrase(words, cue.lineBreakAfter) : assEscape(cue.text);
    lines.push(`Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},${style},,0,0,0,,${pos}${text}`);
    words.forEach((word, i) => {
      const end = Math.min(word.end, words[i + 1]?.start ?? cue.end, cue.end);
      if (!(end > word.start) || assTime(end) === assTime(word.start)) return;
      const highlighted = assPhrase(words, cue.lineBreakAfter, i);
      lines.push(`Dialogue: 1,${assTime(word.start)},${assTime(end)},${style},,0,0,0,,${pos}${highlighted}`);
    });
  }
  return header + lines.join("\n") + "\n";
}
