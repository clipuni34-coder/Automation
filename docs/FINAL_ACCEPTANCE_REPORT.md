# Primeplug — Final Acceptance Report

Date: 2026-11-05 · Branch: `editorial-evidence-hold` · HEAD at report time: see audit addendum (Section 18)

**Current correction:** see Section 9d below. An automatic run occurred at midnight rather than 06:30, a timing fix was deployed, and its first on-time production dispatch remains unobserved. Exposed setup tokens still require rotation.
Tests: **336/336 passing** (local; GitHub Tests success at `6fd9e30`)
Public publishing: **OFF** (unchanged; requires explicit owner authorization)

Classifications: **PASS** = proven with evidence · **PARTIAL** = working with a stated limitation · **PENDING** = outstanding by calendar or owner decision, not by defect · **FAIL** = not working (none).

---

## 1. Repository & branch discipline — PASS
All work is on `editorial-evidence-hold`. Nothing was merged to `main`; Syntheniq was never touched. Primeplug (`UCB7EhjM0bj2wtIBy_A_kkkg`) is the sole active channel; the other three channels are paused in config and on the dashboard.

## 2. Autonomous discovery — PASS
Two separated lanes feed a persistent, deduplicated store (215 sources persisted at report time). (a) Research lane: YouTube/RSS references, structurally barred from production and counted separately (`researchOnlyRejected`). (b) Reusable-footage lane (new): a Wikimedia Commons collector that returns ONLY candidates whose exact licence was read from their own file page via API and verified (PD/CC BY/CC BY-SA, ≥720p), preserving source URL, creator, licence family+version, licence URL and attribution text. Verified discoveries are recorded as eligible footage awaiting an editorial production plan (2 in run `42062317891`) and are never counted as production candidates or produced output. Real footage only; no AI-generated footage.

## 3. Rights verification — PASS (with stated limitation)
Every candidate is checked at screening time against the asset's actual Commons file page via the Commons API (`src/engine/rights-verification.js`), with four separated statuses. Licence identification is now EXACT (family + version parsed from the licence URL/short name): family mismatch, version mismatch, changed licence, generic claims, and inconsistent attribution metadata are all `permission_unclear` (unit-tested, and proven live: the CC BY-SA 4.0-claim/3.0-page otter fixture was rejected in run `42062317891`). Only `rights_verified_with_evidence` may enter production — recorded-but-unverified claims are blocked, never guessed; NC/ND blocked; attribution text is required when the licence requires it. Nothing is labelled legally certified. Limitation: Commons records can themselves be wrong, so human inspection remains required before any public use.

## 4. Editorial intelligence — PARTIAL
Story completeness is now enforced structurally on the narrated pathway: a production plan must declare hook/development/payoff beats, the script needs ≥3 sentences whose opening contains the planned hook, and the script must mention the recorded visual subject of the footage (all unit-tested; the deliberately weak 16-word kitten fixture was held in cloud production). The speech pathway retains the structural quality audit (hook/payoff/duration/moment-count) that rejects empty chatter and incomplete stories even when the source is sound. Limitation: speech-pathway moment scoring retains a lexical component beneath the structural gate; narration accuracy against footage is enforced by the visualSubject/beat contract and human review, not by automated semantic video understanding.

## 5. Substantially-transformative production — PASS
Original narration (narration-first for no-speech footage), Whisper transcription verified verbatim against approved scripts, burned-in captions, hooks, 3-beat alternating punch-in editing (1.0×/1.25×/1.0), dead-time removal, and loudnorm-after-mix audio processing are all implemented and cloud-proven (Chiitan `KBHalqUmHxk`; elephant chain v1→v6). No dialogue or events are invented; narration is written from verified transcripts.

