# Primeplug — Final Acceptance Report

Date: 2026-11-05 · Branch: `editorial-evidence-hold` · HEAD at report time: `e7af65b`
Tests: **321/321 passing** (local, and GitHub Tests workflow success at `440d8df`)
Public publishing: **OFF** (unchanged; requires explicit owner authorization)

Classifications: **PASS** = proven with evidence · **PARTIAL** = working with a stated limitation · **PENDING** = outstanding by calendar or owner decision, not by defect · **FAIL** = not working (none).

---

## 1. Repository & branch discipline — PASS
All work is on `editorial-evidence-hold`. Nothing was merged to `main`; Syntheniq was never touched. Primeplug (`UCB7EhjM0bj2wtIBy_A_kkkg`) is the sole active channel; the other three channels are paused in config and on the dashboard.

## 2. Autonomous discovery — PASS
Multi-source discovery (Wikimedia Commons seeds with recorded provenance, dates and creators, plus live YouTube Data API research) feeds a persistent, deduplicated source store — 191 sources persisted in `automation-state` at report time. Candidates are ranked by story/hook/surprise/emotion/quality/payoff signals. Real footage is used throughout; no AI-generated footage is produced. Research-only YouTube references are recorded for research and are structurally barred from production.

## 3. Rights verification — PASS (with stated limitation)
Every candidate is checked at screening time against the asset's actual Commons file page via the Commons API (`src/engine/rights-verification.js`), with four separated statuses: `rights_verified_with_evidence`, `evidence_recorded_not_independently_verified`, `permission_unclear`, `reuse_prohibited`. NC/ND and unclear/prohibited candidates are blocked at scheduling; no source class is auto-cleared. Final run `42057734304` persisted live results: all 5 unique seed sources verified (CC BY 3.0 ×3, Public domain ×2), each with API-observed licence and timestamp. Limitation: Commons records can themselves be wrong, so human inspection remains required before any public use.

## 4. Editorial intelligence — PARTIAL
Story completeness and hook/payoff are scored, and incoherent moments are rejected — including rejecting a structurally weak candidate even when its source is sound (`computeQualityAudit`: the 4.7s unanswered-question and radio-chatter uploads are what this gate now prevents; `animals-belly-rub-compilation` remains `rejected_no_speech`, never forced). Limitation: the underlying scorer is lexical, so the structural gate is a necessary second layer rather than a luxury; scoring quality is good, not perfect.

## 5. Substantially-transformative production — PASS
Original narration (narration-first for no-speech footage), Whisper transcription verified verbatim against approved scripts, burned-in captions, hooks, 3-beat alternating punch-in editing (1.0×/1.25×/1.0), dead-time removal, and loudnorm-after-mix audio processing are all implemented and cloud-proven (Chiitan `KBHalqUmHxk`; elephant chain v1→v6). No dialogue or events are invented; narration is written from verified transcripts.

## 6. Advanced measurable QC — PARTIAL
Nine numeric gates run on every narrated render before it can be approved: 1080×1920, H.264/AAC, duration, loudness, clipping, black frames, silence, scene changes, fast-start. The gate proved itself on a real defect: elephant v5 was held (`held_advanced_qc`) solely for missing fast-start; after the fix, v6 passed all checks (mean −17.6 dB, max −1.7 dB). CTA/promotional-overlay detection is calibrated on real footage (promotional-red signature 0.136–0.158 on source vs 0.000 clean; v6 frames inspected clean). Limitation: non-textual or white watermark detection is heuristic (staticness) only — hence PARTIAL. Correction policy is safe-only (reframe a single edge band ≤25%, otherwise hold); subjects are never covered to force a pass.

## 7. Verified outputs & posting packages — PASS
Outputs are verified 1080×1920 H.264/AAC fast-start MP4s with SHA-256 recorded (v6: `709fafe45508a6cf5e9a03e29d40784abac1f66bdcb1b7ecfb390a1f75cf26ac`). Each carries a full posting package: truthful title/description/hashtags, thumbnail, attribution and licence text, rights-evidence reference, and QC report.

