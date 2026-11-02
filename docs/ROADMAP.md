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
- [x] Add initial evidence-based category niche research using repeated video, creator, engagement and regional observations; recommend pilots rather than treating a single breakout as proof.
- [ ] Improve topic-level clustering across different videos and sources.
- [ ] Add saturation, trend lifecycle and rejection-reason analysis.
- [ ] Add compliant TikTok and Instagram discovery adapters after access/terms verification.
- [x] Add a scheduled daily editorial-plan generation step and archive its output as a workflow artifact.
- [ ] Replace short-lived workflow cache history with durable database/object storage and add operational monitoring.

## Phase 3 — Research and editorial intelligence
- [x] Implement a bounded claim ledger with deduplication, query fallback and explicit unresolved states.
- [x] Extract selected HTTPS source pages through Tavily for passage-level human review.
- [x] Add advisory claim-to-passage support, contradiction, ambiguity and not-addressed assessments with source-linked passages; human editorial review remains mandatory and claims stay unverified.
- [x] Generate provisional format classification, editorial angles, evidence-based daily recommendations and a ranked backlog from discovered candidates.
- [x] Generate model-assisted creative briefs with multiple hook options, editorial angle and script/storyboard; one strongest candidate is selected per scheduled run.
- [ ] Build retention-aware script/storyboard and timed edit decision list.
- [x] Preserve per-asset provenance and enforce a rights-evidence preflight before autonomous publishing.
- [ ] Keep predictions and confidence separate from observed facts.

## Phase 4 — Original video production
- [x] Select FFmpeg as the first renderer and verify it with a real integration render in CI.
- [x] Implement a Pixabay live-action video search/download adapter with license and creator attribution metadata (live API test pending API key availability).
- [x] Build mixed still-image/live-action scene timeline assembly, subtle still motion, scene-timed captions, narration-audio muxing and MP4 export.
- [x] Add Gemini Nano Banana image generation for original 9:16 storyboard visuals (live provider verification pending).
- [x] Add Gemini model fallback when explicitly enabled; use OpenRouter's free-model router for default creative briefs and keep paid model calls opt-in.
- [x] Build YouTube Shorts, TikTok and Instagram Reels draft captions/hashtags, hook options, thumbnail reference and stock-footage credits after render QC.
- [x] Orchestrate narration, generated/stock visuals, render, ffprobe QC and publishing-package metadata in a single production CLI.
- [x] Preserve original source-video audio and mix it with narration after sample-rate/channel normalization.
- [x] Add local Kokoro-82M ONNX narration fallback with checksum-verified model download and real WAV smoke test; Gemini TTS remains opt-in.
- [ ] Add additional dynamic B-roll acquisition/generation, word-timed captions and sound design.
- [x] Render and probe 1080×1920, 30fps H.264/AAC fast-start MP4 output.
- [ ] Add platform-specific variants and frame-rate/source adaptation.
- [x] Add automated storyboard visual-quality heuristics for scene variety, pacing, caption density and still-image holds, plus encoded-video black-frame/freeze inspection and a per-video quality report.
- [x] Add OpenAI vision checks when explicitly enabled and OpenRouter free multimodal scene relevance checks by default, with conservative Pixabay tag filtering and fail-closed QC.
- [ ] Add broader independent editorial, factual and audio QC, multi-frame/video understanding, and an automated repair/rerender or reject loop.

## Phase 4B — Viral re-editing and compilations
- [x] Define a rights evidence gate for owned, licensed, permission-granted and public-domain media.
- [x] Build a standalone-video re-edit planner using timed transcript windows and hook/emotion/curiosity/payoff/clarity scores.
- [x] Build a ranked compilation planner with original framing commentary and per-clip rights checks.
- [x] Enforce creator-clip rights evidence in the FFmpeg renderer.
- [x] Add CLI commands and unit tests for re-edit and compilation planning.
- [x] Add bounded official YouTube Search API discovery for recent keyword/creator searches beyond most-popular chart sampling.
- [x] Add manual workflow-dispatch intake for direct HTTPS source media, rights attestation, host allowlisting, redirect/DNS validation, download caps, processing and result artifacts.
- [ ] Add direct iPhone file upload and durable private cloud asset storage; current intake accepts public direct-download URLs only.
- [x] Add Faster-Whisper word-timed transcription support to the authorized re-edit CLI and FFmpeg scene-change/silence analysis as candidate-level signals; synthetic-media integration verifies the FFmpeg signal path.
- [ ] Verify Faster-Whisper against a real authorized source and expand visual analysis beyond scene cuts (e.g. speaker/subject tracking and action cues).
- [x] Connect standalone re-edit and creator-compilation plans to render manifests with source cut points and local authorized media paths.
- [ ] Add timed commentary placement, sound design and dynamic captions for compilation edits.
- [ ] Add creator permission-request/expiry/revocation workflow and evidence storage.

## Phase 5 — Platform connections and publishing
- [x] Verify YouTube upload/Analytics APIs, OAuth scopes and Nigeria YPP thresholds; document TikTok/Instagram access and publishing limitations.
- [x] Implement a guarded YouTube OAuth refresh, channel identity check, resumable upload and processing-status adapter; TikTok/Instagram adapters remain future work.
- [x] Store YouTube OAuth credentials as GitHub Actions secrets and verify the connected channel ID before upload; token revocation handling and multi-account credential mapping remain outstanding.
- [x] Add YouTube publishing workflow with explicit channel-level opt-in, quality/policy gates, duplicate fingerprint protection and upload confirmation artifacts; robust retries and multi-platform audit logs remain outstanding.
- [x] Wire YouTube unattended scheduling behind explicit owner-configured workflow variables; live account authorization and end-to-end upload verification are still pending.

## Phase 6 — Analytics and learning
- [x] Add platform-metric normalization for retention, engagement, viewed-versus-swiped, CTR and subscriber gains, plus sample-size-aware experiment suggestions.
- [x] Add a YouTube monetization threshold calculator distinguishing Nigeria's expanded YPP entry from full ad-revenue eligibility.
- [x] Add a fail-closed video monetization preflight for rights evidence, original contribution, transformation, repetition, fact review, metadata and required synthetic-media disclosure.
- [x] Add optional authorized YouTube Analytics sync for content-type breakdowns, channel engagement and top videos; TikTok/Instagram metrics remain future work.
- [x] Store YouTube Analytics source, reporting windows and fetched timestamp in the archived snapshot.
- [ ] Separate measured metrics from internal heuristic scores.
- [ ] Build sample-size-aware experiments for hooks, formats, pacing and topics; use outcome data to learn channel-specific strategy.
- [ ] Feed observed outcomes back into discovery and production selection.

## Release rule

A roadmap item is not complete until implemented, tested and its limitations documented. A skill file is not an agent runtime. A repository README is not proof that a capability works. Never report a platform as connected, a video as rendered, or a post as published without successful confirmation from the relevant system/API.

See [AUTONOMOUS_PRODUCT_SPEC.md](AUTONOMOUS_PRODUCT_SPEC.md) and [REPOSITORY_SKILL_AUDIT.md](REPOSITORY_SKILL_AUDIT.md).
