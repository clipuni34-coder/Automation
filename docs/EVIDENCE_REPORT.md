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

## Addendum — 2026-11-05, after owner authorization (device flow)
- Branch pushed to GitHub: commits `c3312ca` (core finish), `8fe9093` (accept existing `ENABLE_GEMINI_VISION_Q` variable as fallback for `ENABLE_GEMINI_VISION_QC`), `418f544`+`9c4e566` (OAuth validator). Nothing merged to `main`.
- Configured secret NAMES verified via API: CLIENT_ID, CLIENT_SECRETS, GEMINI_API_KEY, OPENAI_API_KEY, OPENROUTER_API (legacy alias, accepted), PIXABAY_API_KEY, REFRESH_TOKEN (legacy alias, accepted), TAVILY_API_KEY, YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_DATA_API_KEY, YOUTUBE_REFRESH_TOKEN. Variables: ENABLE_GEMINI_CREATIVE=true, ENABLE_GEMINI_IMAGE_GENERATION=true, ENABLE_GEMINI_VISION_Q=true, SYNC_YOUTUBE_ANALYTICS=true, YOUTUBE_EXPECTED_CHANNEL_ID (corrected, see below).
- Credential readiness artifact from run 42009953686: **all capabilities ready** (discovery, research, stock footage, youtube_upload, youtube_analytics).
- GitHub Actions on the pushed branch: Tests runs 42009930258 + 42009945834 = **success** (287 tests, Node 22); e2e-smoke runs 42009930531 + 42009953686 = **success**.
- **Live YouTube OAuth validation** (run 42011675455, https://github.com/clipuni34-coder/Automation/actions/runs/42011675455): access-token refresh OK; authorized channel is **Primeplug (UCB7EhjM0bj2wtIBy_A_kkkg)**. It initially mismatched the stale variable value `UCg2GvRVYLbYguVSwN2Qln1Q` (correct fail-closed block, run 42010386082). The owner confirmed Primeplug is the intended channel, so `YOUTUBE_EXPECTED_CHANNEL_ID` was updated via API and validation now passes with `channelMatchesExpected: true`.
- Still NOT done (honest): private upload smoke test (needs a completed, human-approved package; the validator deliberately performs no upload), live YouTube Analytics sync (implemented; discovery workflow with `SYNC_YOUTUBE_ANALYTICS=true` is the live path), and a permanent public mobile deployment URL (server is deploy-ready on 0.0.0.0:$PORT, but no hosting target is configured in the repo).

## Final addendum — 2026-11-05, full chain executed live
- Commits pushed: `8f998de` (private-upload smoke + Pages workflows), `09197a8` (workflow registration + Pages environment fix). Suite: **290/290 tests pass** locally; Tests run 42014184205 on GitHub = success.
- **Real-footage pipeline (local + CI)**: NASA A11Landing.mov (public domain, evidence https://www.nasa.gov/image-article/apollo-11-landing/) → Faster-Whisper (576 words in CI, 66 candidates) → moment selection ("about to turn blue… breathing again", avg editorial 5.87/10) → 1080x1920 H.264/AAC 30fps render (4.5s) → visual QC score 92, black/freeze checks passed → posting package (editorial review_required, as designed).
- **PRIVATE upload smoke test — PASSED**: run 42014224534 (https://github.com/clipuni34-coder/Automation/actions/runs/42014224534). Result artifact: `status=uploaded_private_verified`, videoId `S7a-kQh3W6E`, https://www.youtube.com/watch?v=S7a-kQh3W6E, privacyStatus `private`, channel `Primeplug (UCB7EhjM0bj2wtIBy_A_kkkg)`, processing `succeeded`. Independently re-verified via videos.list (privacy + channel). This video is PRIVATE — visible only to the channel owner in YouTube Studio — and is a plumbing smoke test, NOT approved for publication (source is 320x240 upscaled; publishable-quality source selection remains future editorial work).
- **YouTube Analytics live sync — PASSED**: same run, `analytics_exit=0`; snapshot fetched 2026-11-05T10:54Z (90/365-day windows; channel currently reports zero historical metrics, which is the true API response, stored in the artifact).
- **Mobile deployment — LIVE**: GitHub Pages enabled (workflow build), run 42014184104 success. Permanent URL: https://clipuni34-coder.github.io/Automation/ (verified HTTP 200, all 5 credential capabilities "Ready"). Interactive server (src/server.js) remains deployable to any Node host on 0.0.0.0:$PORT.
- Genuine remaining items: (1) publishable-quality footage selection/render is editorial work, not plumbing — current gates correctly keep this smoke video out of public; (2) TikTok/Instagram adapters remain out of scope/future; (3) Pages page is a status snapshot — approvals are recorded via the control server or workflow confirmations.

## Content-performance addendum — 2026-11-05, candidate Shorts comparison
Method: real footage from Wikimedia Commons / NASA only, every source public-domain with a recorded evidence page and attribution in its pipeline input (see `config/candidate-manifest.json`). Minimum source standard is now 720p. Ranking script: `scripts/compare-candidates.mjs` (editorial 40%, visual QC 25%, source resolution 20%, duration fitness 15%).

| Rank | Candidate | Source | Rights evidence | Result | Editorial | Visual QC | Duration | Rank |
|---|---|---|---|---|---|---|---|---|
| 1 | **Astronaut Williams — student Q&A (Columbia)** | 1280x720 NASA ISS interview, first 240s | Commons file page (PD) | **completed** 1080x1920 render, QC passed | 6.16 | 100 | 13.5s | **8.06** |
| 2 | Astronaut — news interview | 1280x720 NASA ISS interview | Commons file page (PD) | completed, QC passed | 6.22 | 100 | 8.0s | 7.64 |
| 3 | Apollo 11 landing (previous smoke video) | 320x240 (below new standard) | nasa.gov (PD) | completed, QC passed, baseline only | 5.87 | 92 | 4.9s | 5.65 |
| — | Perseverance onboard cameras | 3840x2160 | Commons file page (PD) | **held** — editorial 4.56 < 5.5 gate, not rendered | 4.56 | — | — | 0 |
| — | Curiosity "Seven Minutes of Terror" narration | 1280x720 | Commons file page (PD) | **held** — editorial 4.57 < 5.5 gate, not rendered | 4.57 | — | — | 0 |
| — | Perseverance landing animation | 1920x1080 | Commons file page (PD) | **rejected** — no speech track for transcription | — | — | — | 0 |

Why the winner wins: it ties the best visual QC (100) and near-best editorial score, is the longest completed Short (13.5s vs 8.0s), and its selected moments end on a genuine curiosity hook — a student asking an astronaut on the ISS "What does it feel like to see Earth…" — with a bright, clear thumbnail (astronaut floating in the ISS, readable face, clean karaoke captions). The runner-up scores 0.06 higher editorially but is only 8s and its moments are mostly a comms check plus a Whisper-garbled question. The Apollo baseline is disqualified on picture quality (320x240 upscaled, near-black thumbnail) despite its iconic audio.

Findings that matter for the channel: (1) spontaneous Q&A/interview speech clears the editorial gate; polished narration and live mission commentary do not (the lexical scorer under-rewards them — a scorer limitation, documented, NOT fixed by lowering the gate); (2) the gate still rejects weak/no-speech material consistently; (3) on CPU-constrained runners, renders above ~20s of 1080p-sourced material can hit the render timeout — candidate cuts are kept to 12-15s targets for reliability.
All uploads remain PRIVATE; no candidate here has been uploaded. The winner Short is attached to the run artifacts when the candidate-production workflow runs.
Limitations: Whisper "base" model garbles occasional words (e.g. one question in the runner-up); auto-titles are transcript fragments and need human polish before any public post; rights remain declaration-based (public-domain evidence pages recorded, no independent verifier).
