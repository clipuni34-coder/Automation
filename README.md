# Social Media Automation

A standalone personal automation workspace for discovering opportunities, researching topics, producing original videos, reviewing, publishing, and learning across YouTube, Instagram, and TikTok.

This repository is independent of Syntheniq.

## Principles

- Discover topics and reference videos; do not automatically copy/reupload creators' work.
- Use official platform APIs and documented feeds/access methods.
- Keep platform credentials out of source control.
- Keep manual publishing approval enabled by default.
- Record provenance, timestamps and the difference between measured facts and heuristic scores.
- Never claim that a trend is accelerating from a single observation.

## Requirements

- Node.js 22 or later
- npm

## Run the service

```bash
cp .env.example .env
npm install
npm run dev
```

The service currently exposes:
- `GET /health` — process health
- `GET /api/platforms` — integration readiness (not a claim that any account is connected)

## First discovery engine slice

The discovery CLI currently samples YouTube's most-popular charts through the official YouTube Data API v3 across 12 regions (US, GB, CA, AU, IN, NG, ZA, BR, MX, DE, JP and KR) and 15 category IDs spanning film, autos, music, pets, sports, travel, gaming, people/blogs, comedy, entertainment, news, how-to, education, science/technology and nonprofits. It makes up to 180 chart requests per scan, deduplicates videos found in multiple regions/categories, and records coverage metadata. The region/category lists can be overridden with `DISCOVERY_REGIONS` and `DISCOVERY_CATEGORIES`. This is a broad sample of popular-chart videos, not every video uploaded to YouTube or every country.

It also collects public RSS/Atom feeds listed in `RSS_FEEDS` (comma-separated), when configured.

Run it:

```bash
npm run discover
```

The engine stores observations and ranked candidates in `data/discovery.json` (ignored by Git). Run it repeatedly to build historical observations. Only then can it estimate view velocity for YouTube videos that remain observable across scans. RSS entries currently provide topic/reference discovery, not engagement velocity.

Candidate scores are transparent heuristics, not predictions of virality. First-seen candidates receive low confidence because their growth rate is unknown. RSS/video links are references for research, not automatically reusable media.

### YouTube API setup

1. Create a Google Cloud project.
2. Enable YouTube Data API v3.
3. Create an API key and set `YOUTUBE_DATA_API_KEY` in your deployment environment.
4. Set `DISCOVERY_REGIONS=US,GB,CA,AU,IN,NG,ZA,BR,MX,DE,JP,KR` and optionally `DISCOVERY_CATEGORIES=1,2,10,15,17,19,20,22,23,24,25,26,27,28,29`.

YouTube's `videos.list` `mostPopular` chart is sampled by region and category. This does not cover all uploads, private/unlisted videos, or all regional trends. Optional keyword/creator-oriented YouTube search is now available through the official Search and Videos APIs. Set `DISCOVERY_SEARCH_QUERIES` to up to five terms separated by `|`; the scheduled workflow uses five broad recent-video searches by default. Search results are reference-only and cannot be downloaded/reused through this connector. Each `search.list` call consumes substantially more quota than a `videos.list` chart request, so keep the query list bounded. TikTok and Instagram discovery connectors remain future work.

### Keyword and creator search setup

The scheduled workflow runs five bounded YouTube searches for recent viral/funny, reaction, gaming, sports and real-life moments. Override these in GitHub repository Settings → Secrets and variables → Actions → Variables by adding `DISCOVERY_SEARCH_QUERIES`, with up to five search terms separated by `|`. Searches default to videos published in the last 30 days and sort by view count; this is a discovery heuristic, not proof of virality. YouTube search results are references only.

### RSS setup

Set `RSS_FEEDS` to comma-separated public feed URLs, for example feeds from reputable publishers and topic-specific sources you choose. Only use feeds whose access terms permit this use.

## Tests

```bash
npm test
```

## Project status

