# Primeplug: bounded production retries

## What the daily run does

The existing external scheduler remains responsible for the 06:30 Africa/Lagos production dispatch and its after-slot catch-up checks. The change described here is inside the dispatched production run; it adds no worker, scheduler, upload, or publishing authorization.

For a production-enabled Primeplug run, the engine makes up to three bounded discovery/production passes and attempts no more than four jobs in total (or the channel's lower configured candidate limit). It stops as soon as a video is produced, leaves other queued work for a later run, and records one aggregate run with per-pass counts and a stop reason. Counts across passes are observations, not necessarily distinct candidates. When no video passes production, the report says `no_production`.

The engine does not repeatedly reopen unchanged quality holds or ordinary test fixtures. A genuinely changed, complete production plan can be reviewed again; confirmed temporary network/provider failures remain subject to attempt limits and can be reconsidered on a later Lagos day. A missing-TTS hold can be reconsidered when a narration provider is configured. Discovering footage alone does not supply a usable edit and narration plan.

The queue distinguishes footage awaiting a plan and work deferred by the daily cap from material actually attempted. Legacy Commons tracking-URL variants are checked against existing jobs to prevent accidentally reusing the same source. Current candidate identity and independently observed rights are checked again immediately before production. A cited Commons file page must identify the exact original source asset, not just a licence for some other file.

## Initial candidates and limits

Two distinct new sources have draft narration/edit plans: Nesnad's Tokyo puppies footage (CC BY 4.0) and Natural Resources Wales's Skomer seal footage (CC BY 3.0). The named creator, source, applicable licence and modification notice are included in the proposed credit. Commons metadata and the matching original asset were checked, and preliminary sampled source-overlay and framing checks were performed. These are **candidates**, not finished or approved videos; their actual narration timing, output framing, overlays and full QC must still pass. The seal plan explicitly mutes the source audio.

Both proposed plans declare the minimum footage needed to include their visual payoff. If the generated narration would cut the story or be cut off by the footage, the video is held. Independent rights checks do not constitute legal certification; review the full source, output, attribution and intended use before approving any upload.

The existing inventory is finite. Commons search results remain `needsProductionPlan` until a truthful, complete plan is authored. These changes cannot guarantee a finished video every day when sources, rights, TTS or quality checks are unavailable.

## Upload safety

No production retry performs an upload. Private upload requires the existing explicit per-video approval tied to the candidate ID and exact output SHA-256, plus a separately reviewed audience selection. Public publishing remains off. Existing YouTube videos are not edited by this retry.
