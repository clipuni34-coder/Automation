// Loudness normalisation alone can still produce clipped AAC peaks from some
// voices. A conservative post-normalisation limiter adds headroom before AAC;
// it does not waive the independent audible-level or no-clipping QC gates.
// `latency=1` compensates the look-ahead so speech and word-timed captions
// remain aligned. The final encoded file is measured again after rendering.
export const NARRATION_AUDIO_FILTER = "loudnorm=I=-14:TP=-1.5:LRA=11,alimiter=limit=0.60:level=0:latency=1";
