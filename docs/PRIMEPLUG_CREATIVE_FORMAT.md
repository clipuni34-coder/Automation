# Primeplug: action-first narrated Shorts

These changes apply to future narrated production (currently used by the active Primeplug channel; direct callers of the shared narrated producer receive the same safeguards). They do not modify existing uploads, the existing seal draft, the external scheduler, or the per-video upload/target-audience approval gates.

## Opening and story

A narrated plan must include a `visualHookReview` for the exact source URL, source SHA-256 and selected window. It records a specific visible action beginning in the first two seconds, review spanning at least 1.5 seconds and through that action, how the opening was reviewed, and who reviewed it. Source bytes are hashed after download; changed bytes require a new review. This record represents an **editorial judgment**: a motion detector cannot determine whether an opening is compelling or whether a narration accurately describes it. Review the completed video, not just the sampled source, before any upload.

The review also supplies `onScreenText`: a truthful, short prefix of the actual opening speech. It appears from the first video frame for muted viewers, in larger type, on at most two lines. Only the individual word highlights follow recognized speech times; the visual card's start is not presented as a speech timestamp. Matching the opening words avoids stacking a duplicate caption over the hook.

For example, `docs/evidence/puppies-hook-7-9.jpg` records eight sampled frames of the Tokyo puppy source. The assistant reviewed those samples, not the continuous finished video. This adds evidence for that opening but does not fix or reopen the puppy's earlier `held_story_timing` outcome. The declared visual-payoff timing remains binding, and every narration must fit the actual available footage.

Primeplug's old transcript/excerpt pathway automatically chooses moments and retains source audio. Since it cannot yet bind an opening review to the selected edit or separately clear every audio element, it is held instead of bypassing these rules. A reviewed narrated replacement can be considered; other channels are unaffected.

## Captions

The producer transcribes the **generated narration audio** with `faster-whisper`'s `base` model and requests word timestamps. It matches the recognized words in order to the planned script; script spelling and punctuation are retained, including a small number of approximate phonetic matches. At least 90% of words must match exactly, and short words, negations and numbers must match exactly. There is no length-weighted or interpolated fallback. A missing, stale, detectably inaccurate, incomplete, or invalid transcription is held. Recognized timestamps are estimates, not a guarantee of perfect alignment, and need output review. This intentionally favors safety over throughput; strict matching can reject a usable narration, especially one containing unusual names or split/merged words.

After the opening card (up to five words and 25 characters), captions are short, one-line phrases of at most four words and 25 characters, with an approximate width limit. The current word is highlighted only during its recognized word timestamps. Two positions avoid the extreme top, bottom and right edges where Shorts controls commonly appear. An existing **motion-peak heuristic**, mapped into the actual crop, chooses between those bands. A motion peak is not a subject or face bounding box, and platform UI varies: neither subject clearance nor safe placement is guaranteed. The finished render still needs a visual review on the intended device.

The final video and a low-resolution caption-free proxy are generated from the same reframed video stream. The framing gate checks both the proxy and the final output; changing captions alone must not be allowed to impersonate the tracked subject. Existing source/output overlay, framing, timing, audio and technical QC gates remain active.

The workflow already installs `faster-whisper` and PyAV from `requirements/repurposing.txt`. The `base` model may need to be downloaded on a fresh runner. A failed model download, missing dependencies, or uncertain transcription holds the draft rather than fabricating captions. Confirm the first actual cloud run; a local or mocked test cannot prove GitHub runner model availability.

## Narration and sound rights

Gemini is **asked** for a warmer, more expressive, slightly brisk conversational delivery with brief pauses around visual beats. The Kokoro fallback is requested at 1.08× speed. TTS output can vary: review the actual voice and pacing, and retain the existing story timing gates. These instructions are not a promise that any provider produces a particular inflection.

Source audio is **muted by default**. To opt in, `sourceAudio` must separately record a valid rights status, HTTPS evidence, licence, explanatory basis, attribution, and explicit confirmation that all underlying audio elements are cleared for commercial derivative use. An incomplete or restrictive opt-in is held. `muteOriginalAudio: true` overrides every opt-in; the existing Skomer seal plan keeps that setting. No sound effects are added automatically. The evidentiary record is not a substitute for legal review.

## Duration, loops and measurement

The producer records 15–20 seconds as a **soft editorial target**, not a technical gate. Do not cut off the payoff or narration, or pad a good shorter clip, just to hit a number. `loopStatus` remains `review_required`: compare the actual ending and opening in continuous playback; the system does not claim that a cut is seamless or guarantee rewatches. A proposed `engagementPrompt` is saved only as a suggestion for human review; the system does not post or pin it. Comments may be unavailable for made-for-kids videos.

YouTube's suggested 3–5 uploads per week is a planning idea, not a change to the existing daily production schedule or permission to publish. Check available Studio metrics around 24–48 hours after an approved upload. The supplied 75% stayed-rate and 100% average-percentage-viewed figures are experimental targets, not guarantees or hard pass/fail thresholds; high average percentage viewed can reflect rewatches. Use context and sample size, and refine rather than automatically cutting videos based on one metric. See `PRIMEPLUG_PERFORMANCE_LOG.md`.

## Publishing

Automated QC and editorial evidence are not upload approval. Private upload still requires the user's explicit approval for the exact candidate and output SHA-256, plus a separately reviewed audience selection. Public publishing remains off. Existing public Shorts remain unchanged.