The discovery foundation has completed live YouTube chart scans. A deterministic daily editorial planner now turns the discovery store into ranked, deduplicated content opportunities, provisional format choices, creative angles, source provenance and a next-up backlog. It is wired into the scheduled Discovery scan workflow and saves a `daily-editorial-plan` artifact. This is an initial strategy layer: it does not yet learn from channel analytics or publish posts. Tavily research collects source excerpts and bounded page extractions; AI claim-to-source assessments are advisory only and never mark claims verified. A first FFmpeg renderer now assembles still-image and licensed live-action video scenes with timed captions, narration audio, and H.264/AAC vertical MP4 output. A Pixabay adapter can search and download real footage while retaining the Pixabay page, creator credit, and license metadata. Gemini TTS narration is implemented. Rights-aware standalone re-edit and ranked creator-compilation planners now produce edit decision lists, and creator clips are blocked at render time unless rights evidence and platform scope are present. Automated transcript/visual moment detection, authorized creator-media intake, direct planner-to-render integration, advanced editing, deeper semantic/editorial QC, publishing and analytics remain future work. Each rendered video now receives a heuristic storyboard review (scene variety, pacing, caption density and still-image holds) plus FFmpeg black-frame/freeze inspection; a machine-readable quality report is saved with the production output. This report catches technical/editorial warning signs but does not judge humour, story relevance, factual accuracy or virality. See [the roadmap](docs/ROADMAP.md).


## Daily autonomous editorial plan\n\nEvery scheduled discovery run now calls `npm run daily-plan` after collection. It writes `data/strategy.json` with up to five ranked recommendations and a ten-item backlog. The plan uses observed discovery scores, freshness, engagement, velocity and confidence; it avoids claiming virality from a single observation. It assigns temporary content formats without committing to channel niches, and labels discovered creator footage as reference-only unless separate rights evidence exists. The workflow archives this plan as a 14-day `daily-editorial-plan` artifact.\n\nRun it locally after discovery with `npm run daily-plan`.\n\nThis first slice does not yet provide durable long-term hosted storage, channel analytics learning, cross-platform TikTok/Instagram discovery, or automatic publishing.\n\n## First video renderer slice

The renderer requires a narration audio file and a storyboard manifest with one still image per scene. Assets must be original graphics or generated visuals, or carry a source URL and license label for public-domain/licensed material. Reference creator footage is not accepted as a reusable asset by default.

Example manifest:

```json
{
  "outputPath": "output/short.mp4",
  "audioPath": "assets/narration.wav",
  "scenes": [
    {
      "imagePath": "assets/scene-01.png",
      "start": 0,
      "end": 5,
      "caption": "An opening line that earns attention.",
      "sourceType": "original_graphic"
    },
    {
      "imagePath": "assets/scene-02.png",
      "start": 5,
      "end": 12,
      "caption": "Build the explanation before the payoff.",
      "sourceType": "licensed_stock",
      "sourceUrl": "https://example.org/asset",
      "license": "License name and permitted use"
    }
  ]
}
```

Run with Node.js 22+ and FFmpeg (including the subtitles/libass filter):

```bash
npm run render -- render-manifest.json
```

The current renderer outputs 1080×1920, 30fps, H.264 video, AAC audio, and fast-start MP4. It applies a restrained zoom to still images, burns scene-level captions, and checks codec, dimensions and duration with ffprobe. Captions currently follow storyboard scene timings; word-level karaoke timing is not implemented. Narration must already exist as an audio file; text-to-speech and automatic asset acquisition/generation are not yet implemented. This is a tested renderer component, not yet an autonomous end-to-end video producer.


## Real human footage support

The production layer now accepts either a still image or an actual video file for each storyboard scene. The Pixabay adapter searches the official Pixabay video API for portrait live-action footage, retains creator/provider attribution and the Pixabay License label, and downloads only HTTPS video files hosted on Pixabay subdomains with a configurable size cap. The renderer trims and crops video scenes into the vertical timeline and overlays the same timed captions and narration track.

Configure `PIXABAY_API_KEY` as a GitHub Actions secret or runtime environment variable. Pixabay currently states that new API-key issuance is paused, so this integration is implemented but cannot be live-tested until an API key is available. Pixabay also requires a prominent link to Pixabay and recommends creator attribution; production packages must preserve and display those credits. The Pixabay API is not a source of permission to reuse arbitrary viral creator videos: reference videos remain analysis-only unless separate rights are established.


## Real human footage support

