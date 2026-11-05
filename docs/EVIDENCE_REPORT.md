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

## Cloud reproduction — 2026-11-05
- Pushed `e529b53`. Tests run 42018712727 = success (293/293). Candidate production run 42018713135 = success: https://github.com/clipuni34-coder/Automation/actions/runs/42018713135
- CI independently reproduced the winning candidate from the raw Commons source: 346 words transcribed, 30 candidates, **completed** render (1080x1920 H.264/AAC, 12.27s), visual QC **100**, editorial average **6.07**, auto-title "My question for you today is What does it feel like to see Earth from space?", rank 8.03 in the cloud comparison. Artifact `candidate-shorts` on that run contains the MP4, thumbnail, captions, transcript and comparison.json.
- Note: in the CI artifact, `comparison.json` lists the other manifest candidates as `failed_no_result` because their result JSONs exist only in the local evidence run (output/ is not committed); the full 6-candidate comparison is the table above, produced locally with identical code. The cloud run's purpose was reproducing the winner end-to-end from source, which it did.
- No YouTube upload was made in this round. All uploads remain private; the only uploaded video remains the earlier private smoke test (S7a-kQh3W6E).

## Multi-candidate cloud production — 2026-11-05 (independent verification)
Commits: production `c367d83` (this evidence commit follows). Workflow: Candidate Shorts production run **42021789734** — https://github.com/clipuni34-coder/Automation/actions/runs/42021789734 (success). Tests run 42021789758 — success (**298/298**, also 298/298 locally; cloud and local are reported separately). Artifact: `candidate-shorts` (ID 13412327438) on that run — https://github.com/clipuni34-coder/Automation/actions/runs/42021789734/artifacts/13412327438 — contains 2 MP4s, 2 thumbnails, transcripts, caption files, per-candidate JSON records, comparison.json/.md, production-summary.json and SHA256SUMS.txt.

Every manifest entry was processed independently **by the cloud runner from the original sources** (no local files used). Outcomes (cloud):
| Candidate | Native source | Outcome (cloud) | Editorial | Visual QC | Output |
|---|---|---|---|---|---|
| Astronaut Williams student Q&A | 1920x1080 (AV1, 1185s original) | **completed** | 6.15 | 100 | 13.47s 1080x1920 H.264/AAC, SHA256 `2f4b422e…f932` |
| Astronaut news interview | 1920x1080 | **completed** | 6.22 | 100 | 8.10s 1080x1920 H.264/AAC, SHA256 `4e0ddc7b…e14` |
| Apollo 11 landing baseline | 320x240 | **rejected_low_resolution** | — | — | none (upscaling not credited as HD) |
| Perseverance onboard (4K) | 3840x2160 | **held_editorial_gate** (4.02 < 5.5) | 4.02 | — | none |
| Curiosity Seven Minutes narration | 1280x720 | **held_editorial_gate** (4.40 < 5.5) | 4.40 | — | none |
| Perseverance animation | 1920x1080 | **rejected_no_speech** | — | — | none |

Winner (cloud, rank 8.46/10): **Astronaut Williams student Q&A** — highest-ranked candidate that completed and passed QC; the news interview (8.04) is second on duration fitness. Only completed+QC-passed candidates receive scores; held/rejected candidates carry their exact recorded reasons and `rankScore: null`, and `winner` would be `null` had none passed (unit-tested).
Rights per candidate: public domain (U.S. federal government work, 17 U.S.C. § 105) with Commons file-page evidence URL, NASA attribution requirement, status `evidence_recorded_not_independently_verified` — recorded in each `<id>.candidate.json`. Unverified/incomplete rights records are blocked before processing (unit-tested and enforced in the orchestrator).
Local-vs-cloud note: local production (identical code) produced the same 2 completions and same 4 rejection families (Perseverance held at 4.56 locally vs 4.02 in cloud — Whisper/scoring variance on different excerpt handling; both below the gate, outcome unchanged). Cloud results above are the authoritative reproduction.
Limitations: Whisper `base` occasionally garbles a word; auto-titles remain transcript fragments; rights are evidence-recorded declarations (no independent verifier exists); render targets are capped at 12–15s for CPU-runner reliability; no YouTube upload was performed in this round.

## Multi-channel operating system — 2026-11-05
Commits: OS `69a5147` (evidence commit follows). Branch `editorial-evidence-hold`, HEAD at time of cloud runs: `69a5147`.

