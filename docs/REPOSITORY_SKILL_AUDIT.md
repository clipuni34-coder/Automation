# Upstream Skill Repository Audit

Reviewed on 2026-11-01. This is a capability audit, not a claim that the repositories have been installed or that their claims have been independently benchmarked. All seven named repositories and the broader social-media skill catalogue are treated as upstream reference material. Their skills are instructions and workflows; they are not, by themselves, an autonomous production runtime.

## Repositories reviewed

| Repository | License reported by GitHub | Useful capabilities | Gaps for this product |
|---|---|---|---|
| [sergebulaev/tiktok-skills](https://github.com/sergebulaev/tiktok-skills) | MIT | TikTok hook writing, trend mapping, content planning, audience insights, captions, repurposing. Trend mapper includes fit/saturation checks and a skip decision. | README explicitly says user supplies video; skills write supporting words, do not generate/edit video. Uses Apify for some niche/trend data and Publora for publishing. |
| [sergebulaev/instagram-skills](https://github.com/sergebulaev/instagram-skills) | MIT | Instagram hooks, captions, carousel planning, hashtag strategy, profile/audience insights, repurposing. | Marketing/content-planning workflow, not an autonomous source-video discovery and editing engine. Publora/approval workflow dependency in README. |
| [vyralcontent/content-skills](https://github.com/vyralcontent/content-skills) | MIT | Short-form hook archetypes, hook critique, retention structures, platform adaptation, captions/CTAs and idea generation. Explicitly says patterns improve odds, do not predict virality. | Primarily creative instructions; no continuous discovery, media acquisition, render engine, or autonomous publisher. |
| [artemchuikin/youtube-skills](https://github.com/artemchuikin/youtube-skills) | MIT (repository metadata) | YouTube search, channel/video data, transcripts, subtitles, playlists and API-oriented research. | TranscriptOut/API dependency for some transcript paths; research/data retrieval, not production or end-to-end publishing. |
| [aronhy/tiktok-agent-skills](https://github.com/aronhy/tiktok-agent-skills) | Verify exact license before importing individual files | TikTok account audit, category strategy, growth planning, lead generation, ads and Shop operations. | Business/marketing operations rather than viral-video discovery/editing. Some workflows require KSS MCP and account/business data. |
| [Jakeschincariol/youtube-agent-skill](https://github.com/Jakeschincariol/youtube-agent-skill) | MIT | YouTube planning, scripts, title/thumbnail packaging, edit decision lists, retention review, Shorts and virality critique. | Agent skills are editorial guidance. Need actual discovery sources, media rights handling, renderer, orchestration, API integration and QC. |
| [Jakeschincariol/instagram-agent-skill](https://github.com/Jakeschincariol/instagram-agent-skill) | MIT | Instagram Reels hooks, viral research, captions, humanization, repurposing and account workflows. | Not a full video factory or independent trend-data source; review/publishing expectations remain in the skill workflows. |
| [social-media-skills/skills](https://github.com/social-media-skills/skills) | MIT | Broad catalogue including audience research, content sourcing, competitor analysis, AI video routing, clipping, Opus Clip, platform specs, scheduling and analytics. | Catalogue is heterogeneous. The inspected AI-video and Opus Clip skills explicitly hand generation/editing or human review to other tools/people; WoopSocial is referenced for publishing. Must select specific skills, not import all 106 blindly. |

## Particularly relevant findings from inspected skill files

- TikTok trend mapping recommends a trend only when niche fit, freshness, native structure and a distinctive twist all pass. It explicitly recommends skipping stale or forced trends.
- The short-form umbrella skill recommends diverse hooks, hook → escalation → payoff → CTA, platform adaptation, and honest claims: no promise of virality.
- TikTok repurposing preserves the source idea but rewrites delivery for the target platform; it warns against inventing figures, dates, names or results.
- The content-research-and-sourcing skill uses a source hierarchy and verifies load-bearing claims against primary sources. We should adopt claim-level evidence records and reject fabricated citations.
- The Opus Clip skill treats virality scores as triage, not truth; it describes human review and out-of-context risk. Our system should independently QC meaning and context, not blindly trust a vendor score.
- The AI-video skill is a router/brief, not a renderer. It expects other tools to generate and a human to assemble.
- The Instagram publishing skill distinguishes media production from platform-native features such as licensed trending audio and some in-app controls.

## What to reuse

1. Hook archetypes, hook scoring rubrics and hook diversity from Vyral + YouTube/Instagram agent skills.
2. Trend-fit and trend-lifecycle checks from TikTok trend mapper.
3. Claim verification, source hierarchy and provenance from content-research-and-sourcing.
4. Retention structures, edit-decision-list concepts and packaging checks from the YouTube agent skills.
5. Platform-specific metadata, safe-zone and media validation checklists from the social-media skill catalogue.
6. Analytics interpretation as a learning signal, with strict separation between platform-reported metrics and our own derived heuristics.

## What not to do

- Do not treat an SKILL.md file as executable code or as a deployed agent.
- Do not blindly install overlapping skills or inherit their external SaaS/MCP requirements.
- Do not download/repost arbitrary creators' videos. Discovery may identify a trend or reference; production must use owned, licensed, public-domain, permissioned or otherwise lawfully reusable source material. A reference video should inform an original treatment, not become an unauthorized copy.
- Do not scrape private endpoints, bypass rate limits, remove attribution/watermarks to disguise provenance, or automate platform UI against platform rules.
- Do not use a single “virality score” as a guarantee or publish threshold. Score evidence and uncertainty separately.

## Conclusion

These repositories provide useful editorial knowledge, platform-specific practices and research checklists. They do **not** provide the central product the user asked for: a continuously operating system that independently discovers promising subjects and lawful source material, decides what original content to make, creates/render videos, validates them, publishes where official APIs permit, and learns from results. That runtime must be built in this repository.
