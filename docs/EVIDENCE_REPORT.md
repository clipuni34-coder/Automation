# Evidence report — Automation (branch: editorial-evidence-hold)

Generated: 2026-11-05 · Base commit: c576405 (test: validate complete Apollo 11 powered descent footage)
Runtime used for local evidence: Node v20.20.2 (repo CI uses Node 22), Python 3.13, FFmpeg 8.0.1 (static build in sandbox; CI installs distro FFmpeg).

## What was built in this pass
| Area | Files |
|---|---|
| Credential audit (names only, alias-aware) | `src/config/credentials.js`, `npm run credential-audit` |
| Multi-channel config (fail-closed privacy) | `src/config/channels.js`, `.env.example` |
| QC + 1-shot auto-repair (1080x1920/H.264/AAC/30fps) | `src/production/qc-repair.js` |
| End-to-end orchestrator (rights→transcribe→select→render→QC/repair→package→guarded private upload) | `src/pipeline/e2e.js`, `src/pipeline/e2e-cli.js`, `npm run e2e` |
| Mobile interface (iPhone Safari, inline, no build) | `src/server.js` (`GET /`, `GET /api/status`, `POST /api/approval`) |
| Transcription robustness (silent sources fail cleanly) | `scripts/transcribe_video.py` |
| Actions smoke workflow (tests + credential readiness; private-upload opt-in only) | `.github/workflows/e2e-smoke.yml` |
| Tests (+10) | `test/credentials-channels.test.js`, `test/qc-repair.test.js`, `test/e2e-pipeline.test.js`, `test/mobile-server.test.js` |

## Test evidence (actual counts)
- Before this pass (with FFmpeg present): 277/277 pass.
- After this pass: **287 tests, 287 pass, 0 fail, 0 skipped** (`npm test`, ~46s).
- New tests prove: legacy secret aliases (`REFRESH_TOKEN`, `OPENROUTER_API`) resolve without exposing values; public privacy is blocked without BOTH channel + global opt-in; a 640x360 silent render is repaired to 1080x1920 H.264/AAC; e2e completes all 6 stages for rights-cleared strong footage, rejects no-rights footage before rendering, holds weak footage without rendering/packaging, and only calls the uploader when approval + credentials + private confirmation all hold; mobile UI/status/approval endpoints behave and record `publishesAnything:false`.

## Real-footage evidence (3 categories, downloaded 2026-11-05)
| Category | Source | Rights evidence | Result |
|---|---|---|---|
| Space/science (speech) | NASA Apollo 11 EVA 1, https://svs.gsfc.nasa.gov/vis/a010000/a010400/a010453/Apollo_11_EVA_1_H264_720p.mov (180s sample) | Public domain (U.S. gov), https://svs.gsfc.nasa.gov/10453 | faster-whisper `base`: 180 words, 18 candidates, 3 scene changes → **editorial gate held it (below 5.5/10)**; no MP4/package produced. Correct rejection of weak material. |
| Sport | Ghana Football Association, Wikimedia Commons (CC0) | https://commons.wikimedia.org/wiki/File:Ghana_Football_Association.webm | Whisper found no intelligible speech → pipeline failed closed, no edit. Correct rejection. |
| Nature | Ocean surface waves 06, Wikimedia Commons (CC0) | https://commons.wikimedia.org/wiki/File:Ocean_surface_waves_06.ogv | Silent (no audio stream) → clean rejection after fix ("Source video has no audio stream"); previously crashed with a PyAV traceback. |
Weak-footage and no-rights rejection are also covered by automated tests (`held_weak_footage`, `rejected_rights`).

## Rendered output specification (from e2e integration render)
1080x1920, H.264 video, AAC audio, ~30fps, fast-start MP4; QC probe recorded in the e2e stage output; thumbnail time selected from the strongest moment (`selectThumbnailTime`).

## Credential readiness (sandbox — names only)
Sandbox has no GitHub secrets (by design). `node src/config/credentials.js` reports missing: `YOUTUBE_DATA_API_KEY`, `TAVILY_API_KEY`, `PIXABAY_API_KEY`, `YOUTUBE_CLIENT_ID`, `YOUTUBE_REFRESH_TOKEN` (alias `REFRESH_TOKEN` accepted), `YOUTUBE_EXPECTED_CHANNEL_ID`. Canonical names in code/workflows are `YOUTUBE_REFRESH_TOKEN` and `OPENROUTER_API_KEY`; workflows already normalise the legacy aliases. No values were read, printed, or committed.

## YouTube OAuth / private upload / analytics
- Code paths exist and are unit-tested with mocked fetch (token refresh, channel-identity verification, resumable upload, processing polling, analytics reports).
- **Live OAuth validation, private upload smoke test, and analytics sync were NOT run**: sandbox cannot read GitHub Secrets and has no GitHub authentication (`git push` fails with "could not read Username"). These must run via `.github/workflows/e2e-smoke.yml` (manual dispatch, `private_upload_smoke=true`) or the existing discovery workflow after this branch is pushed.
- Public publishing remains disabled everywhere (`YOUTUBE_ALLOW_PUBLIC_PUBLISH` defaults false; channel privacy forced to private without dual opt-in).

## Mobile interface verification
Server started locally on port 3000: `GET /` → HTTP 200 (3,887 bytes, viewport + safe-area, dark, touch buttons), `GET /health` OK, `GET /api/status` returns capabilities/channels/pipeline with `publicPublishingEnabled:false`. Approval recording writes JSONL with `publishesAnything:false`. This is a local sandbox preview only — **no permanent public deployment URL exists yet** (see blockers).

## Remaining blockers (genuine, external)
1. **Push access**: this sandbox has no GitHub credentials, so commits are local only. User must push `editorial-evidence-hold` (or grant a token via their own environment) before any Actions run/deploy can happen.
2. **Live YouTube verification** requires the repo secrets above; run the e2e-smoke workflow with `private_upload_smoke=true` after pushing.
3. **Permanent mobile deployment**: needs a host (e.g. the pushed repo's Actions → a PaaS/Cloudflare/Oracle deploy step). The server binds 0.0.0.0:$PORT and is deploy-ready, but no live public URL is claimed.
4. A completed *real-footage* render still needs a stronger speech source that clears the 5.5/10 editorial gate (Apollo EVA correctly held). Do not lower the gate to force this.

## Exact steps required from the user (only unavoidable ones)
1. Push this branch to GitHub (one push from any authenticated environment).
2. In GitHub → Actions → "End-to-end smoke" → Run workflow (branch `editorial-evidence-hold`); set `private_upload_smoke=true` only when ready for a private upload test.
3. Confirm the secrets listed above exist under Settings → Secrets and variables → Actions (canonical names preferred).
