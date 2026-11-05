# Primeplug — YouTube Policy & Monetization-Risk Audit (2026-11-05)

Scope: channel UCB7EhjM0bj2wtIBy_A_kkkg (@primeplug-f4b). This audit uses
only observed facts; it does not promise monetization or eligibility.

## Current observed state
- 4 videos exist, all PRIVATE, none public, none monetized.
- All 4 were produced by our own pipeline with original commentary /
  original narration, captions, re-editing and posting packages.
- Analytics: API sync works (identity-verified); measured performance is
  zero because nothing is public. Subscribers/watch-time: no evidence of
  YPP thresholds being met; the channel must be assumed NOT eligible.

## Policy risk evaluation
- **Reused content (YPP)**: Primary risk area for this niche. Mitigations
  in place: sources limited to public-domain / Creative Commons assets
  with per-asset licence evidence recorded; every video adds original
  narration or commentary, original captions, reframing/punch-ins and an
  editorial structure; raw reposts are blocked by the pipeline design.
  Residual risk: MODERATE — YouTube's reused-content review is a human/
  policy judgement; CC/PD sourcing plus transformation reduces but can
  never eliminate it. Two early private videos were judged editorially
  weak in our own audit and are NOT recommended for publication.
- **Repetitious content**: Mitigated by per-video unique scripts, titles
  and story structures; quantity is explicitly subordinated to gates
  (candidates are held/rejected rather than mass-produced). Risk: LOW–MODERATE.
- **Copyright**: Licence evidence is recorded per asset from the Commons
  file page and re-verified via API at scheduling time; NC/ND material is
  blocked; research-only references never enter production; attribution
  and licence links are embedded in posting packages. Residual risk:
  licence records on user-uploaded Commons files can themselves be wrong;
  a human must inspect evidence before public release. Risk: LOW–MODERATE.
- **Community Guidelines**: Content rules exclude humiliation, injury
  celebration and dangerous-behaviour encouragement. The mascot-fails
  content is slapstick without real injury. Risk: LOW.
- **Shorts eligibility / metadata**: Vertical 1080x1920 original renders,
  truthful titles from actual content (weak auto-titles were caught by
  our audit and gated), no misleading thumbnails (frames are real).
  Risk: LOW.
- **Authenticity/originality**: Narration scripts are written for each
  clip and verified against the audio by transcription; no invented
  dialogue, identities or events are permitted by the editorial rules.
  Risk: LOW.

## External dependencies (outside system control)
- YPP thresholds (subscribers + watch hours/Shorts views), YouTube's
  channel review, and any policy decision are YouTube's alone.
- Monetization can only be assessed after public videos accumulate real
  watch data. This system tracks readiness numerically (see
  src/engine/monetization-readiness.js) but MUST NOT claim eligibility.

## Verdict
No policy barrier prevents continuing with private production and
owner-reviewed private uploads. Public launch and any monetization
expectation require (a) explicit owner authorization, (b) human rights
inspection per video, and (c) real audience data. Overall channel-level
monetization risk today: MODERATE, dominated by reused-content review
uncertainty inherent to the niche — manageable, not eliminable.
