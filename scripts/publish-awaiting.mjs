// Approval-gated PRIVATE publishing for produced, QC-passed videos.
//
// A video becomes uploadable only when ALL of these hold:
//   - it was produced by the pipeline and passed QC (job result),
//   - the owner recorded approval for this run (HUMAN_APPROVED_PRIVATE=true,
//     set from an explicit workflow_dispatch input — the approval queue is
//     every produced-but-unpublished job, visible in state + dashboard),
//   - decidePublish() passes: channel not paused, publishing not disabled,
//     privacy locked to "private", public requires the separate global
//     opt-in, content fingerprint not already published (idempotency),
//   - the channel's OWN OAuth identity is verified live and matches the
//     configured YouTube channel id.
// After upload, the video is re-read from the API and its privacy/channel
// are verified before the publish is recorded in persistent state.
// Nothing here can upload publicly.
import { access, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { resolve, dirname } from "node:path";
import { loadChannels } from "../src/config/channels.js";
import { openChannelState } from "../src/engine/state.js";
import { decidePublish } from "../src/engine/publisher-guard.js";
import { refreshYouTubeAccessToken, uploadYouTubeVideo, waitForYouTubeProcessing, getAuthorizedYouTubeChannel } from "../src/platforms/youtube/publisher.js";

const stateRoot = resolve(process.env.STATE_DIR ?? "data/state");
const channelId = process.env.PUBLISH_CHANNEL_ID ?? "Primeplug";
const approved = process.env.HUMAN_APPROVED_PRIVATE === "true";
const reportPath = resolve(process.env.PUBLISH_REPORT ?? "output/publishing/publish-report.json");

const channels = await loadChannels(process.env.CHANNEL_PROFILES_PATH ?? "config/channels.json");
const channel = channels.find((c) => c.id === channelId);
if (!channel) throw new Error(`Channel ${channelId} is not configured`);
const state = await openChannelState(stateRoot, channel.id);
const queue = await state.getQueue();
const published = await state.getPublished();
const publishedFingerprints = new Set(published.videos.map((v) => v.fingerprint));

// Approval queue: produced + QC-passed jobs never yet published.
const awaiting = queue.jobs.filter((j) =>
  j.status === "completed" && j.result?.produced === true && j.result?.sha256 &&
  !publishedFingerprints.has(j.result.sha256));

const report = { channelId, generatedAt: new Date().toISOString(), approvedByHuman: approved, awaitingApproval: awaiting.map((j) => ({ candidateId: j.candidate?.id ?? null, fingerprint: j.result.sha256, title: j.result.title ?? null })), results: [] };

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

let token = null;
async function verifyIdentity(ch) {
  if (!token) token = await refreshYouTubeAccessToken({ refreshToken: process.env[ch.refreshTokenEnv] || process.env.REFRESH_TOKEN });
  const identity = await getAuthorizedYouTubeChannel({ accessToken: token.accessToken });
  return { channelId: identity.channelId, title: identity.title };
}

for (const job of awaiting) {
  const entry = { candidateId: job.candidate?.id ?? null, fingerprint: job.result.sha256, status: "not_attempted", reasons: [] };
  report.results.push(entry);
  const videoPath = job.result.outputPath ? resolve(job.result.outputPath) : null;
  let filePresent = false;
  if (videoPath) { try { await access(videoPath); filePresent = true; } catch { filePresent = false; } }
  if (!filePresent) { entry.status = "awaiting_approval_file_not_in_runner"; entry.reasons.push("Rendered file is not present in this runner (it is preserved in the production artifact); re-run production in the same cycle as the approved upload, or supply the artifact."); continue; }
  const actualSha = await sha256File(videoPath).catch(() => null);
  if (actualSha !== job.result.sha256) { entry.status = "blocked_fingerprint_mismatch"; entry.reasons.push("File checksum does not match the QC-recorded fingerprint; refusing to upload."); continue; }

  const video = {
    fingerprint: job.result.sha256,
    privacyStatus: "private",
    approvedByHuman: approved,
    title: job.result.title ?? job.candidate?.title ?? "Primeplug Short",
    rightsVerificationStatus: job.candidate?.license?.verificationStatus ?? "evidence_recorded"
  };
  const decision = await decidePublish({ channel, video, state, verifyChannelIdentity: verifyIdentity, mode: "private" });
  entry.decision = { allowed: decision.allowed, reasons: decision.reasons, identity: decision.identity };
  if (!decision.allowed) { entry.status = approved ? "blocked_by_guard" : "awaiting_approval"; continue; }

  try {
    const pkg = job.result.postingPackage ?? {};
    const uploaded = await uploadYouTubeVideo({
      videoPath, accessToken: token.accessToken,
      metadata: {
        title: String(video.title).slice(0, 95),
        description: String(pkg.description ?? `Original commentary Short by Primeplug.\n\nSource: ${job.candidate?.sourceUrl ?? ""}\nRights: ${job.candidate?.license?.type ?? ""} — ${job.candidate?.license?.attributionRequirement ?? ""}\nUploaded privately for owner review. Not published publicly.`).slice(0, 4500),
        tags: (pkg.hashtags ?? ["#shorts", "#funny", "#moments"]).map((t) => String(t).replace(/^#/, "")).slice(0, 20),
        categoryId: "24", privacyStatus: "private", selfDeclaredMadeForKids: false
      }
    });
    const processing = await waitForYouTubeProcessing({ videoId: uploaded.videoId, accessToken: token.accessToken, maxAttempts: 30, intervalMs: 15000 });
    const verifyRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id=${uploaded.videoId}`, { headers: { authorization: `Bearer ${token.accessToken}` } });
    const verifyPayload = await verifyRes.json().catch(() => ({}));
    const v = verifyPayload.items?.[0];
    const verified = Boolean(v) && v.status?.privacyStatus === "private" && v.snippet?.channelId === channel.youtubeChannelId;
    if (!verified) { entry.status = "uploaded_unverified"; entry.videoId = uploaded.videoId; entry.reasons.push("Upload returned but independent verification did not confirm private status on the expected channel."); continue; }
    await state.recordPublished({ fingerprint: video.fingerprint, videoId: uploaded.videoId, candidateId: job.candidate?.id ?? null, title: video.title, privacyStatus: "private", channelId: channel.youtubeChannelId, uploadedAt: new Date().toISOString(), processingStatus: processing.processingStatus });
    entry.status = "uploaded_private_verified";
    entry.videoId = uploaded.videoId;
    entry.watchUrl = uploaded.watchUrl;
  } catch (error) {
    entry.status = "upload_failed";
    entry.reasons.push(String(error?.message ?? error).slice(0, 400));
  }
}

await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