The production layer now accepts either a still image or an actual video file for each storyboard scene. The Pixabay adapter searches the official Pixabay video API for portrait live-action footage, retains creator/provider attribution and the Pixabay License label, and downloads only HTTPS video files hosted on Pixabay subdomains with a configurable size cap. The renderer trims and crops video scenes into the vertical timeline and overlays the same timed captions and narration track.

Configure `PIXABAY_API_KEY` as a GitHub Actions secret or runtime environment variable. Pixabay currently states that new API-key issuance is paused, so this integration is implemented but cannot be live-tested until an API key is available. Pixabay also requires a prominent link to Pixabay and recommends creator attribution; production packages must preserve and display those credits. The Pixabay API is not a source of permission to reuse arbitrary viral creator videos: reference videos remain analysis-only unless separate rights are established.


## Viral standalone re-edits and creator compilations

Two additional editorial planners are available:

- `npm run reedit -- reedit-input.json` builds a standalone viral-video re-edit decision list from timed transcript segments. It ranks hook, emotion, curiosity, payoff and clarity signals, selects non-overlapping moments within a target duration, and emits cut timestamps, caption text and edit treatments. A public reference-only video can produce an analysis-only plan; it cannot pass the renderer's rights gate.
- `npm run compile-clips -- compilation-input.json` builds a ranked multi-creator/multi-source compilation plan. It requires original intro and outro commentary and checks each clip's documented permission/license, permitted platform and expiry. It rejects unapproved clips rather than silently using them.

For third-party creator footage, a usable source record must include `rightsStatus` (`permission_granted`, `licensed`, `public_domain`, or `owned_by_user`), an HTTPS `sourceUrl`, `allowedPlatforms`, and a `rightsEvidenceReference` or `rightsEvidenceUrl` for permission/license-based use. The renderer now blocks `creator_clip` scenes without this evidence. A source URL, public availability, creator credit, or an edit alone is not proof of permission. Platform-specific rights and copyright exceptions still require case-by-case review.

These planners currently produce edit/compilation plans, not automatically downloaded creator footage or final edited MP4s. YouTube Data API metadata is used for discovery/reference only; it does not provide a general video-download capability. The next production work is authorized media intake, transcript/visual moment detection, plan-to-render integration, word-level captions, sound design and independent QC.

Example standalone re-edit input:

```json
{
  "source": {
    "sourceUrl": "https://media.example/authorized-source.mp4",
    "durationSeconds": 120,
    "rightsStatus": "licensed",
    "rightsEvidenceReference": "license-record-123",
    "allowedPlatforms": ["youtube_shorts"]
  },
  "targetDurationSeconds": 35,
  "transcriptSegments": [
    { "start": 18, "end": 25, "text": "The surprising reveal", "signals": { "hook": 8, "emotion": 9, "curiosity": 8, "payoff": 9, "clarity": 8 } }
  ]
}
```

Example compilation input must contain at least two individually cleared clips plus original `introCommentary` and `outroCommentary`.

## End-to-end original video production

A complete original-video production command now connects the creative brief, Gemini narration, Gemini-generated 9:16 storyboard images (Nano Banana 2.1), and FFmpeg rendering:

```bash
npm run produce -- research-topic.creative.json output/research-topic
```

The command generates narration first, measures its actual duration, creates up to six original visual scenes with model/prompt provenance, builds a render manifest, renders the vertical MP4, probes the output, and saves a publishing package with YouTube Shorts, TikTok and Instagram Reels draft captions, hashtags, hook options, thumbnail reference and stock-footage credits. It also rejects Pixabay clips whose tags do not sufficiently overlap the planned scene, then samples one midpoint frame per rendered scene and asks OpenAI's vision model to compare the actual frame with its planned visual/narration context (`OPENAI_API_KEY`). Scene-level findings are written to `quality-report.json` and copied into the publishing package. Missing vision credentials or failed/mismatched checks force a `review` status; a clean technical render alone cannot pass semantic QC. This is a fallible sampled-frame check, not frame-by-frame verification or proof of factual accuracy. The workflow now fails if a video production command itself fails, while retaining any available artifacts for inspection. If Gemini image generation fails and `PIXABAY_API_KEY` is configured, the visual adapter can fall back to Pixabay licensed stock footage. Generated visuals are illustrative, not evidence of real events or real people, and carry Google's SynthID watermark. Source-video audio is retained where present and mixed below narration; use `preserveSourceAudio: false` in a render manifest to disable it.

