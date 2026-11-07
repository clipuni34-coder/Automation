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

## Primeplug first-channel production launch — 2026-11-05
Commits on `editorial-evidence-hold`: `0c01ac5` (niche launch), `f057662` (deferred-job fix), `fe3c90e` (superseded-job cleanup), `96f6a31` (speech-rich seeds), `fbd0a2a` (state-persist large-file fix); evidence commit follows. Not merged to `main`. Syntheniq untouched. Nothing published publicly.

### Primeplug only
`config/channels.json`: Primeplug is the sole `role: primary`, enabled, unpaused channel — YouTube **UCB7EhjM0bj2wtIBy_A_kkkg** (@primeplug-f4b, identity re-verified live during publishing as channel title "Primeplug"), niche `funny-moments` redefined as "Funny, Surprising & Unbelievable Real-World Moments" (unexpected funny moments, incredible human moments, funny fails, surprising events, ranked compilations with original storytelling). The other three channels are `role: inactive`, disabled, paused, `publishingMode: disabled`. Tests: 310/310 pass locally and in GitHub Tests (runs incl. 42032091161, and at `fbd0a2a`), including `test/primeplug-launch.test.js` (only-active-channel, niche loading, seed rights screening, deferred-job semantics).

### Scheduling blocker resolved without touching main
GitHub `schedule:` only fires from a default branch, so a new private repo **clipuni34-coder/Primeplug-scheduler** (workflow ID 408158799, cron `30 5 * * *` = 06:30 Africa/Lagos) dispatches Automation's daily-operations (408122820) daily with production enabled and private-upload approval OFF. Its dispatch token is an encrypted Actions secret (set via API, never in code/chat). Proven end-to-end: scheduler run **42035124026** succeeded and triggered Automation run **42035148836**, which completed successfully with no manual step in Automation. Caveat: if the owner revokes that OAuth authorization, scheduled runs fail visibly in the scheduler repo's Actions tab and re-authorization is needed.

### Cloud production cycle (run 42033639811, dispatch with production + owner private-upload approval)
Research: 28 discovered for Primeplug (5 rights-evidenced seeds + live YouTube research references); research-only candidates rejected for reuse as designed; the 3 paused channels recorded `paused`. Truthful per-candidate outcomes — no queue-filling:
- `chiitan-mascot-fails` (CC BY 3.0, 1080p): rejected_no_audio.
- `animals-belly-rub-compilation` (CC BY 3.0, 720p): rejected_no_speech.
- `baby-elephant-funny-moments` (CC BY 3.0, 1080p): failed_pipeline (no transcript moments met minimum duration).
- `don-pettit-kids-questions` (NASA public domain, 720p): **completed**, editorial 6.22/10, QC passed, SHA-256 a6099961…
- `astronaut-pennsylvania-students-2026` (NASA public domain, 1080p): **completed**, editorial 6.26/10, QC passed, SHA-256 0e5ea4ef…
Posting packages (title/description/hashtags) were generated by the pipeline for both completed videos. Quality note: the Pennsylvania video's auto title ("Station, this is Houston, are you ready for the event?") is weak — it is private for owner review, and title quality is a known improvement item, not hidden.

### Private publishing, identity, duplicate prevention
`scripts/publish-awaiting.mjs` + `publisher-guard`: in run 42033639811 both produced videos were **uploaded PRIVATE and independently re-verified** on channel UCB7EhjM0bj2wtIBy_A_kkkg: **ITRMwg5DbxA** and **sQZOvhrNEdE**. The same run's second pass recorded `awaitingApproval: []` (zero new uploads). Verification run **42034838888** (full cycle again): 30/30 duplicates, 0 produced, 0 uploaded, state persisted by the workflow itself (state commit 0a15ea6). Public publishing remains globally disabled; daily scheduled runs keep upload approval off — produced videos wait in the approval queue visible in state/dashboard.

### Failure found and fixed (recorded honestly)
Run 42033639811's state-persist step failed: raw `.source` downloads (439MB/275MB) in the state worktree exceeded GitHub's 100MB file limit (GH001). Consequences were repaired transparently from that run's verified artifacts (state commits 80e4889, a2f7972, 8139518 — each repair is annotated in the records), and the workflow now ignores `*.source` and `**/production/work/` (`fbd0a2a`). The subsequent verification run persisted state without manual help, proving the fix. Two scheduler bugs were also found and fixed with tests: production-disabled jobs previously "completed" without producing (now deferred, attempts preserved — `f057662`), and stale off-niche NASA jobs are cancelled when a channel's seed manifest changes (`fe3c90e`).

### Analytics
Identity-verified analytics sync ran in the launch and verification runs; latest snapshot in state fetched 2026-11-05T13:21Z for UCB7EhjM0bj2wtIBy_A_kkkg: all metrics zero and no top videos yet (true API response — the private videos have no measured performance; nothing was fabricated). Feedback remains `insufficient_data` until at least 5 published videos have measured analytics.

### Dashboard
Dynamic server (`src/server.js`) shows per-channel queue, awaiting-approval count, published count, analytics totals, last error, monetization progress and pause/resume (locally verified previously; awaiting/error rows added this phase). Static mobile page https://clipuni34-coder.github.io/Automation/ verified live (HTTP 200): Primeplug "⭐ PRIMARY · ACTIVE", the other three "INACTIVE · setup_pending · paused".

### Remaining blockers / not verified
1. Public publishing: intentionally OFF. Requires explicit owner authorization; the two private videos await owner review (one title needs improvement before any public use).
2. Daily scheduler depends on the scheduler repo's `DISPATCH_TOKEN` remaining authorized; revocation stops daily dispatch (visibly).
3. Analytics-driven improvement needs real watch data; none exists yet.
4. Chiitan/belly-rub/elephant-style no-speech footage cannot pass the speech-driven editorial pipeline; future funny coverage needs either speech-rich sources or a narration-first production path (not yet built — not claimed).

