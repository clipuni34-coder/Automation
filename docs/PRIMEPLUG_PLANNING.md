# Primeplug: from discovered footage to a reviewed production plan

## What this does — and does not do

The daily run stores screened Wikimedia Commons videos in the **Primeplug** planning inbox, including older `awaiting_plan` sources re-fetched from their exact file pages. These are leads, not videos approved for use: search results can be off-niche, misleading, sensitive, or contain third-party material. Each new source stays `awaiting_review` until someone explicitly reviews the actual footage, licence, narration and opening.

A separate, operator-initiated Pixabay search can also save **unverified** leads in the inbox. Unlike the Commons records, these have not passed an independent rights check, cannot yet be promoted or rendered, and are marked `productionBlocked`. The Pixabay-specific rights and production pathway still has to be implemented and tested. This staging feature does not make Pixabay an automated daily footage source.

A reviewed **Commons** plan can become eligible for the normal production queue; Pixabay plans remain blocked. The renderer still checks the current plan, fresh rights evidence, the SHA-256 of the downloaded source, timing, source-audio clearance, speech/caption alignment, framing, overlays and technical QC. A successful render is **not** an approval to upload: inspect the actual result, loop, captions, audience, rights and package, then use the existing separate exact-video private-upload approval. This workflow never changes the schedule or permits public publishing.

**Ongoing editorial work is required.** This is a durable manual review handoff, not an autonomous source-grounded planner. The two assistant-authored, sampled-frame cat plans are held as examples and are not imported into live state or the production queue automatically. The planning gate now requires a human's explicit attestations that they watched the entire source and continuously reviewed the complete selected window. Older reviewed records lacking these fields fail closed and need a new review; if this code is installed, their queued jobs may be cancelled as invalid rather than rendered. A reviewer must keep processing new leads; the system can still produce zero videos when reviews or dependencies are unavailable. Attestations and digests are not signatures or proof that a person actually reviewed the footage; sampled frames, a model-generated draft or a green GitHub run do not replace that review.

## Optional: Pixabay leads, observations and a review copy

**Local, uninstalled work.** The new search returns unverified leads only; it is never called by the daily schedule. Neither a search result, a matched page, an observation report, a SHA-256, a review copy nor a digest is licence clearance or production/upload approval. Pixabay leads cannot be promoted or rendered by the current code. The separate generic storyboard generator's former automatic, uncached Pixabay fallback is **held** in this local version; if installed, this changes storyboard output for all channels using that generator. It falls back to an original graphic instead of requesting stock. The low-level Pixabay adapter remains available to callers but its legacy `licensed_stock` label is not an individual rights finding; calling it directly bypasses the planning cache.