## 6. Advanced measurable QC — PARTIAL
Nine numeric gates run on every narrated render before it can be approved: 1080×1920, H.264/AAC, duration, loudness, clipping, black frames, silence, scene changes, fast-start. The gate proved itself on a real defect: elephant v5 was held (`held_advanced_qc`) solely for missing fast-start; after the fix, v6 passed all checks (mean −17.6 dB, max −1.7 dB). CTA/promotional-overlay detection is calibrated on real footage (promotional-red signature 0.136–0.158 on source vs 0.000 clean; v6 frames inspected clean). Limitation: non-textual or white watermark detection is heuristic (staticness) only — hence PARTIAL. Correction policy is safe-only (reframe a single edge band ≤25%, otherwise hold); subjects are never covered to force a pass.

## 7. Verified outputs & posting packages — PASS
Outputs are verified 1080×1920 H.264/AAC fast-start MP4s with SHA-256 recorded (v6: `709fafe45508a6cf5e9a03e29d40784abac1f66bdcb1b7ecfb390a1f75cf26ac`). Each carries a full posting package: truthful title/description/hashtags, thumbnail, attribution and licence text, rights-evidence reference, and QC report.

## 8. YouTube API verification & duplicate protection — PASS
Upload approval is now PER-VIDEO: an approval names one candidate id AND the exact SHA-256 of its rendered output (`src/engine/approval.js`); approval of one video never authorizes another, and a re-render (new hash) needs new approval. Proven against the real persisted state: a wrong-hash approval matched nothing, all 3 awaiting videos reported `awaiting_per_video_approval`, zero uploads attempted; superseded outputs never appear in the awaiting list. Channel identity is verified by live OAuth before any upload or analytics read. `verify-published.mjs` independently re-reads the registry on every run: 4 private videos, expected channel, `all_verified` in the final run; registry exactly 4 — no duplicates, nothing public.

## 9. Scheduler — REPAIRED, STILL PENDING A NATURAL RUN
`clipuni34-coder/Primeplug-scheduler` dispatches the daily workflow at 06:30 Lagos (workflow `408122820`, production on, upload approval off); the dispatch mechanism is proven end-to-end by manual test dispatches. The first *natural* cron firing is due **2026-11-06 06:30 Lagos** and has not happened yet. It is not claimed.

## 10. Stress & recovery — PASS
Tested and handled truthfully: weak/no-speech sources rejected, rights-unclear/prohibited blocked, network failure during rights API falls back to `evidence_recorded_not_independently_verified` (never invented), invalid candidates rejected with reasons, duplicates deduped (30/30 in rerun proof), superseded renders non-uploadable, failed jobs retried with attempt caps and deferred (not silently completed) when production is disabled. No silent successes; CI stalls now fail fast (Section 14) instead of hanging.

## 11. Analytics — PARTIAL
Analytics sync is identity-verified and integrated, using only real API data. All current uploads are private and unwatched, so measured metrics are zero/unavailable — and the system distinguishes "unavailable" from "zero" rather than fabricating figures. Real performance feedback requires ≥5 publicly watched videos, which requires an owner publishing decision.

## 12. Policy & monetization-risk audit — PASS (as an audit)
`docs/POLICY_MONETIZATION_AUDIT.md` assesses reused-content and policy risk (rated MODERATE and inherent to the format), with mitigations: original narration, transformative editing, attribution, human review before public use. No monetization-eligibility promises are made anywhere in the system, dashboard, or docs.

## 12b. Subject-aware framing & subject-in-frame gate — PASS (with stated limitations)
A fixed centre crop previously cut moving subjects out of frame. The pipeline now tracks the source subject (motion-compensated, alpha-beta filtered, no ML model), plans the tightest per-beat framing that keeps the main subject inside the safe frame for >=97% of sampled frames (crop-follow where verifiable, otherwise full-width with blurred fill), and **holds** any render whose main subject is not verifiably in frame (`held_subject_out_of_frame`, `held_subject_not_trackable`, `held_subject_check_failed`), re-checked on the rendered file. Evidence: synthetic ground-truth tracker error mean 0.0065 frame-widths (max 0.0611); the old centre crop fails the same gate at 29.9%/15.8% contained while the new framing passes at 100%; cloud render of a fresh CC BY 3.0 moving-subject source produced 1080x1920 H.264/AAC, 12.0 s, SHA-256 `d002c859276f474dc9f4af827e56a464ad272918bdb748ac78d90fc402ee9ac8`, all 11 QC gates pass. Limitation: on footage whose motion spans most of the frame, the honest framing is full-width containment (subject never cut, but the 16:9 image sits in the middle of the 9:16 frame with blurred fill).