## Final production audit — 2026-11-05
Audit basis: independent re-inspection, not the previous report. Remote branch head re-read via GitHub API = `781ab75942e449663dff6c16602b4039d3f68c15` (matches the reported commit). Improvements commit: `11fcbbe`. Tests: **314/314** locally and in GitHub Tests at `11fcbbe`.

### Independent verification of the previous launch
- Scheduler repo clipuni34-coder/Primeplug-scheduler: workflow 408158799 "Daily Primeplug dispatch" is `active`, cron `30 5 * * *` (06:30 Africa/Lagos). Only ONE scheduler run exists so far — the manual test dispatch 42035124026 (success) which triggered Automation run 42035148836 (success). **No true cron-fired run has occurred yet; the first is due 2026-11-06 05:30 UTC.** This is stated plainly: daily automation is armed and dispatch-proven, but a natural scheduled cycle is still pending at audit time.
- Both previously reported private uploads were re-verified against the live YouTube API by the new `scripts/verify-published.mjs` (identity-verified OAuth re-read): ITRMwg5DbxA and sQZOvhrNEdE exist, are `private`, and belong to UCB7EhjM0bj2wtIBy_A_kkkg. Status: `all_verified`.
- automation-state branch: published registry now contains 4 private videos; state is committed by the workflow itself (latest state commits bd10e4a/efd3247). Duplicate protection re-proven: second publish pass and full re-runs record zero new uploads.
- Public publishing remains disabled everywhere; the other three channels remain inactive/paused. Primeplug is the only active channel.

### Hands-on video audit of the two speech-pathway videos (frames inspected)
Both are technically valid (1080x1920, H.264/AAC) but editorially WEAK — recorded here without inflation:
- `don-pettit-kids-questions` (ITRMwg5DbxA): **4.7 seconds, a single moment** — a student asks "What do you do for fun in the International Space Station and do you play video games?" and the video ends. The hook question creates curiosity but there is NO answer and NO payoff; Don Pettit never speaks. Vertical crop cuts subjects at frame edges. Score: hook 5/10, story 2/10, payoff 0/10. **Recommendation: do not publish publicly; owner may delete.**
- `astronaut-pennsylvania-students-2026` (sQZOvhrNEdE): **6.4 seconds of mission-control radio check** ("Station, this is Houston, are you ready for the event?") — procedural chatter, no story, no surprising moment; title is literally the radio call. The astronaut appears only standing silently at the end. Not suitable for the funny/surprising niche. **Recommendation: do not publish publicly; owner may delete.**
Root cause: the lexical editorial scorer over-rewards interrogative/comms phrasing, and the pipeline accepted 1–3 micro-moments totalling <8s. Fixed below.

### Fixes implemented and tested this audit
1. **Stronger quality gate** (`computeQualityAudit` in scripts/candidate-utils.mjs, enforced in produce-candidates as `held_quality_review`): requires >=2 moments, >=8s of selected story, hook >=5, payoff >=4.5, average >=5.5, and rejects procedural radio-chatter openings. Unit tests encode BOTH real failure shapes above; under the new gate both launch videos would be held, not completed.
2. **Narration-first pathway** (`scripts/produce-narrated.mjs` + `src/production/narrated-plan.js`): non-speech footage with a planned original commentary script (hook line, 25–90 words, posting title) is narrated via configured TTS, re-edited vertically to the narration, captions burned (hook cue styled separately), thumbnail extracted, same QC + SHA-256 + posting package. No TTS configured = truthful `held_tts_not_configured` (verified locally).
3. **Published-registry API verification** (`scripts/verify-published.mjs`) runs in the daily workflow: registry claims are checked against the live API every cycle.
4. State migration requeues previously speech-rejected candidates whose seeds now route to the narrated pathway.

### Cloud proof of the fixes (run 42037298594, artifact 13420060174)
- `chiitan-mascot-fails` (CC BY 3.0): narrated pathway completed — Gemini TTS narration, 24.9s vertical 1080x1920, 5 caption cues, QC passed, SHA-256 86b28d1c…, uploaded PRIVATE and API-verified as **KBHalqUmHxk**. Frames inspected: hook caption over a mid-air mascot flip — genuinely funny, on-niche.
- `baby-elephant-funny-moments` (CC BY 3.0): narrated, 25.0s, QC passed, SHA-256 c317bf98…, PRIVATE **dQwD_It3oXM**. Frames inspected: narration captions clean, BUT the source footage's own "Subscribe for more" creator CTA is partially visible at the top of some frames — a real quality defect to fix by choosing windows that avoid source CTAs before any public use.
- `animals-belly-rub-compilation` remains `rejected_no_speech` on the speech pathway and has no narrated plan, so it was not produced (no forced quantity).
- Second publish pass: zero uploads. Analytics sync identity-verified (still zero measured metrics — private videos, nothing fabricated).

### Rights-evidence limitations (unchanged, stated plainly)
Licence evidence is the Wikimedia Commons file-page record (CC BY 3.0 / NASA public domain) captured in each seed's `rightsEvidenceUrl` with `verificationStatus: evidence_recorded_on_commons_file_page`. There is still no independent licence-verification service; a human must inspect the evidence before any public release, and the posting packages carry the attribution/licence text. Research-only YouTube references remain barred from production by the rights screen.

