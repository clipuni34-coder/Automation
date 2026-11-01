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
- [ ] Define source connector contracts and allowed collection methods.
- [ ] Implement first compliant discovery source (public API/feed/search provider).
- [ ] Store observations with timestamps, provenance and permitted metrics.
- [ ] Deduplicate candidates and calculate evidence-backed trend velocity.
- [ ] Add candidate qualification, saturation and rejection reasons.

## Phase 3 — Research and editorial intelligence
- [ ] Implement claim ledger and primary-source verification.
- [ ] Generate multiple creative angles and hooks.
- [ ] Build retention-aware script/storyboard and timed edit decision list.
- [ ] Add rights/provenance checks for every media asset.
- [ ] Keep predictions and confidence separate from observed facts.

## Phase 4 — Original video production
- [ ] Select renderer and media-generation/sourcing adapters after capability/cost tests.
- [ ] Build timeline assembly, voiceover, captions, B-roll, motion and sound design.
- [ ] Render platform-specific outputs.
- [ ] Add independent editorial, factual, audio, visual and technical QC.
- [ ] Implement repair/rerender or reject loop.

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
