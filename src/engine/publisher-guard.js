// Per-channel publishing guard. Every publishing operation must pass:
// correct channel identity (verified live against the channel's OWN OAuth
// connection), privacy rules, human-approval rules, and idempotency
// (a content fingerprint can never be uploaded twice to the same channel).
// Default mode is dry-run: decisions are made and recorded, nothing uploads.

export async function decidePublish({
  channel, video, state, env = process.env,
  verifyChannelIdentity, // async (channel) => { channelId, title }
  mode = "dry_run" // "dry_run" | "private"
} = {}) {
  const reasons = [];
  if (!channel) reasons.push("Channel configuration is missing");
  if (channel?.operation?.publishingMode === "disabled") reasons.push(`Publishing is disabled for channel ${channel.id}`);
  if (channel?.operation?.paused) reasons.push(`Channel ${channel?.id} is paused`);
  const privacy = video?.privacyStatus ?? "private";
  if (privacy === "public" && env.YOUTUBE_ALLOW_PUBLIC_PUBLISH !== "true") reasons.push("Public publishing is disabled globally (YOUTUBE_ALLOW_PUBLIC_PUBLISH is not true)");
  if (mode === "private" && privacy !== "private") reasons.push("Private publishing mode only allows private uploads");
  if (!video?.fingerprint) reasons.push("Video has no content fingerprint; idempotency cannot be guaranteed");
  if (!video?.approvedByHuman) reasons.push("Human approval has not been recorded for this video");
  if (video?.rightsVerificationStatus === "rejected") reasons.push("Source rights were rejected");

  let identity = null;
  if (!reasons.length && typeof verifyChannelIdentity === "function") {
    try {
      identity = await verifyChannelIdentity(channel);
      const expected = channel.youtubeChannelId || env[channel.expectedChannelIdEnv ?? ""] || "";
      if (!expected) reasons.push(`No expected channel id configured for ${channel.id}`);
      else if (identity.channelId !== expected) reasons.push(`OAuth identity mismatch: connected channel is ${identity.channelId} (${identity.title}), expected ${expected}. Refusing to publish to the wrong channel.`);
    } catch (error) {
      reasons.push(`Channel identity verification failed: ${error.message}`);
    }
  }
  if (!reasons.length && video?.fingerprint && state) {
    if (await state.hasPublishedFingerprint(video.fingerprint)) reasons.push("Duplicate upload prevented: this content fingerprint is already published on this channel");
  }
  return {
    allowed: reasons.length === 0,
    mode, channelId: channel?.id ?? null, identity,
    privacyStatus: privacy, reasons,
    decidedAt: new Date().toISOString()
  };
}