### Remaining blockers
1. First natural cron-fired scheduler run is pending (due 2026-11-06 06:30 Lagos); only the dispatch mechanism is proven so far.
2. The two weak speech-pathway private videos (ITRMwg5DbxA, sQZOvhrNEdE) should not be published; deletion is the owner's decision in YouTube Studio.
3. Narrated renders can inherit source burned-in text/CTAs (elephant video) — window selection must avoid them; not yet automated.
4. Analytics feedback still needs >=5 publicly watched videos; all current uploads are private with zero metrics.
5. Public publishing remains OFF pending explicit owner authorization.

## Final quality fixes & autonomous-operation proof — 2026-11-05
Commits: `45cad49` (CTA detection + elephant v2), `6d2ac9d` (loudnorm attempt + v3), `092ceb7` (loudnorm fix + audio gate + v4); evidence commit follows. Tests: **315/315** locally; GitHub Tests success at `11fcbbe` (subsequent commits re-ran the same suite in the daily-operations runner environment). Current time at audit: 2026-11-05 ~15:20 Lagos.

### Elephant CTA: detection, correction, proof
The source's red "Subscribe for more Video's" CTA is burned into the waterhole segments (measured promotional-red signature 0.136–0.158 of the top band vs 0.000 in clean segments). New `scripts/detect_overlay.py` samples the source window and detects edge-band overlays by (a) staticness while the scene changes and (b) a promotional-colour text signature; `decideOverlayCorrection` reframes a single edge band <=25% and holds anything larger/central/dual — subjects are never covered to force a pass. Detection runs on the source before our captions exist, so our own graphics cannot be confused with source overlays. Cloud proof (run 42042734671, artifact 13423721438): source detection found the top band, decision `reframe`, rendered v2 output re-detection `detected: false`, QC passed, frames inspected clean at 1s/6s/12s/20s. Honest limitation: non-textual or white/watermark logos rely on the staticness method only; keyword OCR is not implemented.

### Audio QC fix
The elephant narration measured -25.8 dB mean (too quiet). Root cause: loudnorm applied before the mix and amix auto-normalization. Fixed (`092ceb7`): amix `normalize=0`, loudnorm (I=-14) after the mix, plus a hard audio gate (held_audio_qc below -22 dB mean). Final v4 (run 42043674731): **mean -18.1 dB, max -0.7 dB**, gate passed, output CTA detection false, QC passed, SHA-256 34181bdf…. v4 is produced and sits in the approval queue — it has NOT been uploaded (this cycle ran with upload approval off). Superseded v2/v3 renders are now explicitly non-uploadable in `publish-awaiting.mjs`.

### Full audit of the two narrated uploads (KBHalqUmHxk, dQwD_It3oXM)
Complete audio independently transcribed (faster-whisper): both narrations match their approved scripts essentially verbatim (54/56 words; "Chiitan" is pronounced in a way Whisper hears as "Chiton" — a minor TTS pronunciation weakness, noted). Chiitan: mean -16.8 dB, healthy. Elephant v1: -25.2 dB mean — quiet (now fixed at engine level; the uploaded private copy retains the defect). Captions match narration text and timing by construction (script-derived cues) and were frame-inspected as readable. Chiitan scores: hook 7/10 (mid-flip opening), story 7/10, payoff 6/10 (script moral + comeback footage) — suitable for the niche. Elephant v1: hook 6/10, story 6/10, but CTA defect + quiet audio — the corrected v4 supersedes it for any future approval. Endings: both close on the script's payoff line; neither has a visual cliffhanger — acceptable, not exceptional.

### YouTube registry verification (this cycle)
`verify-published.mjs` re-read all 4 registry entries via identity-verified OAuth: ITRMwg5DbxA, sQZOvhrNEdE, KBHalqUmHxk, dQwD_It3oXM — all exist, all `private`, all on UCB7EhjM0bj2wtIBy_A_kkkg, all matching the registry (`all_verified`). Registry contains exactly 4 videos: no duplicates, no public video. Nothing was deleted (owner approval required for deletion — not given, not requested by the system).

### Scheduler: natural run still pending (stated plainly)
At audit time (2026-11-05 ~15:20 Lagos) the scheduler repo shows ONLY the manual test dispatch 42035124026. The first natural cron run is due **2026-11-06 06:30 Lagos** and has not happened yet. It would be dishonest to claim it. The dispatch mechanism, production cycle, state persistence (workflow-committed state f997867), duplicate protection (30/30 dedupe re-runs; second-pass zero uploads) and approval-off daily behaviour are all independently proven; only the calendar-triggered firing remains outstanding, by time, not by defect.

### Rights limitations
Unchanged: evidence is the Commons file-page licence record (CC BY 3.0 with attribution text in packages; NASA PD). No independent licence verifier; human inspection required before public use. Weak private videos ITRMwg5DbxA / sQZOvhrNEdE remain private and unrecommended; deletion is the owner's YouTube Studio decision.

### Remaining blockers
1. First natural scheduled run (due 2026-11-06 06:30 Lagos) — pending by calendar.
2. Corrected elephant v4 awaits owner approval before any private upload; v1 elephant + two weak speech videos await owner delete/keep decisions.
3. Watermark detection for non-textual logos is heuristic (staticness) only.
4. Analytics still zero (all videos private/unwatched); feedback needs watched public content.
5. Public publishing remains OFF pending explicit owner authorization.

## Master execution update — rights verification, advanced QC, CI stall fix — 2026-11-05 (later cycle)
Commits: `e47a4a4` (API rights verification, advanced QC, punch-in editing, state-driven dashboard, policy audit), `dd35d18` (faststart fix; elephant v6), `981b60c` (persist per-source rights verification), `cb0c52c`+`af5c177` (bound the CI install step), `a5756ba` (static FFmpeg from GitHub CDN), `440d8df` (rights-verification backfill for deduped sources). Tests: **321/321** locally at `440d8df`; GitHub Tests workflow success at the same HEAD.

