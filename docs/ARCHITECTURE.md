# Architecture

## Product boundary

This is a standalone personal automation project for YouTube, Instagram, and TikTok. It is not part of Syntheniq and is not designed as a public SaaS product.

## Planned pipeline

1. **Research and ideas** — gather topic candidates and source material.
2. **Strategy** — choose audience, format, angle, and platform fit.
3. **Verification** — check factual claims and retain source references.
4. **Scripting** — create platform-appropriate scripts and shot/asset plans.
5. **Production** — assemble approved media and creative assets.
6. **Packaging** — titles, descriptions, captions, hashtags, and thumbnails where supported.
7. **Quality control** — validate media, metadata, policy constraints, and destination account.
8. **Approval** — require an explicit human approval before publication by default.
9. **Publishing** — send through the relevant official platform API adapter.
10. **Analytics and learning** — collect permitted performance metrics and feed them into future planning.

## Boundaries

- Each platform gets its own adapter; do not assume the three platforms expose identical features.
- Use official APIs and OAuth scopes only. Do not scrape private endpoints, automate around platform restrictions, or bypass rate limits.
- A platform is `not_configured` until its OAuth flow and account check succeed.
- Publishing is disabled until the adapter, permission checks, media validation, and approval gate are implemented and tested.
- Secrets belong in environment configuration or a managed secret store, never in Git.

## Initial implementation

The first server uses Node.js built-ins to keep the base small. It provides health and integration-readiness endpoints only. It does not yet authenticate users, store content, or publish posts.
