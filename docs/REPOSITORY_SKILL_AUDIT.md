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


## Additional repositories reviewed (2026-11-01)

| Repository | License | What it actually contributes | Fit / limitations |
|---|---|---|---|
| [darkzOGx/youtube-automation-agent](https://github.com/darkzOGx/youtube-automation-agent) | MIT | Most complete end-to-end YouTube reference found so far: topic research, strategy, script, narration, images/video providers, local MP4 assembly, SEO, scheduler, YouTube upload, analytics, resumable jobs, evidence desk and scene repair. Node.js app with dashboard and multiple provider adapters. | Strong candidate for architectural study and selective code reuse. It is YouTube-first, self-hosted, and explicitly approval-gated; its “autonomous operator” still waits for review/approval before publication. Slideshow is the local default; generated video needs configured providers and may cost money. It does not solve broad cross-platform trend discovery by itself. |
| [Agent-Field/reels-af](https://github.com/Agent-Field/reels-af) | Apache-2.0 | Topic/article-to-Reel production: parallel hunter → critic → narrator → judge reasoning cascade, script beats, TTS, image generation, motion, karaoke captions, FFmpeg stitching, JSON sidecar and async AgentField orchestration. | Strong candidate production subsystem for original topic-based short videos. README claims ~80 seconds and ≈$0.10 default still-image/ken-burns path; treat as maintainer estimates, not independently benchmarked. Default is still-image motion, not fully generated moving footage; video-generation mode costs more. Does not discover trends continuously or publish to social platforms. |
| [Upload-Post/skill-autoshorts](https://github.com/Upload-Post/skill-autoshorts) | License needs confirmation from repository metadata/files before copying | Whisper word-level timestamps + Gemini full-video multimodal review for candidate clip boundaries; FFmpeg extraction, hook overlay, Upload-Post distribution, daily processing skill. | Not the autonomous discovery model: README explicitly requires videos to be sent/dropped into an input folder and expects near-final 9:16 footage with subtitles optionally already burned in. It only cuts and overlays a hook; it does not reformat, crop or burn subtitles. Its workflow asks the user to select clip IDs before publishing. Useful as a reference for multimodal clip selection and timestamp discipline, but not a core solution for the requested no-upload/no-touch workflow. |

### New architectural implications

1. **Study darkzOGx as the channel-operations backbone**, but do not copy it wholesale before reading its actual modules, feature guide, security posture, and tests. Reconcile its approval-first model with our desired unattended mode only where platform policies and user-granted permissions allow it.
2. **Evaluate reels-af as a specialist video-production engine** behind a provider adapter. Its topic → original script → narrated illustrated Reel path is especially relevant when discovery yields a topic rather than a reusable source video.
3. **Borrow the multimodal timing idea from autoshorts**, not its input assumptions: use word-level transcription plus visual/audio scene understanding for timing and context, but our discovery engine must find the subject and source material itself.
4. Keep discovery, content production and publishing decoupled. A trend/reference discovery connector should never imply rights to reuse the referenced video.
5. Before adoption, inspect source modules, dependency trees, CI/tests, license/NOTICE, environment secrets, outbound network behavior, subprocess use, file writes and API calls. Run imported code in an isolated test environment first.
