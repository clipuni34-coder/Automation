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

The initial discovery CLI collects:
- YouTube's regional most-popular video chart through the official YouTube Data API v3 (requires `YOUTUBE_DATA_API_KEY`).
- Public RSS/Atom feeds listed in `RSS_FEEDS` (comma-separated).

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
4. Set `DISCOVERY_REGION=NG` (or another supported two-letter region code).

YouTube's `videos.list` `mostPopular` chart is used initially; broader keyword discovery and other platform connectors will be added after quota and source-quality tests.

### RSS setup

Set `RSS_FEEDS` to comma-separated public feed URLs, for example feeds from reputable publishers and topic-specific sources you choose. Only use feeds whose access terms permit this use.

## Tests

```bash
npm test
```

## Project status

The discovery foundation is an early, tested-by-unit-tests code slice; live provider access still requires configuration and has not been verified in this repository environment. Research verification, multi-source topic clustering, saturation analysis, production, platform OAuth, publishing and analytics remain future phases. See [the roadmap](docs/ROADMAP.md).