The creative provider now switches to Gemini 3.5 Flash-Lite if Gemini 3.8 Flash hits its daily quota, then falls back to OpenAI only if an OpenAI key is configured. The scheduled workflow researches up to three candidates but creates only one creative brief per daily run to conserve model quota. Discovery runs only on its daily schedule or when manually dispatched; code pushes run tests without consuming discovery API quota. Creative output defaults to English; set the optional `CREATIVE_LANGUAGE` repository variable to change it. The scheduled workflow does not spend image/TTS quota automatically by default. To opt in, either add a GitHub Actions repository **variable** named `PRODUCE_VIDEOS` with value `true`, or manually run the **Discovery scan** workflow and set its `produce_videos` input to `true`. The workflow will then render available briefs and upload MP4s plus production packages as a 14-day artifact. Gemini text, image and TTS API usage have separate model/project limits and may consume free-tier quota or incur charges depending on the Google AI plan; check the current rate limits and pricing before enabling unattended production. Publishing remains disabled and requires separate platform integration and approval.

## Automatic narration

A Gemini 3.8 TTS adapter now converts the exact creative-brief script into WAV narration. It supports a directed speaking style and a selected built-in voice, validates the returned WAV signature, and stops immediately on quota exhaustion rather than burning requests through repeated model retries. The primary model is `gemini-3.8-flash-tts`; the Lite model is tried only when the primary model is unavailable. Both calls use the configured `GEMINI_API_KEY`.

Run it against a generated creative brief:

```bash
npm run voice -- research-topic.creative.json output/narration.wav
```

Provider request and failure paths are covered by mocked tests; a live synthesis run still depends on available Gemini TTS quota. This produces AI narration, not a cloned human voice. The video can still use real human footage as its visuals.

## Project status and platform access

See [verified build status](docs/STATUS.md) for live checks and remaining blockers. Social publishing prerequisites and official OAuth requirements are listed in [platform access](docs/PLATFORM_ACCESS.md).


## Authorized viral-video re-edit: local end-to-end path

The new `npm run reedit-render -- input.json` command connects rights validation, timed-moment ranking, cut selection, FFmpeg rendering and output probing. It takes a **local source video that the user owns or has permission to edit**, plus a timed transcript with editorial signals. It creates a silent audio bed only as a technical input; original source audio is retained when present. Output is a 1080×1920 H.264/AAC MP4 with captions and source provenance.

Required input fields: `sourceLocalPath`, `outputPath`, `source` (HTTPS source URL, duration, approved `rightsStatus`, evidence reference/URL and `allowedPlatforms`), and `transcriptSegments` (start/end/text and optional 0–10 hook, emotion, curiosity, payoff and clarity signals). The command rejects reference-only YouTube/TikTok/Instagram discoveries. YouTube Data API returns metadata, not downloadable video bytes; this workflow intentionally does not scrape or bypass platform access controls. The source file and evidence must be supplied through a permitted/authorized route.

Run `npm run reedit-render -- authorized-reedit-input.json`. A real FFmpeg end-to-end fixture test is included in `npm test`.


### Render authorized re-edits and ranked compilations

For a standalone source video you own or have explicit reuse permission for, `npm run reedit-render -- authorized-reedit-input.json` now runs the full local path from timed transcript and rights evidence through moment ranking, cut-list creation, vertical MP4 rendering and ffprobe QC. If no narration file is supplied, it creates a silent audio bed and retains the source video's audio when present. This is a usable local-media intake path, not an upload UI or automatic speech-recognition service.

The compilation CLI now also renders when `mediaAssets` maps each approved clip ID to a local file. It can generate a silent bed if no narration is supplied, retains source audio, ranks the cleared moments, and displays the supplied original intro/outro framing as opening/closing captions. These captions are on-screen text, not spoken commentary.

Both paths intentionally require source media already obtained through a permitted route. The discovery connectors return YouTube reference metadata; they do not provide downloadable YouTube media. TikTok/Instagram discovery and automated creator-permission acquisition are not implemented. Do not use a reference URL as permission to download or republish.
