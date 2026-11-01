# Roadmap

## Phase 0 — Foundation
- [x] Create a standalone Node.js 22 project.
- [x] Add health and platform-readiness endpoints.
- [x] Keep secrets out of source control.
- [x] Default to human approval before publishing.

## Phase 1 — Product and API capability audit
- [ ] Verify current official API capabilities and eligibility requirements for YouTube, Instagram, and TikTok.
- [ ] Document OAuth scopes, review requirements, media limits, rate limits, and supported publishing formats.
- [ ] Define exactly which actions each platform adapter can safely support.

## Phase 2 — Core content workflow
- [ ] Content ideas and research records with source references.
- [ ] Script and asset-plan generation.
- [ ] Platform-specific packaging.
- [ ] Draft status, revisions, and approval history.

## Phase 3 — Platform connections
- [ ] Implement official OAuth flows independently for each platform.
- [ ] Secure token storage and revocation handling.
- [ ] Verify connected account identity and granted scopes.
- [ ] Add adapter-level tests and mock API tests.

## Phase 4 — Publishing
- [ ] Upload/publish only where the official API and account permissions allow it.
- [ ] Enforce explicit approval before every publish action.
- [ ] Add retries, idempotency, rate-limit handling, and audit logs.

## Phase 5 — Analytics and optimization
- [ ] Collect available platform analytics.
- [ ] Compare performance by content format and topic.
- [ ] Use observed results to inform future recommendations.

## Release rule

A roadmap item is not complete until it is implemented, tested, and its limitations are documented. Never report a platform as connected or a post as published without confirmation from the platform API.