## 8. YouTube API verification & duplicate protection — PASS
Channel identity is verified by live OAuth before any upload or analytics read. `verify-published.mjs` independently re-reads the registry against the YouTube API on every daily run: 4 private videos (`ITRMwg5DbxA`, `sQZOvhrNEdE`, `KBHalqUmHxk`, `dQwD_It3oXM`), all on the expected channel, `all_verified` in the final run. Registry contains exactly 4 — no duplicates, nothing public. Second publish passes and full reruns repeatedly produced zero new uploads; superseded correction IDs are never uploadable.

## 9. Scheduler — PENDING (by calendar)
`clipuni34-coder/Primeplug-scheduler` dispatches the daily workflow at 06:30 Lagos (workflow `408122820`, production on, upload approval off); the dispatch mechanism is proven end-to-end by manual test dispatches. The first *natural* cron firing is due **2026-11-06 06:30 Lagos** and has not happened yet. It is not claimed.

## 10. Stress & recovery — PASS
Tested and handled truthfully: weak/no-speech sources rejected, rights-unclear/prohibited blocked, network failure during rights API falls back to `evidence_recorded_not_independently_verified` (never invented), invalid candidates rejected with reasons, duplicates deduped (30/30 in rerun proof), superseded renders non-uploadable, failed jobs retried with attempt caps and deferred (not silently completed) when production is disabled. No silent successes; CI stalls now fail fast (Section 14) instead of hanging.

## 11. Analytics — PARTIAL
Analytics sync is identity-verified and integrated, using only real API data. All current uploads are private and unwatched, so measured metrics are zero/unavailable — and the system distinguishes "unavailable" from "zero" rather than fabricating figures. Real performance feedback requires ≥5 publicly watched videos, which requires an owner publishing decision.

## 12. Policy & monetization-risk audit — PASS (as an audit)
`docs/POLICY_MONETIZATION_AUDIT.md` assesses reused-content and policy risk (rated MODERATE and inherent to the format), with mitigations: original narration, transformative editing, attribution, human review before public use. No monetization-eligibility promises are made anywhere in the system, dashboard, or docs.

## 13. Dashboard truthfulness — PASS
https://clipuni34-coder.github.io/Automation/ embeds figures read from the persisted `automation-state` branch at deploy time (191 sources screened after the final run, job/awaiting/private-upload counts from state), re-deployed automatically after every daily run. Primeplug shows as sole ACTIVE channel; the other three show INACTIVE/paused.

## 14. End-to-end cloud proof — PASS
Real cloud production runs rendered, QC-gated, hashed and queued actual videos (runs `42037298594`, `42042734671`, `42043674731`, `42046588196`), with artifacts downloaded and frames/audio independently inspected locally. This cycle additionally caught and fixed a real CI defect from job logs: the runner's apt FFmpeg install stalled on a slow mirror (run `42053319028` log evidence); static FFmpeg from the GitHub CDN cut the install step from a 20-minute timeout to **25 seconds** (run `42057039832`), and the final production verification run `42057734304` succeeded with `all_verified`.

## 15. Evidence report — PASS
`docs/EVIDENCE_REPORT.md` is updated through this cycle: commits, test counts, run IDs, artifact IDs, hashes, frame/audio inspections, rights results, scheduler status, YouTube verification, limitations and blockers — including failures and holds, not only successes.

## 16. Privacy & safety constraints — PASS
Nothing public was ever uploaded; all 4 uploads are private. No existing private upload was deleted. No secrets are exposed in code, docs, dashboard, or state (state files carry licence metadata only). Publishing, deletion, and any privacy-status change remain owner-gated.

## 17. Remaining owner decisions & pending items — PENDING
1. Elephant v6 private-upload approval (v4 is superseded but also unuploaded; the publisher guard will only ever upload the latest approved correction).
2. Delete/keep decisions for the two weak private uploads (`ITRMwg5DbxA`, `sQZOvhrNEdE`) and the defective elephant v1 (`dQwD_It3oXM`).
3. First natural scheduler run — due 2026-11-06 06:30 Lagos (calendar only).
4. Any public publishing or monetization steps — only on explicit owner authorization.

---

**Overall:** the autonomous system is complete and verified end-to-end within its safety constraints. No section is FAIL. The only PENDING items are a calendar event and decisions that belong to the owner.
