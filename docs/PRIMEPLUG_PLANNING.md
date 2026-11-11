# Primeplug: from discovered footage to a reviewed production plan

## What this does — and does not do

The daily run stores screened Wikimedia Commons videos in the **Primeplug** planning inbox, including older `awaiting_plan` sources re-fetched from their exact file pages. These are leads, not videos approved for use: search results can be off-niche, misleading, sensitive, or contain third-party material. Each new source stays `awaiting_review` until someone explicitly reviews the actual footage, licence, narration and opening.

A reviewed plan becomes eligible for the normal production queue. The renderer still checks the current plan, fresh rights evidence, the SHA-256 of the downloaded source, timing, source-audio clearance, speech/caption alignment, framing, overlays and technical QC. A successful render is **not** an approval to upload: inspect the actual result, loop, captions, audience, rights and package, then use the existing separate exact-video private-upload approval. This workflow never changes the schedule or permits public publishing.

**Ongoing editorial work is required.** This is a durable manual review handoff, not an autonomous source-grounded planner. The two initial cat plans are finite examples, not an inexhaustible supply. A reviewer must keep processing new leads; the system can still produce zero videos when reviews or dependencies are unavailable. A model-generated draft, a digest, sampled frames or a green GitHub run does not prove the claims are true or that a human independently reviewed them.

## Locate the inbox

The live state is the `automation-state` Git branch; runner-local files are temporary. From the code checkout and with authorised Git access, work on an up-to-date **separate state worktree**:

```sh
git fetch origin automation-state
git worktree add --detach state-review origin/automation-state
git -C state-review switch -c "planning-review-$(date -u +%Y%m%d%H%M%S)"
STATE_DIR="$PWD/state-review" node scripts/planning-inbox.mjs list
```

`list`, `show`, `template`, `review`, `reject`, and `check` first copy any valid reviewed bootstrap records into that local inbox. This is a **local state write** even for `list`/`check`; it is not a remote push. Existing pending/rejected state always overrides an older bootstrap. The ordinary daily run also materializes the bootstrap into persisted state.

The GitHub daily step summary shows pending titles, source keys, queued reviewed plans and whether a video was actually produced. `summary.json` contains the exact Commons page and source URL. `reviewedAvailable` excludes already-queued or previously attempted sources; `reviewedQueued` counts queued/running ones. The inbox is capped at 5,000 records; capacity/intake errors are reported and no existing decision is silently discarded.

## Review one source

1. Run `list`, then inspect the record and its exact Commons file page:

   ```sh
   STATE_DIR="$PWD/state-review" node scripts/planning-inbox.mjs show SOURCE_KEY
   STATE_DIR="$PWD/state-review" node scripts/planning-inbox.mjs template SOURCE_KEY draft.json
   ```

2. Download the *original* `sourceUrl` from the record, inspect the actual planned window and the first two seconds, and compare every narration claim to the footage. Do not infer an animal's intentions, a person's identity, location or other facts that are not evidenced. Check the file-page licence and creator, source provenance, any third-party rights, privacy/sensitive content, and whether the footage is suitable for the channel. Avoid unverified music and speech: inbox plans always mute original audio. Commons metadata is evidence, not a legal guarantee.
3. Fill `draft.json`: choose a real window, 25–90 words in at least three sentences, hook/development/payoff, subject, title and an opening review. Compute the original file's SHA-256 using `sha256sum reviewed-source.webm` and copy it into `visualHookReview.sourceSha256`. Use the exact inbox `sourceUrl`. The opening action must be within two seconds and the review must cover at least the first 1.5 seconds. The first on-screen hook must match the beginning of the actual narration.
4. Create a **separate** `review.json`, with truthful reviewer identity and method. Inspect the whole selected interval; if using sampled frames, say so and record the sample rate/coverage, rather than claiming continuous or human review. Preserve useful opening/window evidence in the state worktree or another auditable location. Example field structure (replace every example value with what was actually reviewed):

   ```json
   {
     "decision": "reviewed_against_source",
     "reviewedBy": "Name and role of the actual reviewer",
     "method": "Describe the actual footage review and its limitations",
     "coverageStartSeconds": 10,
     "coverageEndSeconds": 24.5,
     "claimsChecked": true,
     "rightsChecked": true,
     "openingChecked": true,
     "claimNotes": "Describe the visible evidence for each claim in the narration.",
     "rightsNotes": "Describe the original file page, creator and exact licence evidence.",
     "attributionText": "Creator, original work and source, exact licence URL; edited with narration and captions.",
     "shareAlikeAcknowledged": false
   }
   ```

   `coverageStartSeconds` must not be after the window starts; `coverageEndSeconds` must reach at least the window end minus 0.5 seconds. The reviewer identity must match the opening review. For CC BY-SA, explicitly assess the obligations and compatible licence for the adaptation, set `shareAlikeAcknowledged` to true, and state the adaptation's compatible licence in attribution. Do not assert compatibility without checking it.