### Live rights verification (new)
`src/engine/rights-verification.js` reads each asset's actual Wikimedia Commons file page via the Commons API (`extmetadata`) at screening time and classifies it into one of four separated statuses: `rights_verified_with_evidence`, `evidence_recorded_not_independently_verified`, `permission_unclear`, `reuse_prohibited`. NC/ND terms and unclear/prohibited statuses are blocked in `screenCandidate` (scheduler); no source class is auto-cleared, and research-only discovery references remain barred. Final verification run `42057734304` (success) persisted live results into `automation-state`: all 5 unique seed sources carry `rights_verified_with_evidence` with API-observed licences (CC BY 3.0 ×3, Public domain ×2) and `checkedAt` timestamps from that run. Deduped sources previously skipped re-recording; `refreshSourceRights` (`440d8df`) now backfills their verification without altering recorded outcomes (unit-tested). Honest limitation: the evidence originates from Commons file-page records, which can themselves be wrong — human inspection is still required before any public use.

### Advanced measurable QC (new) and the v5 hold / v6 pass
`src/production/advanced-qc.js` adds numeric gates on the finished render: 1080×1920 resolution, H.264/AAC codecs, 8–58s duration, narration loudness, clipping, black frames, silence, scene changes, and MP4 fast-start (moov before mdat). Elephant v5 was correctly **held** (`held_advanced_qc`) for exactly one failure — fast-start — with every other check passing (audio mean −17.9 dB, output CTA clean). Root cause: the narrated render lacked `-movflags +faststart`. Fixed in `dd35d18`; v6 (run `42046588196`, artifact `13425600287`) passed all advanced-QC checks: 1080×1920 H.264/AAC, 25.8s, mean −17.6 dB, max −1.7 dB, no black/silence failures, scene changes present, fast-start true. SHA-256 `709fafe45508a6cf5e9a03e29d40784abac1f66bdcb1b7ecfb390a1f75cf26ac`. Frames at ~1s/9s/17s were visually inspected: captions legible, framing visibly varies across the three punch-in beats (close / medium / wide bank scene), no CTA or promotional overlay visible, no watermark observed. v6 is produced and in the approval queue; it has NOT been uploaded. The 3-beat alternating punch-in edit (1.0×/1.25×/1.0) is implemented in `scripts/produce-narrated.mjs`.

### CI stall: diagnosed from logs, fixed, proven
Run `42047313626` hung >30 min in "Install FFmpeg and transcription dependencies" and was cancelled by the operator. A re-dispatch (`42053319028`, with a new 20-minute step bound) failed fast and its job log gave the exact cause: the runner image no longer preinstalls FFmpeg, and `apt-get install ffmpeg` needed 69 MB from `azure.archive.ubuntu.com`, which delivered at a crawl (individual packages timing out and retrying; pip never started). Fix (`a5756ba`): install a static FFmpeg/ffprobe build from the BtbN GitHub releases CDN, with a johnvansickle.com static build and apt as fallbacks. Proof: the next run's install step completed in **25 seconds** (15:38:44Z→15:39:09Z, run `42057039832`), and the production verification run `42057076078` succeeded end-to-end. State persistence, `verify-published` (`all_verified`, 4 private videos, channel `UCB7EhjM0bj2wtIBy_A_kkkg`, registry exactly 4), and zero new uploads were re-confirmed in the final run `42057734304`.

