# YouTube growth and monetization operating rules

## What the system optimizes

The goal is sustainable audience growth and eventual YouTube Partner Program eligibility, not an arbitrary upload count or a one-video view spike. The system should prioritize audience satisfaction signals available through approved APIs: retention/average view duration, Shorts viewed-versus-swiped-away, impressions click-through rate where applicable, shares, comments, subscribers gained and returning-viewer trends. Each observation must retain its reporting window and source.

No workflow can guarantee a video will go viral, receive a minimum number of views, or be accepted into YPP. Distribution is controlled by YouTube and audience response.

## Nigeria YPP milestones

Nigeria is listed as eligible for the expanded YPP. Current published thresholds:

- Earlier-access features: 500 subscribers, at least 3 valid public uploads in the last 90 days, and either 3,000 qualified public watch hours in the last 365 days or 3 million qualified public Shorts views in the last 90 days.
- Full ad revenue sharing: 1,000 subscribers and either 4,000 qualified public watch hours in the last 365 days or 10 million qualified public Shorts views in the last 90 days.

Shorts Feed watch time does not count toward the 4,000 long-form watch-hour requirement. Meeting a numerical threshold is not acceptance: YouTube reviews the channel and the channel must satisfy all applicable policies and setup requirements. Check the Earn tab in YouTube Studio for the authoritative channel-specific counter.

## Originality and rights gate

- Do not treat permission or attribution alone as proof that reused content will qualify for monetization.
- A video based on third-party footage must add substantial original commentary, narrative, analysis, education or entertainment value and substantive editing. A superficial crop, caption, compilation or voice swap is not enough.
- Avoid interchangeable mass-produced templates. Each upload needs a distinct concept and real viewer value.
- Track asset source, licence/permission evidence, platform scope and expiry.
- Verify factual claims and metadata; disclose realistic altered or synthetic media when YouTube requires it.
- Block a package from publication when rights, originality, disclosure or factual review is unresolved.

## Authentic growth only

Never buy views, likes, comments or subscribers; use engagement exchanges; run bots; or post repetitive comments. Never fabricate engagement. The system may reply to genuine comments only through an approved integration and must not impersonate viewers or spam.

## Daily operating loop

1. Discover and compare current topic/video opportunities across permitted sources.
2. Rank opportunities for the target channel using observed momentum, audience fit, freshness, originality potential and rights availability.
3. Produce a distinct editorial concept and verify claims.
4. Acquire/generate only rights-cleared media and preserve provenance.
5. Render, inspect audio/video, verify captions and factual accuracy, and run the monetization preflight.
6. Publish through the channel owner's approved OAuth connection and configured schedule only after all gates pass.
7. Collect approved analytics, compare results against that channel's baseline, and run controlled creative experiments.
8. Update channel strategy and YPP progress using actual platform-reported metrics.

## Current implementation boundary

The repository currently has discovery, a daily opportunity planner, an initial YPP threshold calculator, a content preflight helper and performance/experiment calculations. It does not yet have a connected channel OAuth session, YouTube Analytics data ingestion, durable per-channel database, unattended upload scheduler or verified end-to-end publish flow. Those are required before describing the system as operating a channel end to end.

## Required account setup before live operation

- The channel owner must authorize YouTube OAuth for upload and analytics scopes.
- Store refresh tokens only in protected GitHub Actions secrets or a dedicated secret store, never in repository files or workflow artifacts.
- Configure the channel identity, timezone, target cadence, privacy defaults and allowed publish windows.
- Complete Google account 2-Step Verification, advanced-features access and AdSense setup as required in YouTube Studio.
- Keep automatic public publishing disabled until the owner explicitly enables it for that connected channel after a successful private/unlisted test upload.

## Official policy and API references

- YouTube Partner Program eligibility and application: https://support.google.com/youtube/answer/72851
- YouTube channel monetization policies, including reused and inauthentic content: https://support.google.com/youtube/answer/1311392
- YouTube fake engagement policy: https://support.google.com/youtube/answer/3399767
- YouTube Data API video upload endpoint: https://developers.google.com/youtube/v3/docs/videos/insert
- YouTube Analytics API reports query: https://developers.google.com/youtube/analytics/reference/reports/query
