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

YouTube's `videos.list` `mostPopular` chart is sampled by region and category. This does not cover all uploads, private/unlisted videos, or all regional trends. Keyword-based discovery and other platform connectors remain future work.

### RSS setup

Set `RSS_FEEDS` to comma-separated public feed URLs, for example feeds from reputable publishers and topic-specific sources you choose. Only use feeds whose access terms permit this use.

## Tests

```bash
npm test
```

## Project status

The discovery foundation has completed live YouTube chart scans. Tavily research collects source excerpts and bounded page extractions; AI claim-to-source assessments are advisory only and never mark claims verified. A first FFmpeg renderer now assembles still-image and licensed live-action video scenes with timed captions, narration audio, and H.264/AAC vertical MP4 output. A Pexels adapter can search and download real footage while retaining the Pexels page, creator credit, and license metadata. Automated narration generation, other visual sourcing/generation, richer editing decisions, full editorial QC, publishing and analytics remain future work. See [the roadmap](docs/ROADMAP.md).


## First video renderer slice

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

The production layer now accepts either a still image or an actual video file for each storyboard scene. The Pexels adapter searches the official Pexels video API for portrait live-action footage, retains creator/provider attribution and the Pexels License label, and downloads only HTTPS video files hosted on Pexels subdomains with a configurable size cap. The renderer trims and crops video scenes into the vertical timeline and overlays the same timed captions and narration track.

Configure `PEXELS_API_KEY` as a GitHub Actions secret or runtime environment variable. Pexels currently states that new API-key issuance is paused, so this integration is implemented but cannot be live-tested until an API key is available. Pexels also requires a prominent link to Pexels and recommends creator attribution; production packages must preserve and display those credits. The Pexels API is not a source of permission to reuse arbitrary viral creator videos: reference videos remain analysis-only unless separate rights are established.


## Real human footage support

The production layer now accepts either a still image or an actual video file for each storyboard scene. The Pexels adapter searches the official Pexels video API for portrait live-action footage, retains creator/provider attribution and the Pexels License label, and downloads only HTTPS video files hosted on Pexels subdomains with a configurable size cap. The renderer trims and crops video scenes into the vertical timeline and overlays the same timed captions and narration track.

Configure `PEXELS_API_KEY` as a GitHub Actions secret or runtime environment variable. Pexels currently states that new API-key issuance is paused, so this integration is implemented but cannot be live-tested until an API key is available. Pexels also requires a prominent link to Pexels and recommends creator attribution; production packages must preserve and display those credits. The Pexels API is not a source of permission to reuse arbitrary viral creator videos: reference videos remain analysis-only unless separate rights are established.


## Automatic narration

A Gemini 3.8 TTS adapter now converts the exact creative-brief script into WAV narration. It supports a directed speaking style and a selected built-in voice, validates the returned WAV signature, and stops immediately on quota exhaustion rather than burning requests through repeated model retries. The primary model is `gemini-3.8-flash-tts`; the Lite model is tried only when the primary model is unavailable. Both calls use the configured `GEMINI_API_KEY`.

Run it against a generated creative brief:

```bash
npm run voice -- research-topic.creative.json output/narration.wav
```

Provider request and failure paths are covered by mocked tests; a live synthesis run still depends on available Gemini TTS quota. This produces AI narration, not a cloned human voice. The video can still use real human footage as its visuals.