5. Promote only after the actual review:

   ```sh
   STATE_DIR="$PWD/state-review" node scripts/planning-inbox.mjs review SOURCE_KEY draft.json review.json reviewed-source.webm
   STATE_DIR="$PWD/state-review" node scripts/planning-inbox.mjs check
   ```

   The command computes the file hash, compares it to the opening record, and performs a fresh exact-licence and creator check. `check` checks record consistency and tampering, not the truth of the editorial attestation. To revise an existing reviewed plan, `template` creates a revision draft with the old opening review deliberately reset; inspect and review it again. To reject a source, use:

   ```sh
   STATE_DIR="$PWD/state-review" node scripts/planning-inbox.mjs reject SOURCE_KEY "Actual reviewer" "Specific reason for rejection"
   ```

   Rejection persists and overrides a reviewed bootstrap. A queued revoked plan is cancelled or held on the next run. The in-process writer lock prevents simultaneous edits in one worktree; after a crash, remove a stale `.planning-inbox.lock` **only after confirming no writer is active**.

## Persist the review safely

Coordinate with the daily workflow: do not edit/push state while a daily or private-upload workflow is running or near its scheduled slot. Reviewers and the live workflow must not write the same state concurrently. After reviewing, check the diff and include only intended records/evidence:

```sh
git -C state-review status --short
git -C state-review diff -- Primeplug/planning-inbox.json
git -C state-review add Primeplug/planning-inbox.json
# Add any deliberately retained review-evidence files as well.
git -C state-review commit -m "state: review Primeplug source"
git -C state-review push origin HEAD:refs/heads/automation-state
```

Never force-push. If another writer advanced the branch, stop, fetch the latest state, inspect and explicitly reconcile every affected review/queue/upload decision, then retry. The daily workflow refuses to automatically overwrite concurrently changed planning, source, queue, published or upload-attempt files; on failure, inspect its saved state/report artifacts. Immediately before an inbox production attempt in GitHub Actions, the workflow also checks whether the remote planning file changed since checkout and defers if it did or cannot be checked. This reduces, but does not eliminate, distributed race windows; a final per-video approval is still necessary.

## Operational checks and troubleshooting

- `COMMONS_DISCOVERY=off` disables discovery/recovery. With `DAILY_PRODUCTION_ENABLED=false`, suitable plans are queued but not rendered, and no retry attempt is consumed. Current reports distinguish `considered` queue selections, `deferred` jobs and `attempted` production attempts; an attempt may still be held by a pre-render rights or identity check. Older reports counted deferred selections as `attempted`, even though their queue retry counters were restored. Use a **copy** of state for local experiments; do not point tests at the live branch.
- A green run can still say `NO VIDEO PRODUCED`. Check `productionReport`, pending reviews and individual candidate outcomes. A transient network or provider outage can hold/defer work; an unchanged editorial, overlay, timing or QC hold is not automatically waved through. If the inbox is unreadable or locked, its queued plans are preserved and deferred without consuming a retry; repair or unlock it before production. An explicit rejection still prevents a stale queued plan from rendering.
- The source and exact licence are rechecked immediately before production. The producer checks the downloaded bytes against the reviewed source hash; a changed source needs a new review. A changed creator or licence attribution also holds the attempt.
- Caption placement and loop quality need human review even when their automated heuristics pass. The 15–20 second target is advisory; a shorter/longer output is marked for review, not silently padded or cut.
- A configured and working narration provider and transcription dependencies are necessary. A locally injected test voice does not prove the hosted Gemini/Kokoro credentials or model work.
- YouTube OAuth/refresh-token health is separate from discovery and rendering. Never paste credentials or tokens into the inbox, repository, logs or chat. Existing videos and previously failed uploads are not retried by this planning workflow.
