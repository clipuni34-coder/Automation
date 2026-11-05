// Pure planning helpers for the narration-first production pathway.
// Worthwhile real footage without usable speech (funny animal/mascot
// moments, surprising events) is NOT auto-rejected anymore: an original
// commentary script written for the clip is narrated (TTS), the footage
// is re-edited vertically around the narrated story beats, captions are
// burned from the script, and the same technical QC applies. These
// helpers are pure so the timing/caption logic is unit-testable.

export function splitScriptSentences(script) {
  return String(script ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Distribute caption cues across the narration duration, weighted by
// sentence length (longer sentence = more screen time). The first cue
// is flagged as the hook cue.
export function buildCaptionCues(script, durationSeconds) {
  const sentences = splitScriptSentences(script);
  if (!sentences.length || !(durationSeconds > 0)) return [];
  const weights = sentences.map((s) => Math.max(8, s.length));
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = 0;
  return sentences.map((text, i) => {
    const span = (weights[i] / total) * durationSeconds;
    const cue = { index: i, text, start: Number(cursor.toFixed(2)), end: Number(Math.min(durationSeconds, cursor + span).toFixed(2)), hook: i === 0 };
    cursor += span;
    return cue;
  });
}

function assTime(seconds) {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60), cs = Math.round((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function assEscape(text) {
  return String(text).replace(/\{/g, "(").replace(/\}/g, ")").replace(/\n/g, " ");
}

// ASS subtitle document: hook cue larger and higher, body cues bottom.
// 1080x1920 canvas (vertical Short).
export function buildAssDocument(cues, { title = "" } = {}) {
  const header = `[Script Info]
Title: ${assEscape(title)}
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Hook,Arial,84,&H00FFFFFF,&H0000FFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,6,2,8,60,60,240,1
Style: Body,Arial,64,&H00FFFFFF,&H0000FFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,5,2,2,60,60,180,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = cues.map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},${c.hook ? "Hook" : "Body"},,0,0,0,,${assEscape(c.text)}`);
  return header + lines.join("\n") + "\n";
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