### Implemented
- Data-driven niche registry (`config/niches.json`: discoveries-science, funny-moments, gaming-roblox, facts-education; new niches are config-only) and 4 independently configured channels (`config/channels.json`). Only Primeplug is `connected` (YouTube UCB7EhjM0bj2wtIBy_A_kkkg, publishingMode `private_only`); the other 3 are `setup_pending` + paused — the system does not pretend they are connected.
- Persistent per-channel state (`src/engine/state.js`): sources with dedupe fingerprints, job queue, published registry, analytics, feedback, pause control; atomic writes; channels isolated by directory.
- Daily scheduler (`src/engine/scheduler.js`): per-channel niche discovery config, rights screening (approved statuses + evidence required; research references are never auto-cleared), duplicate detection, bounded retries (job requeues across cycles, max attempts), failure isolation per channel, paused/disabled handling, run records (runs.jsonl).
- Publisher guard (`src/engine/publisher-guard.js`): live per-channel identity verification, human-approval and privacy gates, public blocked unless global opt-in, fingerprint idempotency, dry-run default.
- Analytics feedback (`src/engine/feedback.js`): measured-data-only topic performance, retention-decline flags, bounded discovery boost; returns `insufficient_data` when there is nothing measured.
- Monetization readiness (`src/engine/monetization-readiness.js`): YPP numeric thresholds (500/3,000h/3M Shorts; 1,000/4,000h/10M Shorts) plus reused-content, unverified-rights, repetitive-title and strike risk flags; explicitly does not promise acceptance.
- Mobile dashboard: all channels with niche, connection, queue/published/sources, monetization progress, and per-channel pause/resume (`POST /api/channels/:id/pause|resume`, verified locally). Static status page updated with the channel list.

### Locally tested (298 -> 307 tests; 307/307 pass, also on GitHub)
9 multi-channel OS tests: niche independence + config-only new niche; real config loading; scheduler isolation (one channel's discovery throws, others complete); duplicate detection across runs; retry-then-succeed across cycles; pause skip; rights screening; publisher-guard identity mismatch / missing approval / duplicate / public blocks; feedback from measured data + insufficient-data honesty; monetization risk flags; state reload after "restart" with cross-channel isolation. Local scheduler run: Primeplug enqueued 6 seed candidates, second run deduped all 6; dashboard pause/resume verified against the running server.

### Cloud tested (GitHub Actions, pushed commit 69a5147)
- Tests run 42028596783: success (307/307).
- Daily operations run 42028596934: success — https://github.com/clipuni34-coder/Automation/actions/runs/42028596934 (artifact: daily-operations-report, ID 13415700204). Primeplug: **31 discovered** (6 rights-evidenced seeds + 25 live YouTube Data API research references), 25 research-only correctly rejected for production, 6 jobs processed; the 3 pending channels recorded `paused`. State was checked out from and pushed back to the **`automation-state` branch** (Primeplug sources/queue/runs/analytics/feedback all present), so state survives runners.
- Analytics sync inside the same run: identity-verified refresh for Primeplug; snapshot stored 2026-11-05T12:37Z; channel reports zero historical metrics and 0 top videos (the true API response; the private smoke-test video has no measured performance yet). Feedback correctly `insufficient_data` — nothing fabricated.
- Mobile Pages deploy run 42028596762: success; https://clipuni34-coder.github.io/Automation/ verified live (HTTP 200) listing all 4 channels and niches.

### Live API tested
YouTube OAuth refresh + channel identity (earlier, run 42011675455), private upload + processing verification (run 42014224534), Analytics API retrieval (runs 42014224534 and 42028596934), YouTube Data API discovery (run 42028596934, 25 research candidates recorded in state).

### Not yet verified / genuine blockers
1. **Truly automatic daily scheduling**: GitHub `schedule:` events fire only from the default branch. The cron is declared in daily-operations.yml and the full cycle is proven by dispatch/push, but hands-off daily firing activates only when this workflow reaches `main` (merging is currently forbidden by the owner) or an external scheduler calls the dispatch API. The system is autonomous per run; the trigger is the remaining step.
2. The 3 additional channels exist only as configuration: each needs its own YouTube channel created and its own OAuth authorization by the owner before it can connect (a channel-creation API does not exist).
3. Analytics feedback needs >=5 published videos with measured performance; the channel currently has one private smoke video with no metrics.
4. No public publishing has been enabled anywhere; automatic public publishing remains off pending explicit owner authorization after these safeguards.
