# Autonomous Viral Discovery & Production — Product Specification

## Product intent

This product does not wait for a user to upload a video. It continuously discovers promising video topics, formats and reference examples; researches the subject; creates an original, rights-aware treatment; produces platform-ready video; checks quality; publishes through supported official integrations after one-time account authorization and consent; and learns from available performance data.

The goal is to improve the probability of strong audience retention, completion, shares and saves. Virality is never guaranteed.

This is a standalone personal automation project. It is not Syntheniq and is not a public SaaS product.

## Operating loop

`Discover → Qualify → Research → Rights check → Creative brief → Produce → QC → Package → Publish → Measure → Learn`

### 1. Discovery engine
- Run scheduled discovery jobs over permitted sources and APIs.
- Search for emerging topics, formats, public trend signals, creator discussions and reference videos.
- Store source URL, platform, creator, observed-at time, available public metrics, query provenance and collection method.
- Detect velocity only where repeated observations or permitted metrics make it defensible. A single view count is not “viral momentum”.
- Deduplicate topics and reference items; identify trend lifecycle and saturation.
- Maintain a candidate queue with evidence and confidence, not just a black-box score.

### 2. Qualification and selection
Evaluate:
- audience/topic fit and channel strategy;
- novelty and saturation;
- evidence of current interest;
- whether the concept can deliver a real payoff;
- production cost and feasibility;
- factual/legal/safety risk;
- source-material rights and platform policy;
- likelihood of creating an original, valuable treatment.

Reject weak, stale, misleading, rights-unclear or low-confidence candidates. The system should be able to decide not to publish.

### 3. Research and verification
- Build a fact sheet from primary and reputable sources.
- Verify each material factual claim and record exact source, publication date, access date and supporting passage.
- Separate verified fact, attributed opinion, hypothesis and creative framing.
- Never invent statistics, citations, quotes, identities or events.
- For rapidly changing topics, refresh research immediately before production.

### 4. Rights and provenance gate
- Treat trending videos as references, not automatically reusable footage.
- Prefer original generated visuals, licensed stock/media, public-domain material, user-owned assets, or explicit permission.
- Track asset license, source, allowed platforms, territory, attribution and expiry where applicable.
- Block production/publication if essential assets have unclear rights.
- Never remove watermarks to disguise another creator's work or create a near-identical unauthorized copy.

### 5. Creative strategy
Generate several genuinely different angles and hooks. Select a treatment based on:
- first-second / first-three-second clarity;
- curiosity and a specific promise;
- escalation and information pacing;
- payoff strength and credibility;
- rewatch/share/save value;
- platform-native format and audience expectations.

The hook must be paid off by the actual video. No deceptive bait-and-switch.

### 6. Production engine
Produce an original video, not merely a link list or a clip suggestion:
- script/storyboard and timed edit decision list;
- licensed/owned/generated visuals and B-roll;
- voiceover or original narration when appropriate;
- scene assembly, motion, captions, typography, sound design and transitions;
- platform-specific crops, safe zones, durations and encoding;
- thumbnail/cover and metadata assets.

Keep rendering tool-agnostic behind an adapter. The creative plan should not depend on one vendor. Every asset used must retain provenance.

### 7. Independent quality control
Run automated checks on:
- factual accuracy and citation support;
- hook/payoff alignment;
- narrative coherence and context;
- audio intelligibility and clipping;
- caption transcription/timing;
- visual artifacts, blank frames and unsafe crops;
- rights/provenance completeness;
- platform technical specifications and policy checks.

Repair and rerender when possible. Otherwise reject the candidate and log why. Never equate a vendor score with quality.

### 8. Packaging and publishing
Create platform-specific titles, descriptions, captions, hashtags, cover/thumbnail and disclosure fields. Keep a record of exactly what was sent to each platform.

Publishing must use supported official APIs and respect each platform's consent, review, account-type, media and product requirements. One-time account connection is required. Autonomous scheduling may only be enabled for actions and platforms where the user has expressly configured that behavior and the platform's rules allow it. Some API flows require user-facing confirmation at posting time; the system must stop rather than bypass it.

### 9. Analytics and learning
- Retrieve only metrics made available and permitted by each platform.
- Store platform-reported metrics with source and timestamp; keep our own heuristic scores clearly separate.
- Compare outcomes by topic, hook archetype, edit pattern, duration and posting context only where data is actually available.
- Update selection and production heuristics from observed results, with uncertainty and sample-size awareness.
- Do not claim private retention/watch-time data for other creators if it is not accessible.

## Platform capability constraints

- **YouTube:** Data API supports video upload via `videos.insert`, but API policy requires user consent and final control over publishing values/actions. Do not scrape YouTube pages or applications to collect data. Verify project audit/quota and OAuth requirements before enabling public publishing.
- **TikTok:** Content Posting API has app review/audit and creator UX/consent requirements. TikTok's published guidelines reject apps designed only for private/internal use or simply copying arbitrary platform content. Unverified Direct Post clients can be restricted to private visibility. The product must not promise unattended public posting until eligibility and audit are confirmed.
- **Instagram:** Reels publishing is available through Meta's Instagram APIs for eligible professional accounts and requires correct account linking, permissions and accessible media hosting. Some features (for example licensed trending audio and native controls) may remain app-native rather than API-controlled.

The adapters must expose capability flags and fail closed when a requested action is not supported.

## Initial non-goals
- No automatic copying/reuploading of trending creators' videos.
- No scraping private APIs, browser sessions, or private analytics.
- No guarantee of virality or fixed view counts.
- No automatic publication when rights, factual checks, API permissions or required consent are missing.
- No dependence on a single third-party clipping or generation vendor.

## Proposed runtime modules

- `discovery/`: source connectors, scheduled scans, deduplication, trend observations.
- `research/`: topic research, claim ledger, citation verification.
- `selection/`: candidate evaluation, confidence and rejection reasons.
- `rights/`: asset provenance, license and permission checks.
- `creative/`: angle, hook, script, storyboard and edit-decision generation.
- `production/`: media sourcing/generation, timeline assembly and render adapters.
- `quality/`: editorial, factual, audio, visual and platform validators; repair loop.
- `publishing/`: platform capability registry, OAuth and official API adapters.
- `analytics/`: platform metric ingestion and learning experiments.
- `orchestration/`: durable jobs, retries, idempotency, schedules and audit trail.

## First vertical slice

Build one end-to-end vertical slice before expanding platform coverage:
1. Discover candidates from a compliant, documented source.
2. Select one candidate with explainable evidence.
3. Research and verify the claims.
4. Produce an original short video using licensed/generated assets.
5. Run QC and package it.
6. Save a publish-ready draft and capability report.
7. Add actual publishing only after OAuth/API eligibility and consent requirements are satisfied.

This proves the product's central value before adding many fragile connectors.
