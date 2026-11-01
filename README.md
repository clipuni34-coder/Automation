# Social Media Automation

A standalone automation workspace for planning, producing, reviewing, publishing, and learning from content across YouTube, Instagram, and TikTok.

This repository is independent of Syntheniq.

## Principles

- Use official platform APIs and documented OAuth flows.
- Keep platform credentials out of source control.
- Require human approval before publishing by default.
- Verify platform capabilities and account permissions before promising or enabling an action.
- Keep platform-specific publishing logic behind separate adapters.

## Requirements

- Node.js 22 or later
- npm

## Getting started

```bash
cp .env.example .env
npm install
npm run dev
```

The initial service exposes:
- `GET /health` — process health
- `GET /api/platforms` — integration readiness (not a claim that any account is connected)

No platform is connected or able to publish until its official OAuth integration is implemented and authorized.

## Project status

This is the foundation only. Research, scripting, media production, approval workflows, publishing, and analytics will be added in tested phases. See [the roadmap](docs/ROADMAP.md).