Before any actual use, independently read [Pixabay's API requirements](https://pixabay.com/api/docs/), [full terms](https://pixabay.com/service/terms/) and item page and confirm the permitted purpose. API requests must be cached 24 hours, made for real human requests, and not used for systematic mass downloads. Filtered film/type/tag results do not prove the scene is real, relevant, properly attributed or free of third-party rights. Do not paste keys into chat or put them in query arguments. The human acknowledgements below do not create legal rights and do not themselves authorize a remote operation.

### Coordinated search across checkouts

The new **shared** path reserves a query on a dedicated Git branch before any API request, records the result/failure after receipt, and keeps it for at least 24 hours. It has been tested only with a simulated local Git remote and mocked API. It has **not** been installed, configured on GitHub, initialized or tested with the saved key. Real use needs separate authorization. It requires one matching fetch/push `origin`, a reliable independently verified clock, a stable connection and write access to exactly `refs/heads/primeplug-pixabay-cache`. The code does not create a missing branch, deploy the repository, or change a schedule.

Before initializing that branch, coordinate and stop **all** other users, applications and workflows using the same Pixabay key. Reconcile all existing cache entries, failures and pending requests. If prior use is uncertain, first establish an upper bound on the last possible response and wait at least 24 hours after that bound; an unknown in-flight reservation needs investigation, not deletion. Only with authorization and after reconciling prior use, prepare and review a dedicated branch containing exactly these two regular files:

- `.primeplug-pixabay-cache.json` containing `{ "version": 1, "kind": "primeplug_pixabay_shared_cache", "scope": "all_searches_using_this_cache" }`.
- `Primeplug/pixabay-search-cache.json` containing the reconciled version-1 cache. An empty `{ "version": 1, "entries": [] }` is appropriate **only** when no requests or unresolved reservations exist in the relevant 24-hour window.

Protect the branch from deletion and history rewriting, restrict writers, and allow this authorized tool's direct fast-forward updates. Do not initialize another branch or reset this one to bypass holds. Then, only after explicit permission and after checking the runner clock against a trusted source:

```sh
# Supply PIXABAY_API_KEY through the approved secret mechanism, not here.
PIXABAY_SHARED_SEARCH_AUTHORIZED=true PIXABAY_CLOCK_VERIFIED=true \
STATE_DIR="$PWD/state-review" node scripts/planning-inbox.mjs search-pixabay-shared "funny animals"
```

The tool fetches that branch, validates its tree and cache, pushes a `pending` reservation, sends one search, then pushes the success or failure. Its Git lease option compares the remote head exactly; the code verifies the new commit is a direct child and changes only the cache file, so it refuses a concurrent advance or deletion rather than rewriting history. A pending/uncertain result blocks **all** shared searches, even different queries, indefinitely until a documented investigation reconciles it. An unconfirmed final push is not permission to retry. Success or failure is cached for at least 24 hours after response/failure; at most five distinct recent queries are our conservative operational limit, not Pixabay's published quota. Cached repeats need no key or request. The branch is a single coordination authority: it cannot prevent calls made through another app, a different branch, the low-level adapter, a deleted/restored old branch, or an incorrect/moving wall clock. Protect and monitor the branch, prohibit other access paths, and verify the clock continuously. A clock acknowledgment is not a clock synchronization mechanism.

The shared search commits cache state remotely but adds leads only to the **local** inbox; persist the inbox separately using the safe state procedure below. If intake fails, the result remains in the shared cache and can be ingested by repeating the same query within its cache window without another API request. The search output identifies Pixabay, each source key and whether that lead was saved. `STATE_DIR=state node scripts/planning-inbox.mjs list-pixabay` lists the saved leads without importing the separate cat bootstrap. Never force-push the planning/state branch.

### Single-checkout search (isolated use only)

Use this mode only if the key is not used by **any** other checkout, workflow, app or shared-cache search. Do not mix the local and shared cache modes for the same key. It requires explicit single-checkout and clock acknowledgements:

```sh
# Supply PIXABAY_API_KEY through the approved secret mechanism.
PIXABAY_LOCAL_ONLY_CONFIRMED=true PIXABAY_CLOCK_VERIFIED=true \
STATE_DIR=state node scripts/planning-inbox.mjs search-pixabay "funny cats"
```

The local cache has at most five recent/pending distinct queries, reserves before requesting and starts the 24-hour period at response/failure. An interrupted reservation never auto-expires. Preserve both the cache and inbox; local locks do not coordinate other machines. Loss, restoration of old state or clock errors can defeat the guarantee; investigate rather than clearing state. Both search commands skip the separate cat-bootstrap materialization and make no production or publication decision.

### Inspect one lead or obtain one review copy

`inspect-pixabay` makes direct, unauthenticated HTTPS requests to the exact item page and the provider's policy pages. It does not use the API key, download footage or write to the inbox. A bounded Python-standard-library parser compares the page's canonical ID, creator, visible/structured publication dates, exact JSON-LD rendition, licence label and policy structure. It records hashes of the pages/selected policy sections, but does not interpret the whole licence or prove ownership. A missing/changed page, 403, redirect, missing policy, date ambiguity, pre-2019/boundary-day discrepancy or different rendition is held. An HTML snapshot from an archive is historical research, not a fresh direct response. HTTP 403 must never be bypassed. A consistent result is **still unverified** and requires human inspection of current terms, the complete footage, the proposed edit, third-party permissions and attribution. Optional local-file hashing requires a non-symlink regular file of at most 120 MiB and checks for mutation during hashing.

```sh
STATE_DIR=state node scripts/planning-inbox.mjs inspect-pixabay SOURCE_KEY
# Optional: hash a file you already have. Its origin remains an unverified operator claim.
STATE_DIR=state node scripts/planning-inbox.mjs inspect-pixabay SOURCE_KEY reviewed-source.mp4
```

After separately authorizing **one** review copy and actually reviewing the current terms, an operator can request the exact rendition in the pending record. This is not a batch operation. The command rechecks the item and policy pages directly; on any hold it makes no media request. It refuses redirects, streams at most 120 MiB, checks declared size/type and an MP4 header, exclusively creates the output and records its SHA-256. It does not check that the clip depicts what the API claims, prove third-party rights, set a reviewed plan, render or approve an upload. A later producer would still have to fetch that exact rendition and compare its bytes against the separately reviewed SHA.

```sh
PIXABAY_REVIEW_DOWNLOAD_AUTHORIZED=true PIXABAY_TERMS_REVIEWED=true PIXABAY_CLOCK_VERIFIED=true \
STATE_DIR=state node scripts/planning-inbox.mjs download-pixabay-review SOURCE_KEY /existing/directory/new-review-copy.mp4
```

No real review copy has been downloaded by these local tests. The current sandbox's direct item/terms endpoints returned HTTP 403, so this pathway remains blocked here. Python 3 is required for observations. The reports use the runner's unverified local clock: check it before relying on times, cache duration or freshness.

### Remaining production work

A real provider-specific independent rights verifier and human-reviewed production path are still needed. They must establish a fresh exact-item grant, settle ambiguous dates/licence labels, review policy and attribution changes, exact rendition and source SHA, full footage and third-party rights, and recheck these immediately before production. The current producer allowlist excludes `cdn.pixabay.com`; revocation, QC, audience and separate exact-video publication approval must remain intact. No mocked test proves actual provider access, hosted narration, YouTube OAuth, readiness to publish or legal clearance.

## Locate the inbox

The live state is the `automation-state` Git branch; runner-local files are temporary. From the code checkout and with authorised Git access, work on an up-to-date **separate state worktree**:

```sh
git fetch origin automation-state
git worktree add --detach state-review origin/automation-state
git -C state-review switch -c "planning-review-$(date -u +%Y%m%d%H%M%S)"
STATE_DIR="$PWD/state-review" node scripts/planning-inbox.mjs list
```

The normal CLI and daily run do **not** import the checked-in assistant-reviewed cat examples. A reviewer may deliberately stage just one example's source as **awaiting review** in a local state worktree; the old assistant plan, review and digest are not imported. The example keys are `6aa553f235d8c4810b58d3c4` (Nesnad) and `6d619f3ea41708d0766b601e` (Taiwan). This local write is not a remote push or approval:

```sh
STATE_DIR="$PWD/state-review" node scripts/planning-inbox.mjs stage-example 6aa553f235d8c4810b58d3c4
```

The selected source still needs a freshly checked licence and a separately completed actual footage, claims, attribution and human editorial review before any plan can enter the queue. Existing inbox decisions, including rejections, are not overwritten. A later authorized state push is separate.

The GitHub daily step summary shows pending titles, source keys, queued reviewed plans and whether a video was actually produced. `summary.json` contains the exact Commons page and source URL. `reviewedAvailable` excludes already-queued or previously attempted sources; `reviewedQueued` counts queued/running ones. The inbox is capped at 5,000 records; capacity/intake errors are reported and no existing decision is silently discarded.

## Review one source

1. Run `list`, then inspect the record and its exact Commons file page:

   ```sh
   STATE_DIR="$PWD/state-review" node scripts/planning-inbox.mjs show SOURCE_KEY
   STATE_DIR="$PWD/state-review" node scripts/planning-inbox.mjs template SOURCE_KEY draft.json
   ```

2. Download the *original* `sourceUrl` from the record. A human reviewer must watch the entire source, continuously inspect the entire planned window and the first two seconds, and compare every narration claim to the footage. Do not infer an animal's intentions, a person's identity, location or other facts that are not evidenced. Check the file-page licence and creator, source provenance, any third-party rights, privacy/sensitive content, and whether the footage is suitable for the channel. Avoid unverified music and speech: inbox plans always mute original audio. Commons metadata is evidence, not a legal guarantee.
3. Fill `draft.json`: choose a real window, 25–90 words in at least three sentences, hook/development/payoff, subject, title and an opening review. Compute the original file's SHA-256 using `sha256sum reviewed-source.webm` and copy it into `visualHookReview.sourceSha256`. Use the exact inbox `sourceUrl`. The opening action must be within two seconds and the review must cover at least the first 1.5 seconds. The first on-screen hook must match the beginning of the actual narration.
4. Create a **separate** `review.json`, with the truthful identity and method of the actual human reviewer. Watch the entire source and continuously review the whole selected interval. Sampled frames may supplement, but cannot replace, that review; record any supplemental method and its limitations. Set the three attestations below only if they are true. Preserve useful opening/window evidence in the state worktree or another auditable location. Example field structure (replace every example value with what was actually reviewed):

   ```json
   {
     "decision": "reviewed_against_source",
     "reviewedBy": "Name and role of the actual reviewer",
     "method": "Describe the actual full-source and continuous-window review, and any limitations",
     "humanReviewer": true,
     "entireSourceWatched": true,
     "continuousWindowPlayback": true,
     "coverageStartSeconds": 10,
     "coverageEndSeconds": 25,
     "claimsChecked": true,
     "rightsChecked": true,
     "openingChecked": true,
     "claimNotes": "Describe the visible evidence for each claim in the narration.",
     "rightsNotes": "Describe the original file page, creator and exact licence evidence.",
     "attributionText": "Creator, original work and source, exact licence URL; edited with narration and captions.",
     "shareAlikeAcknowledged": false
   }
   ```

   `coverageStartSeconds` must not be after the window starts; `coverageEndSeconds` must reach the complete window end. The reviewer identity must match the opening review. The three attestations document a human decision but the program cannot authenticate the reviewer or verify that the footage was watched. For CC BY-SA, explicitly assess the obligations and compatible licence for the adaptation, set `shareAlikeAcknowledged` to true, and state the adaptation's compatible licence in attribution. Do not assert compatibility without checking it.
5. Promote only after the actual review:

   ```sh
   STATE_DIR="$PWD/state-review" node scripts/planning-inbox.mjs review SOURCE_KEY draft.json review.json reviewed-source.webm
   STATE_DIR="$PWD/state-review" node scripts/planning-inbox.mjs check
   ```

   The command hashes a non-symlink regular source file (maximum 2 GiB), checks it did not change during hashing, compares it to the opening record, and performs a fresh exact-licence and creator check. The hash identifies bytes, not their origin or the fact of human review; the producer compares its own download to the reviewed hash. `check` checks record consistency and tampering, not the truth of the editorial attestation. For a valid reviewed plan, `template` makes a revision draft with the opening review reset. For an older invalid review with a still-valid source identity, it makes a **blank** fresh draft and carries over none of the old plan; inspect and review from scratch. A corrupted source identity must be investigated, not repaired by guessing. A previously cancelled queue job may require separate operator reconciliation; do not blindly reset it. To reject a source, use:

   ```sh
   STATE_DIR="$PWD/state-review" node scripts/planning-inbox.mjs reject SOURCE_KEY "Actual reviewer" "Specific reason for rejection"
   ```

   Rejection persists and cannot be overwritten by restaging an example. A queued revoked plan is cancelled or held on the next run. The in-process writer lock prevents simultaneous edits in one worktree; after a crash, remove a stale `.planning-inbox.lock` **only after confirming no writer is active**.

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

For an explicitly authorised **single-checkout** Pixabay search against a state worktree, preserve **both** `Primeplug/planning-inbox.json` and `Primeplug/pixabay-search-cache.json`; never push a cache containing a secret. In shared mode, the dedicated cache branch is updated by the search itself, and the local inbox is persisted separately—do not mix the two cache modes. Neither the Pixabay commands nor the general `list` automatically import the assistant-authored examples. Test with copied state first; this guide does not authorise a GitHub secret test or installation.

Never force-push. If another writer advanced the branch, stop, fetch the latest state, inspect and explicitly reconcile every affected review/queue/upload decision, then retry. The daily workflow refuses to automatically overwrite concurrently changed planning, Pixabay cache, source, queue, published or upload-attempt files; on failure, inspect its saved state/report artifacts. Immediately before an inbox production attempt in GitHub Actions, the workflow also checks whether the remote planning file changed since checkout and defers if it did or cannot be checked. This reduces, but does not eliminate, distributed race windows; a final per-video approval is still necessary.

## Operational checks and troubleshooting

- `COMMONS_DISCOVERY=off` disables discovery/recovery. With `DAILY_PRODUCTION_ENABLED=false`, suitable plans are queued but not rendered, and no retry attempt is consumed. Current reports distinguish `considered` queue selections, `deferred` jobs and `attempted` production attempts; an attempt may still be held by a pre-render rights or identity check. Older reports counted deferred selections as `attempted`, even though their queue retry counters were restored. Use a **copy** of state for local experiments; do not point tests at the live branch.
- A green run can still say `NO VIDEO PRODUCED`. Check `productionReport`, pending reviews and individual candidate outcomes. A transient network or provider outage can hold/defer work; an unchanged editorial, overlay, timing or QC hold is not automatically waved through. If the inbox is unreadable or locked, its queued plans are preserved and deferred without consuming a retry; repair or unlock it before production. An explicit rejection still prevents a stale queued plan from rendering.
- The source and exact licence are rechecked immediately before production. The producer checks the downloaded bytes against the reviewed source hash; a changed source needs a new review. A changed creator or licence attribution also holds the attempt.
- Caption placement and loop quality need human review even when their automated heuristics pass. The 15–20 second target is advisory; a shorter/longer output is marked for review, not silently padded or cut.
- A configured and working narration provider and transcription dependencies are necessary. A locally injected test voice does not prove the hosted Gemini/Kokoro credentials or model work.
- YouTube OAuth/refresh-token health is separate from discovery and rendering. Never paste credentials or tokens into the inbox, repository, logs or chat. Existing videos and previously failed uploads are not retried by this planning workflow.

### Prepared provider checks (not installed or run with saved credentials)

A separate manual-only `.github/workflows/primeplug-healthcheck.yml` is prepared locally. After installation and **separate owner authorization**, its `check_youtube_oauth` input refreshes the saved OAuth credential and verifies the expected channel ID, with no upload, video edit, state write or provider error body logged. A missing/invalid expected ID or a mismatch holds the check; a successful identity check does not establish video-level rights, audience, upload authorization or all upload permissions. Google account-verification problems may have other causes; the check does not diagnose them.

Its independent `check_hosted_voice` input sends one short, non-private test sentence to Gemini TTS, checks for a structurally plausible, non-silent WAV, deletes the temporary audio and performs no upload. Non-silence alone cannot establish intelligibility or good delivery. The existing adapter may try a second model after an unavailable/quota response; this can consume quota or incur charges. A successful provider probe does not approve the voice for any video and does not establish caption alignment, full rendering or that Arena's selected `voice-00` is available in the hosted pipeline. Neither check accesses or tests the Pixabay key; coordinated cache setup and explicit authorization are still required for a real Pixabay API test. These are mocked-only local preparations, not evidence that the services currently work.
