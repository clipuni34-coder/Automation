const STOPWORDS = new Set(("a an the and or but if then than so because as at by for from in into of on onto to with without is are was were be been being do does did have has had can could may might must shall should will would this that these those it its he she they them their his her we you your i me my our us who what when where why how which there here").split(" "));
const CAUSAL_OR_TEMPORAL = /\b(after that|because of this|because|therefore|as a result|so then|then|next|later|meanwhile|once|until|when|while|which meant|that caused|this led to|the next|in response|in turn)\b/i;

function contentTerms(value) {
  return new Set(String(value ?? "").toLowerCase()
    .replace(/[^\p{L}\p{N}'-]+/gu, " ")
    .split(/\s+/)
    .map(token => token.replace(/^['-]+|['-]+$/g, ""))
    .filter(token => token.length >= 4 && !STOPWORDS.has(token) && !/^\d+$/.test(token)));
}

function inspectPair(previous, current) {
  const left = contentTerms(previous.text);
  const right = contentTerms(current.text);
  const shared = [...left].filter(token => right.has(token)).sort();
  const union = new Set([...left, ...right]);
  const jaccard = union.size ? shared.length / union.size : 0;
  const connector = CAUSAL_OR_TEMPORAL.test(current.text);
  // Require repeated specific language, or a specific repeated term plus an
  // explicit connective. A generic transition word alone is not continuity.
  const linked = shared.length >= 2 || (shared.length === 1 && connector) || jaccard >= 0.2;
  return {
    fromSegmentId: previous.id,
    toSegmentId: current.id,
    linked,
    sharedTerms: shared.slice(0, 8),
    connectiveCue: connector,
    lexicalOverlap: Number(jaccard.toFixed(3)),
    basis: linked
      ? shared.length >= 2 ? "multiple_shared_content_terms" : shared.length === 1 ? "shared_term_plus_causal_or_temporal_connector" : "high_content_term_overlap"
      : "insufficient_shared_context"
  };
}

/**
 * Transparent sequence-level context linking. This is a lexical continuity
 * aid, not semantic comprehension, entity resolution, or proof of causality.
 */
export function analyzeContextualStory(segments = []) {
  const ordered = [...segments].sort((a, b) => a.start - b.start || a.end - b.end);
  const transitions = ordered.slice(1).map((segment, index) => inspectPair(ordered[index], segment));
  const linkedTransitions = transitions.filter(item => item.linked);
  const disconnectedBoundaries = transitions.filter(item => !item.linked);
  let longestRun = ordered.length ? 1 : 0;
  let currentRun = ordered.length ? 1 : 0;
  for (const transition of transitions) {
    if (transition.linked) {
      currentRun += 1;
      longestRun = Math.max(longestRun, currentRun);
    } else currentRun = 1;
  }
  const continuityRatio = transitions.length
    ? Number((linkedTransitions.length / transitions.length).toFixed(3))
    : ordered.length ? 1 : 0;
  return {
    status: !transitions.length ? "single_segment_or_empty"
      : continuityRatio >= 0.75 ? "mostly_linked_sequence"
      : continuityRatio > 0 ? "partially_linked_sequence"
      : "disconnected_sequence",
    segmentCount: ordered.length,
    linkedAdjacentPairs: linkedTransitions.length,
    adjacentPairCount: transitions.length,
    continuityRatio,
    longestConnectedRun: longestRun,
    transitions,
    disconnectedBoundaries,
    method: "adjacent_chunk_content_term_overlap_and_explicit_connective_cues",
    limitation: "Lexical overlap can miss paraphrases and can falsely link repeated topics. It does not establish semantic meaning, real-world entities, causality, or whether an ending fulfills an opening."
  };
}