## 13. Dashboard truthfulness — PASS
https://clipuni34-coder.github.io/Automation/ embeds figures read from the persisted `automation-state` branch at deploy time (191 sources screened after the final run, job/awaiting/private-upload counts from state), re-deployed automatically after every daily run. Primeplug shows as sole ACTIVE channel; the other three show INACTIVE/paused.

## 14. End-to-end cloud proof — PASS
The audit cycle ran the real cloud pipeline with five fresh scenario candidates (runs `42062317891`, `42063607217`; artifacts `13431674767`, `13432830762` downloaded and inspected locally): fresh CC BY-SA Cape fox footage **produced** (SHA-256 `434986fe…`, 1080×1920 H.264/AAC, 23.0s, all 11 QC gates pass, hash independently recomputed and matched); public-domain parrot with burned-in subtitles **detected, safely reframed, produced clean** (SHA-256 `fd5d15cc…`, hash matched); licence-version-mismatch fixture **rejected**; duplicate fixture **deduped**; weak-story fixture **held**. Production reporting distinguishes execution from production (final run: discovered 42, duplicates 32, produced 1, QC-passed 1, uploaded 0 → `produced`). One state-persistence failure (`42062278022`) was diagnosed and the persist step hardened with rebase-retry. Full candidate table in `docs/EVIDENCE_REPORT.md`.

## 15. Evidence report — PASS
`docs/EVIDENCE_REPORT.md` is updated through this cycle: commits, test counts, run IDs, artifact IDs, hashes, frame/audio inspections, rights results, scheduler status, YouTube verification, limitations and blockers — including failures and holds, not only successes.

## 16. Privacy & safety constraints — PASS
Nothing public was ever uploaded; all 4 uploads are private. No existing private upload was deleted. No secrets are exposed in code, docs, dashboard, or state (state files carry licence metadata only). Publishing, deletion, and any privacy-status change remain owner-gated.

## 17. Remaining owner decisions & pending items — PENDING
1. Per-video private-upload approvals (candidate id + SHA-256) for any of the 3 awaiting videos: elephant v6 (`709fafe4…`), Cape fox pups (`434986fe…`), Einstein parrot (`fd5d15cc…`). None is uploaded; approval of one never authorizes the others.
2. Delete/keep decisions for the two weak private uploads (`ITRMwg5DbxA`, `sQZOvhrNEdE`) and the defective elephant v1 (`dQwD_It3oXM`).
3. First natural scheduler run — the 2026-11-06 06:30 Lagos slot **did not fire** (0 scheduled runs in the scheduler repo; the account's other schedules do fire, hours late). Repaired with an hourly idempotent catch-up plus a Lagos-day guard (`39ae2de`, `c032655`) and verified by a forced manual dispatch (`42195598179` → Automation `42195615043`). A natural `schedule`-event run has still not been observed, so daily autonomous operation remains **not claimed**.
4. Known engineering limitations to accept or fund: subject-aware vertical reframing (center-crop subject loss), white-logo detection on static-camera footage, Commons API rate limits.
5. Any public publishing or monetization steps — only on explicit owner authorization.

---

**Overall at the original report date:** this was the contemporaneous assessment. Later findings and unresolved limitations, including the scheduler timing defect and credential exposure, are recorded in Section 9d below and supersede any inconsistent earlier claim.

## 18. Audit addendum — 2026-11-05 (evening)
An independent audit pass re-inspected the code from first principles and found defects the prior reports had missed or understated: broad (non-exact) licence matching, global queue-wide upload approval, uncounted end-of-file silence, renders with no audio passing QC, output overlay detection recorded but never gated, a miscalibrated scene-pacing threshold, production reporting that conflated execution with production success, a state-persistence race, and the absence of any verified-footage discovery lane. All were repaired (commits `241d794`, `7409015`, `6fd9e30`) and proven in cloud runs `42062317891` and `42063607217` with independently inspected artifacts (see the audit section of `docs/EVIDENCE_REPORT.md` for the candidate-by-candidate table, hashes, and run links). Tests rose from 321 to **336/336**. Classifications above reflect the post-repair state; Sections 4 and 6 remain PARTIAL for the stated limitations, Section 9 remains PENDING by calendar, and no section is FAIL.

## 9c. External scheduler (third assignment) — RESULT

Daily triggering moved off GitHub cron (which never delivered a scheduled slot for
`Primeplug-scheduler`) to a Cloudflare Worker + Cron Trigger:

- Worker `automation` at https://automation.primeplug71.workers.dev (account
  `3cb6ca6e777cb0c3fc7111e6d8edd9d1`, KV `primeplug-scheduler-history`), upgraded
  in place from a Hello World stub — no duplicate Worker.
