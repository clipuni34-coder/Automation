# Automation build status

Last reviewed: 2026-11-01  
Working branch: `autonomous-viral-discovery`

## Working and tested

- YouTube discovery uses the official Data API: regional/category most-popular charts plus bounded keyword searches for recent videos. Keyword results are references only, not reusable media.
- Tavily research creates dossiers and extracts source passages. Search excerpts and model assessments remain advisory; factual claims are not automatically marked verified.
- Gemini creative generation has a Gemini 3.5 Flash-Lite fallback when Gemini 3.8 Flash reaches its daily request quota. Scheduled runs create one English-language brief per run to reduce quota pressure; discovery runs only on the daily schedule or manual dispatch, not on code pushes.
- Gemini TTS adapter now falls back once to the Lite TTS model on primary quota errors; Gemini Nano Banana 2.1 image-generation adapter is implemented. Both are covered by mocked tests.
- FFmpeg renderer produces vertical 1080x1920 H.264/AAC MP4s and independently probes output. It can preserve source-video audio and mix it with narration.
- Original-video production command connects narration, up to six storyboard visuals, rendering, QC and a platform-specific draft package.
- Standalone re-edit and creator-compilation planners rank moments, preserve source timestamps, enforce rights evidence and can create render manifests for locally available authorized media.
- Creator clips without approved rights status, evidence and target-platform permission are blocked at render time.
- Publishing-package generation creates YouTube Shorts, TikTok and Instagram Reels draft copy, hashtags, hook options, thumbnail reference and stock-footage credits.

## Live verification

- GitHub Actions discovery run `41270593093` completed successfully: YouTube discovery, Tavily research and one English-language creative brief were generated. The brief was titled “Why Are Some Catchers Giving Free Passes to Second Base?” and included a 45-second script, five visual scenes and two claims flagged for verification.
- Earlier successful discovery run `41270396012` generated three research dossiers and three creative briefs. No MP4 was rendered because production was not opted in.
- GitHub Actions test run `41270655201` passed 66/66 tests, including FFmpeg integration tests for real video and source-audio mixing.
- Live Gemini image generation and TTS have not yet been verified end-to-end with the user's API quota.

## Not finished yet

- TikTok and Instagram discovery adapters using approved platform access.
- Authorized creator-media intake/storage. Public YouTube/TikTok/Instagram URLs are not automatically downloaded or republished.
- Automated transcription and visual/audio moment detection for authorized creator videos.
- Compilation commentary timing and more advanced edit treatments.
- Full word-level captions, sound design, A/B MP4 variants and deeper editorial QC.
- Platform OAuth integrations, publishing approvals and performance analytics/learning.
- A persistent user-facing dashboard/upload workflow.

## Production safety

Video rendering is opt-in. Set the repository variable `PRODUCE_VIDEOS=true`, or manually run the Discovery scan workflow with `produce_videos=true`. Gemini image/TTS use may consume quota or incur charges depending on the Google AI project tier. Platform publishing remains disabled.
