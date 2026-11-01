# Roadmap

## Phase 0 — Foundation
- [x] Create a standalone Node.js 22 project.
- [x] Add health and platform-readiness endpoints.
- [x] Keep secrets out of source control.
- [x] Establish a dedicated autonomous-discovery feature branch.

## Phase 1 — Product and upstream audit
- [x] Clarify product: autonomous discovery; no user video upload required.
- [x] Inspect the supplied TikTok, Instagram, YouTube and general social-media skill repositories.
- [x] Record reusable capabilities, gaps, licenses and external dependencies.
- [x] Document the autonomous product specification and rights/policy boundaries.
- [ ] Inspect every selected upstream skill's supporting references/scripts before adapting it.
- [ ] Create an attribution and license manifest for any adapted material.

## Phase 2 — Discovery foundation
- [x] Define initial source collector contracts and provenance fields.
- [x] Implement official YouTube regional most-popular chart connector.
- [x] Implement bounded official YouTube keyword/video search with recent-upload filter and reference-only rights status.
- [x] Implement configurable public RSS/Atom feed connector.
- [x] Store observations, candidates, run history and source status in a local JSON store.
- [x] Deduplicate repeated source IDs and retain first-seen timestamps.
- [x] Calculate view velocity only from repeated observations; label first observations low confidence.
- [x] Add explainable recency, engagement, velocity and data-completeness scoring.
- [ ] Add topic-level clustering across different videos and sources.
- [ ] Add saturation, trend lifecycle and rejection-reason analysis.
- [ ] Add compliant TikTok and Instagram discovery adapters after access/terms verification.
- [ ] Add scheduled, durable discovery runs and operational monitoring.

## Phase 3 — Research and editorial intelligence
- [x] Implement a bounded claim ledger with deduplication, query fallback and explicit unresolved states.
- [x] Extract selected HTTPS source pages through Tavily for passage-level human review.
- [x] Add advisory claim-to-passage support, contradiction, ambiguity and not-addressed assessments with source-linked passages; human editorial review remains mandatory and claims stay unverified.
- [ ] Generate multiple creative angles and hooks.
- [ ] Build retention-aware script/storyboard and timed edit decision list.
- [ ] Add rights/provenance checks for every media asset.
- [ ] Keep predictions and confidence separate from observed facts.

## Phase 4 — Original video production
- [x] Select FFmpeg as the first renderer and verify it with a real integration render in CI.\n- [x] Implement a Pixabay live-action video search/download adapter with license and creator attribution metadata (live API test pending API key availability).
- [x] Build mixed still-image/live-action scene timeline assembly, subtle still motion, scene-timed captions, narration-audio muxing and MP4 export.
- [x] Add Gemini Nano Banana image generation for original 9:16 storyboard visuals (live provider verification pending).
- [x] Add Gemini 3.5 Flash-Lite fallback when Gemini 3.8 Flash daily request quota is exhausted; cap scheduled creative generation to one brief per run.
- [x] Build YouTube Shorts, TikTok and Instagram Reels draft captions/hashtags, hook options, thumbnail reference and stock-footage credits after render QC.
- [x] Orchestrate narration, generated/stock visuals, render, ffprobe QC and publishing-package metadata in a single production CLI.
- [x] Preserve original source-video audio and mix it with narration after sample-rate/channel normalization.\n- [x] Add Gemini-generated voiceover from the creative brief script (live provider run pending quota availability).\n- [ ] Add additional dynamic B-roll acquisition/generation, word-timed captions and sound design.
- [x] Render and probe 1080×1920, 30fps H.264/AAC fast-start MP4 output.\n- [ ] Add platform-specific variants and frame-rate/source adaptation.
- [x] Add automated storyboard visual-quality heuristics for scene variety, pacing, caption density and still-image holds, plus encoded-video black-frame/freeze inspection and a per-video quality report.\n- [ ] Add independent editorial, factual, audio and deeper semantic visual QC; implement repair/rerender or reject loop.
- [ ] Implement repair/rerender or reject loop.

## Phase 4B — Viral re-editing and compilations
- [x] Define a rights evidence gate for owned, licensed, permission-granted and public-domain media.
- [x] Build a standalone-video re-edit planner using timed transcript windows and hook/emotion/curiosity/payoff/clarity scores.
- [x] Build a ranked compilation planner with original framing commentary and per-clip rights checks.
- [x] Enforce creator-clip rights evidence in the FFmpeg renderer.
- [x] Add CLI commands and unit tests for re-edit and compilation planning.
- [ ] Add official API search for arbitrary keywords/creators beyond most-popular chart sampling.
- [ ] Add authorized creator media intake and secure cloud asset storage.
- [ ] Add automatic transcription and visual/audio moment detection on authorized source media.
- [x] Connect standalone re-edit and creator-compilation plans to render manifests with source cut points and local authorized media paths.
- [ ] Add timed commentary placement, sound design and dynamic captions for compilation edits.
- [ ] Add creator permission-request/expiry/revocation workflow and evidence storage.

## Phase 5 — Platform connections and publishing
- [ ] Verify official API capabilities, OAuth scopes, account eligibility and review requirements.
- [ ] Implement independent platform adapters and capability flags.
- [ ] Secure token storage, revocation handling and account identity checks.
- [ ] Add consent-compliant publishing, retries, idempotency and audit logs.
- [ ] Enable unattended scheduling only where platform rules and explicit user configuration permit it.

## Phase 6 — Analytics and learning
- [ ] Collect only metrics available and permitted through each platform.
- [ ] Store source/timestamp for platform-reported metrics.
- [ ] Separate measured metrics from internal heuristic scores.
- [ ] Build sample-size-aware experiments for hooks, formats, pacing and topics.
- [ ] Feed observed outcomes back into discovery and production selection.

## Release rule

A roadmap item is not complete until implemented, tested and its limitations documented. A skill file is not an agent runtime. A repository README is not proof that a capability works. Never report a platform as connected, a video as rendered, or a post as published without successful confirmation from the relevant system/API.

See [AUTONOMOUS_PRODUCT_SPEC.md](AUTONOMOUS_PRODUCT_SPEC.md) and [REPOSITORY_SKILL_AUDIT.md](REPOSITORY_SKILL_AUDIT.md).