- Crons `30 5 * * *` (06:30 Africa/Lagos) and `0 * * * *` (hourly idempotent catch-up).
- Live dispatch: HTTP 204 -> Automation run
  https://github.com/clipuni34-coder/Automation/actions/runs/42365211139 (success, 75 s,
  0 uploads, 0 published).
- Duplicate prevention proven twice: KV fast path (`already_dispatched_today_kv`) and, with
  the marker deleted, the authoritative GitHub check (`already_ran_today`, `existingRuns:1`).
- Retry and redaction proven inside the deployed runtime via `POST /selftest` (`ok:true`).
- The original report predated the next scheduled slot. The 06:30 tick later fired but skipped after an early midnight run; an on-time production dispatch after the fix is **PENDING** (Section 9d).


## 9d. Timing correction and credential status — 2026-11-08

- The unattended hourly tick dispatched run [42423259613](https://github.com/clipuni34-coder/Automation/actions/runs/42423259613) at **00:00:54 Lagos**, not 06:30. It completed successfully on `editorial-evidence-hold` at `b00c774027b427c930a9e13cfaac09348b0cd334`; its private-upload step was **skipped**. GitHub lists artifact `13593549116` with digest `sha256:309b1a519ccf595e2e16ececc2b569e02d01fbc286a76253a3585077bc6e6d80` (reported by GitHub, not independently downloaded).
- The scheduled 06:30 tick fired at 06:30:46 Lagos and correctly skipped a second dispatch because the midnight run already existed.
- A cron gate was deployed to the same Worker to prevent automatic production before 06:30 Lagos. Source: local commit `796ca54dc3228c3d7ed925387ddc159401883473`, SHA-256 `5ec2a69d436a979ba443dc9370213203b6b35c08925e054ec4af6ef1832611da`. Local gate suite: 368/368 overall, 18/18 focused. Cloudflare deployment/version ID was not captured. The first natural, on-time production dispatch **after the fix is PENDING**.
- The GitHub PAT and Cloudflare deployment token were exposed in the setup conversation/tool command and still need rotation. Replace the Worker GitHub secret **before** revoking the old PAT, or the daily schedule will stop dispatching. The old PAT expires `2026-12-06 10:38:24 UTC` (11:38 Lagos). No alert service is configured.
- An expiry-warning enhancement was tested locally (21/21 scheduler tests), but has **not** been deployed. The improved deployer (`c3a811e`) passed 8/8 mocked API tests but has not been exercised live. At the 06:59 Lagos audit, commits `796ca54`, `3b79650`, and `c3a811e` had not been pushed because GitHub authentication was unavailable. Public publishing remains OFF and approval remains per-video; no approval was granted.
- Sequential duplicate protection was observed; exactly-once behavior under concurrent invocations was **not** proven because KV and the GitHub check are not an atomic lock.
