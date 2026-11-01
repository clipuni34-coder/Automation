# Automation build status

Last reviewed: 2026-11-01  
Working branch: `autonomous-viral-discovery`

## Working and tested

- An autonomous daily editorial planner now ranks unique discovery candidates, assigns provisional content formats (gaming, creator moments, sports, food, rankings/explainers, funny/surprising moments and general story explainers), explains selection evidence, and produces a short recommendation list plus a backlog. It deliberately leaves channel niches unselected until research supports a decision.
- The daily planner preserves source provenance and explicitly marks public creator videos as research references unless a separate rights status is verified. It is deterministic and does not require an LLM API call.\n- YouTube monetization helpers calculate expanded-YPP and full ad-revenue threshold progress separately, apply a rights/originality/repetition/factual-review preflight, and generate experiment suggestions from actual performance metrics.\n- Official YouTube OAuth token refresh, resumable video upload and processing-status polling are implemented behind strict opt-in and package approval gates.\n- Official YouTube Analytics report retrieval is implemented for Shorts and long-form windows plus top videos. Scheduled sync is optional and archives a metrics snapshot; no account is connected yet.

- Scheduled discovery now also samples public Google Trends Trending Now RSS feeds for NG, US, GB, IN, ZA, CA and AU; these are limited search-interest signals, not a full Trends API or video virality measure.\n- YouTube discovery uses the official Data API: regional/category most-popular charts plus bounded keyword searches for recent videos. Keyword results are references only, not reusable media.
- Tavily research creates dossiers and extracts source passages. Search excerpts and model assessments remain advisory; factual claims are not automatically marked verified.
- Gemini creative generation has a Gemini 3.5 Flash-Lite fallback when Gemini 3.8 Flash reaches its daily request quota. Scheduled runs create one English-language brief per run to reduce quota pressure; discovery runs only on the daily schedule or manual dispatch, not on code pushes.
- Gemini TTS adapter now falls back once to the Lite TTS model on primary quota errors; Gemini Nano Banana 2.1 image-generation adapter is implemented. Both are covered by mocked tests.
- FFmpeg renderer produces vertical 1080x1920 H.264/AAC MP4s and independently probes output. It can preserve source-video audio and mix it with narration.
- Original-video production command connects narration, up to six storyboard visuals, rendering, QC and a platform-specific draft package.
- Standalone re-edit now has an end-to-end CLI path: rights validation → timed transcript scoring → best-moment selection → 9:16 FFmpeg render → ffprobe QC. The CLI retains source audio when present and has a real CI fixture test.
- Ranked creator compilations now render local rights-cleared media through the CLI, preserve source audio, add supplied intro/outro as opening/closing captions, and have a real CI fixture test.
- Creator clips without approved rights status, evidence and target-platform permission are blocked at render time.
- Publishing-package generation creates YouTube Shorts, TikTok and Instagram Reels draft copy, hashtags, hook options, thumbnail reference and stock-footage credits.

## Live verification

- GitHub Actions discovery run `41270593093` completed successfully: YouTube discovery, Tavily research and one English-language creative brief were generated. The brief was titled “Why Are Some Catchers Giving Free Passes to Second Base?” and included a 45-second script, five visual scenes and two claims flagged for verification.
- Earlier successful discovery run `41270396012` generated three research dossiers and three creative briefs. No MP4 was rendered because production was not opted in.
- GitHub Actions test run `41270655201` passed 66/66 tests, including FFmpeg integration tests for real video and source-audio mixing.
- Live Gemini image generation and TTS have not yet been verified end-to-end with the user's API quota.

- Authorized local-media re-edit now has a single end-to-end CLI path: rights gate → timed transcript scoring → strongest-moment selection → vertical MP4 render → ffprobe QC. CI includes a real FFmpeg fixture test, including preservation of source audio.

## Not finished yet
- The new strategy planner is a first editorial-decision slice, not yet a self-improving channel strategist: it does not yet ingest channel analytics, measure trend saturation over longer windows, or learn from published-post outcomes.

- TikTok and Instagram discovery adapters using approved platform access.
- A user-facing authorized creator-media upload/intake and secure storage flow. Current re-edit/compilation CLIs accept local media paths; public YouTube/TikTok/Instagram URLs are not automatically downloaded or republished.
- Automated transcription and visual/audio moment detection for authorized creator videos. Current re-edit CLI requires timed transcript segments and editorial signals as input.
- Spoken compilation commentary timing and more advanced edit treatments. Current intro/outro are on-screen captions, not generated speech.
- Full word-level captions, sound design, A/B MP4 variants and deeper editorial QC.
- Live channel OAuth consent/credential setup, end-to-end upload testing, channel identity validation, approval automation and persistent analytics learning.
- A persistent user-facing dashboard/upload workflow.

## Production safety

Video rendering is opt-in. Set the repository variable `PRODUCE_VIDEOS=true`, or manually run the Discovery scan workflow with `produce_videos=true`. Gemini image/TTS use may consume quota or incur charges depending on the Google AI project tier. Platform publishing remains disabled.
