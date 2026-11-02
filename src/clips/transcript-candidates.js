import { summarizeMomentSignals } from "./media-signals.js";
const HOOK = /\b(why|how|what if|never|nobody|everyone|secret|truth|mistake|shocking|impossible|actually|wait|stop|listen|here is|here's)\b/i;
const CURIOSITY = /\b(why|how|what|when|where|secret|reason|because|but|except|until|unless)\b/i;
const EMOTION = /\b(love|hate|fear|afraid|angry|furious|cry|tears|laugh|funny|scared|shocked|surprised|incredible|terrible|beautiful|disaster|win|lost|fail|success)\b/i;
const PAYOFF = /\b(so|therefore|that means|the result|in the end|finally|turns out|which is why|because of that|here's what happened|and then)\b/i;
const FILLER = /\b(um|uh|erm|you know|like|basically|actually)\b/gi;

function scoreSignals(text, duration, words, media = {}) {
  const normalized = text.trim();
  const count = words.length;
  const density = count / Math.max(duration, 0.5);
  const hook = Math.min(10, (HOOK.test(normalized) ? 6 : 2) + (normalized.includes("?") ? 2 : 0) + (count >= 5 && count <= 24 ? 2 : 0));
  const curiosity = Math.min(10, (CURIOSITY.test(normalized) ? 6 : 2) + (normalized.includes("?") ? 3 : 0) + (/\b(but|however|except|instead)\b/i.test(normalized) ? 1 : 0));
  const emotion = Math.min(10, (EMOTION.test(normalized) ? 7 : 2) + (/[!?]{1,}/.test(normalized) ? 1 : 0) + (/\b(very|really|so|absolutely)\b/i.test(normalized) ? 1 : 0));
  const payoff = Math.min(10, (PAYOFF.test(normalized) ? 6 : 2) + (/[.!]$/.test(normalized) ? 2 : 0) + (count >= 6 ? 2 : 0));
  const fillerCount = (normalized.match(FILLER) ?? []).length;
  const clarity = Math.max(1, Math.min(10, 8 - fillerCount - (count > 34 ? 2 : 0) - (density < 0.7 ? 1 : 0)));
  return { hook, curiosity, emotion, payoff, clarity, visualActivity: media.visualActivity ?? null, speechContinuity: media.speechContinuity ?? null, silenceRatio: media.silenceRatio ?? null, sceneChangeCount: media.sceneChangeCount ?? 0 };
}

/**
 * Convert Whisper word timestamps into short, chronological candidate moments.
 * Scores are transparent lexical/structural heuristics, not claims of true emotion
 * or guaranteed audience retention. The original word timings are retained.
 */
export function buildTranscriptCandidates(words, { minSeconds = 2, maxSeconds = 11, maxWords = 32, mediaSignals = null } = {}) {
  if (!Array.isArray(words) || words.length === 0) throw new Error("A non-empty word-timestamp array is required");
  const clean = words.map((item, index) => {
    const start = Number(item.start), end = Number(item.end);
    const word = String(item.word ?? item.text ?? "").trim();
    if (!word || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      throw new Error("Word " + (index + 1) + " has invalid text or timestamps");
    }
    return { word, start, end };
  });
  for (let i = 1; i < clean.length; i++) {
    if (clean[i].start < clean[i - 1].start) throw new Error("Word timestamps must be chronological");
  }

  const groups = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    const start = current[0].start, end = current.at(-1).end;
    const text = current.map(item => item.word).join(" ").replace(/\s+([,.;!?])/g, "$1");
    const duration = end - start;
    if (duration >= minSeconds && text.trim()) {
      groups.push({
        id: "moment-" + (groups.length + 1), start, end, text,
        words: current.map(item => ({ ...item })),
        signals: scoreSignals(text, duration, current, mediaSignals ? summarizeMomentSignals({ start, end }, mediaSignals) : {}),
        scoringMethod: mediaSignals ? "local_lexical_heuristic_plus_ffmpeg_media_signals" : "local_lexical_heuristic"
      });
    }
    current = [];
  };

  for (const item of clean) {
    if (current.length) {
      const elapsed = item.end - current[0].start;
      const previous = current.at(-1);
      const sentenceEnded = /[.!?]$/.test(previous.word);
      if (sentenceEnded || elapsed > maxSeconds || current.length >= maxWords) flush();
    }
    current.push(item);
  }
  flush();
  if (!groups.length) throw new Error("No transcript moments met the minimum duration; adjust minSeconds or provide a longer transcript");
  return groups;
}