### Dashboard (state-driven figures)
The live dashboard (https://clipuni34-coder.github.io/Automation/) embeds figures read from the persisted `automation-state` branch at deploy time, not hand-written numbers: after the final run it shows **191 sources screened (persisted)**, job counts, awaiting-approval and private-upload figures from state, with Primeplug the sole active channel and the other three paused. The daily workflow re-dispatches the dashboard deploy after each run.

### Policy / monetization audit
`docs/POLICY_MONETIZATION_AUDIT.md` records the reused-content and monetization-risk assessment: risk rated MODERATE and inherent to the format; mitigations are original narration, transformative editing, attribution, and mandatory human review before any public use. No monetization-eligibility claims are made anywhere in the system or dashboard; analytics remain zero/unavailable until publicly watched content exists (unavailable is distinguished from zero in state).

### Remaining blockers (unchanged in nature)
1. First natural cron scheduler run still pending by calendar (due 2026-11-06 06:30 Lagos) — never claimed early.
2. Elephant v6 (and superseded v4) await explicit owner approval before any private upload; weak private videos `ITRMwg5DbxA`/`sQZOvhrNEdE` await owner delete/keep decisions.
3. Non-textual/white watermark detection remains heuristic-only.
4. Rights evidence originates from Commons records (API-observed, claim-compared); human inspection required before public use.
5. Public publishing remains OFF pending explicit owner authorization.

## Independent audit & repair cycle — 2026-11-05 (evening)
Commits: `241d794` (exact licence verification, per-video approval, QC audio/silence/overlay gates, Commons discovery, truthful production reporting), `7409015` (denser overlay sampling + burned-subtitle signature; five audit scenario seeds), `6fd9e30` (scene-pacing threshold measured fix, paused-channel report label, state-push rebase retry, Commons 429 retry). Branch `editorial-evidence-hold`. Tests: **336/336** locally; GitHub Tests success at `6fd9e30`. Cloud runs: push `42062278022` (failed at state persist — see below), production `42062317891` (success, artifact `13431674767`), production `42063607217` (success, artifact `13432830762`). Run links: https://github.com/clipuni34-coder/Automation/actions/runs/42062317891 and https://github.com/clipuni34-coder/Automation/actions/runs/42063607217

### Defects found in the actual code (not from prior reports) and repaired
1. **Licence matching was broad, not exact.** `classifyObservedLicence` accepted any claim matching /cc|licensed/ — a CC BY 4.0 claim verified against a CC BY-SA 3.0 page. Replaced with exact licence identification (`parseCcLicence`: family + version from licence URL/short name). Family mismatch, version mismatch, changed licence (claim PD vs observed CC), generic claims, and inconsistent attribution metadata are all `permission_unclear`. Only `rights_verified_with_evidence` may enter production (recorded-but-unverified is now blocked at scheduling, never guessed). Nothing is labelled legally certified; the verified reason text says so.
2. **Upload approval was global.** `HUMAN_APPROVED_PRIVATE=true` authorized every awaiting video. Replaced with per-video approval (`src/engine/approval.js`): an approval names one candidate id AND its exact output SHA-256. Proven against the real persisted state: with a wrong hash, `matchApproval` matched nothing and all 3 awaiting videos (`baby-elephant-funny-moments-v6`, `cape-fox-pups-playing`, `audit-parrot-burned-subtitles`) reported `awaiting_per_video_approval`; zero uploads attempted. Superseded v5 correctly absent from the awaiting list.
3. **Silence detection dropped end-of-file silence** (ffmpeg emits no `silence_end` at EOF). Parser now closes trailing silence at file duration and a `no_trailing_silence` gate (≤1.5s) was added. **A render with no audio stream passed codec QC** (`(!a || aac)`); now `audio_present_aac` is mandatory. **Output overlay detection was recorded but never gated**; a failed check or a detected overlay now holds the render. Overlay sampling densified (6→12–24 frames) with a calibrated strict saturated-yellow burned-subtitle signature (0.0000 on clean savanna/grass footage, 0.06+ on real burned subtitles; ≥2 signature frames required).
4. **Scene-pacing threshold was miscalibrated.** `gt(scene,0.35)` held the Cape fox render (continuous single-shot footage). Measured on the actual held render: 26 visual changes at threshold 0.1, 0 at 0.35. Threshold set to 0.1 (counts real subject/camera/edit changes incl. punch-in cuts).
5. **Reporting conflated execution with production.** Run summaries counted completed jobs (including `produced:false` holds) as success. New `src/engine/run-report.js` reports discovered / research-only-rejected / rights-verified / eligible / rejected / duplicates / awaiting-plan / produced / QC-passed / uploaded separately, and a production-enabled run with zero produced videos reports `no_production`. Final run: discovered 42, duplicates 32, produced 1, uploaded 0, outcome `produced`. A zero-production state is demonstrable in the same report structure (paused channels report `paused`, not success).
6. **State persistence nearly lost a cycle.** Push run `42062278022` failed at "Persist updated channel state" (`fatal error in commit_refs`) when the state branch had advanced. Persist step now retries push with fetch + rebase (3 attempts). The subsequent production run persisted successfully.
7. **Discovery had no reusable-footage pipeline.** New Commons collector (`src/discovery/sources/commons.js`): every returned candidate has its exact licence read from its own file page via API; only verified PD/CC BY/CC BY-SA ≥720p videos return, with creator, licence family+version, licence URL and attribution text preserved; the rest are rejected with reasons. Verified discoveries are recorded as eligible footage `awaitingPlan` (2 in run `42062317891`) — they are NOT production candidates until an editorial plan exists, and are never counted as produced. Limitation observed live: the Commons API rate-limits (HTTP 429) some queries in a run despite one retry with backoff; affected queries are reported as rejected-with-reason, not silently dropped.

### Candidate-by-candidate audit decisions (cloud, runs above)
| Candidate | Scenario | Decision | Evidence |
|---|---|---|---|
| cape-fox-pups-playing | fresh valid CC BY-SA 2.0 (Bernard DUPONT, 1920×1080) | Held in run 1 by miscalibrated scene gate; **produced** in run 2 after measured fix | SHA-256 `434986fe9305c97b82001759ff4d1465092b0b91f7067d1c7e77976185c2a3f5`; 1080×1920 H.264/AAC, 23.0s, mean −18.1 dB, all 11 advanced-QC checks pass; frames inspected: captions readable, no overlays; **crop limitation: center vertical crop loses the pups in some frames (t≈7s, t≈20s partially out of frame)** |
| audit-parrot-burned-subtitles | public-domain VOA parrot with burned-in subtitles (window 35–62s) | **Produced with safe correction** | Source detection: bottom band, text-signature, 2 frames → reframe bottom 20% → output detection clean; vertical crop also excludes the corner logos; SHA-256 `fd5d15cc0b55ba9e46cf769aa57c61542ed0c379c62ac283e2c8ca72ebfd9fb7`; 1080×1920 H.264/AAC, 24.0s, mean −17.8 dB; frames inspected clean, narration accurate |
| audit-licence-version-mismatch | claim CC BY-SA 4.0 vs page CC BY-SA 3.0 (Grendelkhan otter) | **Rejected at screening** | persisted `rightsVerification: permission_unclear`, observed CC BY-SA 3.0; rejected reason recorded in run summary |
| audit-duplicate-elephant-source | same source URL as already-used elephant seed | **Deduped, never enqueued** | duplicates count (30 in run 1, 32 in run 2); no queue job created |
| audit-weak-story-kitten | 16-word, 2-sentence, no beats, CC BY 4.0 (Nesnad) | **Held, not produced** | `held_narration_plan_incomplete` — script too short, no storyBeats/payoff, no visualSubject |

### Rights evidence and limitations
Live persisted state now holds 215 sources, 10 with `rights_verified_with_evidence` including exact `licenceFamily`/`licenceVersion`/`shareAlike`/`licenceUrl` (state commit on `automation-state`). Rights evidence remains Commons file-page records observed via API; verification is evidence comparison, not legal certification; human inspection required before public use. ShareAlike is honoured in the Cape fox posting package (attribution + "derivative shared alike" + licence link verified in the artifact's posting package).

### Scheduler evidence
`Primeplug-scheduler` (workflow cron `30 5 * * *` = 06:30 Africa/Lagos) dispatches Automation workflow `408122820` on `editorial-evidence-hold` with production on and upload approval off (file inspected this cycle). The scheduler repo still shows exactly ONE run — the manual test dispatch `42035124026`. **The first natural cron run is due 2026-11-06 06:30 Lagos and has not occurred; normal daily operation is NOT claimed.**

### Remaining known limitations
1. First natural scheduler run pending by calendar (above).
2. Vertical center-crop can lose horizontally moving subjects (Cape fox frames at ~7s/~20s); subject-aware reframing is not implemented. Advanced QC does not measure subject presence.
3. Overlay detection: white/non-textual logos on static-camera footage and very brief subtitle flashes can still evade sampling (parrot window 0–30s was not flagged; 35–62s was). Detection is evidence, not a guarantee — human frame review remains required before upload approval.
4. Commons API rate limiting (429) intermittently rejects discovery queries; one retry helps but does not eliminate it.
5. Held narrated candidates are re-evaluated each production run (cheap validation holds re-hold; renders only re-run when the pathway outcome was non-terminal). Elephant v5 re-rendered and completed in the final run (new hash `bd76eba46843c3e2…`); it remains superseded by v6 and non-uploadable.
6. Three videos await owner per-video approval (v6 elephant, Cape fox, parrot); two weak private uploads and defective elephant v1 await owner delete/keep decisions; public publishing remains OFF. Nothing was uploaded, published, or deleted in this cycle (`verify-published`: `all_verified`, 4 private videos, channel `UCB7EhjM0bj2wtIBy_A_kkkg`).

## Scheduler audit — 2026-11-06 (did the natural 06:30 Lagos run fire?)
**Answer: NO. The scheduled run did not happen, and the cause was in the scheduler repository, not in Automation.**

Evidence (GitHub API, 2026-11-06 09:12Z): the `Primeplug-scheduler` repository had exactly **1** run in total — the manual test dispatch `42035124026` (2026-11-05T13:22Z). The workflow was enabled (`state: active`) on the default branch `main`, Actions permissions were `enabled: true`, and other scheduled workflows in the same account *do* fire (Automation's `Discovery scan` has `schedule` runs on 11-01, 11-02, 11-03, 11-04, 11-05 — several of them hours late). So GitHub cron delivery for this account is functional but unreliable/late, and a single daily slot was simply dropped.

**Repair (scheduler repo, branch `main`, commits `39ae2de` + `c032655`):**
- `30 5 * * *` (06:30 Lagos) kept as the intended slot, plus `0 * * * *` hourly **idempotent catch-up**.
- Before dispatching, the job asks the Automation API whether any `daily-operations` run already exists since Lagos midnight (computed explicitly as UTC+01:00, no tzdata dependency, `c032655` fixed a UTC-midnight fallback observed in run `42195598179`). If a run exists it skips and logs it; if the guard query itself fails it dispatches anyway and warns (a rare duplicate is safer than a silent missed day).
- `force: true` manual input for tests.
- Verified: scheduler run `42195598179` (workflow_dispatch) logged `Lagos day starts …`, `daily-operations runs since Lagos midnight: 0`, `Forced manual dispatch.`, `Dispatch HTTP 204` and created Automation run `42195615043`. https://github.com/clipuni34-coder/Primeplug-scheduler/actions/runs/42195598179
- **Guard/idempotency verified live** (scheduler run `42201681577`, `force=false`): log shows `Lagos day starts at 2026-11-05T23:00:00Z`, `daily-operations runs since Lagos midnight: 6`, `already ran: 42197859705 workflow_dispatch …`, `Today's run already exists; nothing to do.` — **no duplicate dispatch**. The corrected Lagos boundary (UTC+01:00) is confirmed in the live log.
- **Natural cron still not delivered**: after the repair, the 10:00Z hourly slot passed (checked 10:18Z) with still **0 `schedule`-event runs** in the repository, and the 05:30Z slot never ran. Two consecutive missed slots, while the same account's other scheduled workflows do fire, means this repository's cron registration is not being honoured — not merely delayed. Daily autonomous operation is therefore **NOT claimed**. The idempotent catch-up means the day is covered the moment any slot is delivered, and any `push` to the scheduler repo also provides a dispatch opportunity; if GitHub continues not to deliver, an external scheduler (calling the same dispatch API with the same token) is the remaining fix and requires no code change.

## Subject-aware vertical reframing + hard subject-in-frame gate — 2026-11-06
Commits on `editorial-evidence-hold`: `0fb8eea` (tracker, planner, gates, pipeline wiring, tests), `da68020` (overlay-detector scene-locked fix + horses candidate), `8627f99` (mode-aware output gate + Commons 429 retry in rights verification), `046c208` (re-screen sources rejected on transient faults). Tests **350/350** locally; GitHub Tests green at each push. Branch never merged into `main`; Syntheniq untouched.

### What was wrong
The vertical re-edit was a fixed centre crop of a 16:9 source into 9:16, which keeps only ~31.6% of the frame width, with three punch-in beats. Any subject outside the middle third was cut out of frame — visible in the previously produced Cape fox Short (pups clipped at t≈7s and t≈20s, noted as a limitation in the previous audit).

### What was built
1. `scripts/track_subject.py` (numpy + Pillow only; no model download, no network): dense sampling at 8 fps; per-frame camera translation estimated by phase correlation and compensated; residual motion soft-thresholded with robust statistics (median + 3·MAD) to reject grain/grass texture; the **main subject** is the strongest contiguous run of the column-energy profile, with adjacent runs merged (a moving object produces residual at its leading *and* trailing edges, so unmerged runs track one edge); an **alpha-beta predictive filter** follows constant-velocity motion with no lag while rejecting implausible single-frame jumps (re-anchoring if the new position persists 3 frames).
2. `src/production/subject-framing.js`: per story beat the planner tries candidate window widths from narrow (crop-follow, punch-in) to full frame and keeps the **narrowest framing whose following window keeps the main subject inside the safe frame for ≥97% of sampled frames**; where no narrow window can be verified it keeps the whole frame width visible and fills with a blurred copy of the same footage ("padded"/"contain"). Nothing is ever cropped away to force a pass. `cropXExpression()` compiles the trajectory into a piecewise-linear ffmpeg `crop x` expression.
3. `scripts/produce-narrated.mjs`: tracks the source before rendering; **holds** with `held_subject_not_trackable` / `held_subject_out_of_frame` if the plan cannot be verified; after rendering it re-runs the tracker on the **rendered file** and holds with `held_subject_out_of_frame` / `held_subject_check_failed`.

### Measured results
| Test | Result |
|---|---|
| Synthetic ground-truth clip (block crossing a static noisy background, 20 s) | tracker error vs truth: **mean 0.0065, p95 0.0227, max 0.0611** frame-widths; planner chooses a following window; gate passes |
| Same clip, regime of the OLD fixed centre crop | gate **HOLDS**: "Main subject inside the safe frame in only 29.9% of measurable frames (gate 95%)" |
| Cape fox (real CC BY-SA 2.0 footage, 1920×1080) — new framing | gate **pass**, 100.0% of 158 measurable frames contained; render SHA-256 `1629e95c60528cbfb384af05fc108328675d1f23d75b4d52914be1da0598393a` (local 720×1280 verification render) |
| Cape fox — previous fixed centre crop | gate **HOLDS** (subject outside the safe band in 15.8% of measurable frames); SHA-256 `39fea297e0fbfd16b9bc012299a49f2462f91eec0cefd14d2036cd335df6d521`; frames show pups clipped at the frame edge |
| Cloud, fresh moving-subject source (horses, CC BY 3.0) | **produced**: 1080×1920 H.264/AAC, 12.0 s, SHA-256 `d002c859276f474dc9f4af827e56a464ad272918bdb748ac78d90fc402ee9ac8`; all 11 advanced-QC checks pass; mean −15.5 dB; source gate pass (100% of 95 frames); output gate pass (100%) |
Comparison frames: `docs/evidence/framing/` (cape fox new vs old at t=7s/13s/20s plus 3 s-interval contact sheets).

### Three cloud runs, three real defects found and fixed
| Run | What happened | Defect → fix |
|---|---|---|
| `42195615043` | sprint candidate HELD `held_source_overlay` (centre band) although the footage has no overlay | dense colourful crowd (red shirts) tripped the text signature. Measured separation: sky/treeline band edge density 0.000 vs 0.034+ for a real lower third → staticness path now requires graphic structure **and** the band not to be scene-locked (camera-compensated); `da68020`. Crowd footage still trips the text signature — documented limitation, it is HELD, never passed. |
| `42196879606` | horses candidate rejected as `evidence_recorded_not_independently_verified` | the Commons file-page read was rate-limited (HTTP 429) → rights verification now retries 429/5xx with backoff (`8627f99`); same candidate verifies locally as `rights_verified_with_evidence` (CC BY 3.0) |
| `42197390039` | horses candidate silently *deduped* (duplicates 26, produced 0) | a source stored as `rejected` (because of that 429) was blocked forever by dedupe → `hasUsedSource(url, {rescreenRejected:true})` re-screens rejected sources while eligible/produced ones stay deduped (`046c208`, regression test added) |
| `42197859705` | horses candidate **produced** (discovered 48 / rightsVerified 6 / eligible 6 / duplicates 16 / produced 1 / uploaded 0, outcome `produced`), artifact `13493270843` | — |

### Honest limitations of the framing work
1. On wide shots where several animals are far apart or motion is spread over most of the frame (Cape fox, the Enugu sprint, the horse pasture), the planner falls back to full-width containment: the subject is never cut, but the 16:9 image occupies the middle of the 9:16 frame with blurred fill. This is a deliberate safety-over-fill trade-off, not a bug; a following crop could not be verified at ≥97% coverage on those clips.
2. The tracker is motion-based: a completely static subject in a static shot yields no measurable track, which holds the candidate (`held_subject_not_trackable`) rather than guessing.
3. Subject identity is "the strongest coherent motion cluster"; in multi-subject footage one animal may leave frame while the tracked one stays — the gate protects the main subject, not every animal.
4. The output-side gate is mode-aware: centred safe-band checks apply only to beats that follow the subject with a narrow window (a subject near the edge of a fully visible frame is not "cut").

---

# Third assignment — external scheduler (Cloudflare Worker + Cron Triggers)

Executed 2026-11-07. Nothing in the production engine, the editorial/rights gates,
the per-video approval requirement or the public-publishing switch was changed.

## Provider and configuration

| Property | Value |
|---|---|
| Provider | Cloudflare Workers + Cron Triggers + Workers KV (free plan) |
| Account id | `3cb6ca6e777cb0c3fc7111e6d8edd9d1` |
| Worker | `automation` (an untouched "Hello world" stub was upgraded **in place** — no duplicate Worker was created) |
| Worker URL | https://automation.primeplug71.workers.dev |
| Health | https://automation.primeplug71.workers.dev/health |
| History | https://automation.primeplug71.workers.dev/history |
| Deployment method | Cloudflare REST API from `infra/external-scheduler/deploy-api.mjs` (inspect → apply) |
| KV namespace | `primeplug-scheduler-history` = `e3273329a7144049a9b8d7260e13e2f3`, binding `HISTORY` |
| Cron triggers | `30 5 * * *` (06:30 Africa/Lagos daily) and `0 * * * *` (hourly idempotent catch-up) |
| Timezone | Africa/Lagos = UTC+01:00 all year, no DST; the Lagos day boundary is computed explicitly (`06:30 Lagos == 05:30 UTC`) |
| Secrets | `DISPATCH_TOKEN`, `ADMIN_TOKEN` — Cloudflare encrypted secrets only; set through the secrets API, never written to the repo, never printed |
| Target | workflow `408122820` `daily-operations.yml`, ref `editorial-evidence-hold`, inputs `production_enabled=true`, `approve_private_upload=false` |

`/health` at deployment time:

```json
{"ok":true,"service":"primeplug-external-scheduler",
 "schedule":{"cron":["30 5 * * *","0 * * * *"],"timezone":"Africa/Lagos (UTC+01:00)","daily":"06:30 Africa/Lagos"},
 "lagosDay":"2026-11-07","lagosMidnightUtc":"2026-11-06T23:00:00Z",
 "tokenConfigured":true,"adminTokenConfigured":true,"kvBound":true,"todayDispatched":false}
```

## The eight proofs

| # | Requirement | Result | Evidence |
|---|---|---|---|
| 1 | External scheduler executes | **PASS** (manual **and** cron path) | `POST /trigger` on the deployed Worker returned `action:"dispatched"` at `2026-11-07T10:44:18.266Z`, `lagosDay:"2026-11-07"`. Separately, the **hourly cron fired by itself**: `2026-11-07T11:00:52.237Z`, `source:"cron:0 * * * *"`, `action:"skipped"`, `reason:"already_dispatched_today_kv"` — Cloudflare Cron Triggers do execute this Worker, which is exactly the mechanism GitHub failed to deliver. The 06:30 slot itself is **PENDING** — see below. |
| 2 | Authentication succeeds | **PASS** | GitHub dispatch API accepted the call with the `DISPATCH_TOKEN` secret: `HTTP 204`, `attempts: 1`. |
| 3 | GitHub accepts the dispatch | **PASS** | Run `42365211139` created, `event: workflow_dispatch`, `head_branch: editorial-evidence-hold`, `head_sha: 4fab60d`. |
| 4 | Automation starts | **PASS** | Run `42365211139` — https://github.com/clipuni34-coder/Automation/actions/runs/42365211139 — `in_progress` 10:44:19Z, `completed / success` 10:45:34Z (75 s). Logs confirm `PRODUCTION_ENABLED: true`. |
| 5 | Lagos-day guard works | **PASS** | KV marker deleted on purpose, then `POST /trigger` → `action:"skipped"`, `reason:"already_ran_today"`, `existingRuns:1`. The authoritative GitHub check alone refused the dispatch. |
| 6 | Repeated trigger does not duplicate | **PASS** | Triggers #2 and #3 → `reason:"already_dispatched_today_kv"` (no network call). Runs on workflow `408122820` created `>= 2026-11-06T23:00:00Z`: **count = 1**. |
| 7 | Failed requests retry safely | **PASS** | In the deployed runtime `POST /selftest` → `ok:true`: `retry_after_503` dispatched on attempt 2, `retry_after_network_error` dispatched on attempt 2, `no_retry_on_401` stopped after 1 call. Backoff 2 s then 6 s, max 3 attempts, only 429/5xx/network are retried. |
| 8 | Logs contain no credentials | **PASS** | Leak scan of `/health` and `/history`: 0 occurrences of `github_pat_`, 0 of the admin token, 0 of `gh?_` patterns. `no_secret_in_result` self-test case: `redacted:true, leaked:false`. `redact()` scrubs both secrets and GitHub token patterns from every response and log line. |

## Production safety during this run

The dispatched run reported `{discovered 48, rightsVerified 5, eligible 5, duplicates 17, enqueued 0, produced 0, qcPassed 0, uploaded 0}`.
No candidate passed the duplicate filter, so nothing new was rendered and **no upload occurred**.
Uploads remain per-video approval gated (candidate id + SHA-256); public publishing remains OFF;
the four existing private videos were not touched; no video was deleted; no channel was added.

## Duplicate-scheduler de-conflict

`Primeplug-scheduler` cron triggers were removed (`a27ac9f`, branch `main`); it is now a
**manual fallback only**. Two schedulers can no longer race into a duplicate production run.

## Remaining limitations

1. **Natural 06:30 Africa/Lagos execution: PENDING.** It cannot be observed before the next
   `30 5 * * *` firing; today's 06:30 slot had already passed when the Worker went live.
   A manual dispatch is explicitly *not* proof of natural daily scheduling, so this item stays open.
2. The `DISPATCH_TOKEN` is a fine-grained PAT with an expiry; when it lapses the dispatches stop.
   `/health` reports `tokenConfigured` and `lastAttempt`, which is the thing to watch.
3. `workers.dev` free-tier limits (100k requests/day, 1k KV writes/day) are used at a rounding
   error by two runs a day, but the failure mode is silent unless `/health` is checked.
4. If Cloudflare is unavailable the only fallback is the manual dispatch in `Primeplug-scheduler`.
