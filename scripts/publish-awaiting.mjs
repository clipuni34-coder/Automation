// Approval-gated PRIVATE publishing for produced, QC-passed videos.
//
// A video becomes uploadable only when ALL of these hold:
//   - it was produced by the pipeline and passed QC (job result),
//   - the owner recorded a PER-VIDEO approval naming this exact candidate
//     id AND the exact SHA-256 of its rendered output
//     (APPROVED_CANDIDATE_ID / APPROVED_SHA256). Approval of one video
//     never authorizes another; a re-render (new hash) needs new approval,
//   - that same approval includes an explicit reviewed YouTube audience
//     (APPROVED_AUDIENCE); there is no default audience classification,
//   - decidePublish() passes: channel not paused, publishing not disabled,
//     privacy locked to "private", public requires the separate global
//     opt-in, content fingerprint not already published (idempotency),
//   - the channel's OWN OAuth identity is verified live and matches the
//     configured YouTube channel id.
// A returned video id is recorded immediately so verification failures cannot
// silently cause duplicate uploads. The video is then re-read from the API;
// until that succeeds its record is explicitly marked unverified. A durable
// prior attempt reservation blocks retries whose outcome may be uncertain.
// Nothing here can upload publicly.
import { access, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { resolve, dirname } from "node:path";
import { loadChannels } from "../src/config/channels.js";
import { openChannelState } from "../src/engine/state.js";
import { decidePublish } from "../src/engine/publisher-guard.js";
import { matchApproval } from "../src/engine/approval.js";
import { parseReviewedAudience, observedAudienceStatus } from "../src/platforms/youtube/audience.js";
import { refreshYouTubeAccessToken, uploadYouTubeVideo, waitForYouTubeProcessing, getAuthorizedYouTubeChannel } from "../src/platforms/youtube/publisher.js";

const stateRoot = resolve(process.env.STATE_DIR ?? "data/state");
const channelId = process.env.PUBLISH_CHANNEL_ID ?? "Primeplug";
// Per-video approval only: one candidate id + its exact output hash.
const approvedCandidateId = process.env.APPROVED_CANDIDATE_ID ?? "";
const approvedSha256 = process.env.APPROVED_SHA256 ?? "";
// Bound to the same one-video approval; never infer an audience from topic,
// channel-wide defaults, or the absence of a selection.
const approvedAudience = process.env.APPROVED_AUDIENCE ?? "";
const reviewedMadeForKids = parseReviewedAudience(approvedAudience);
const approved = Boolean(approvedCandidateId && approvedSha256);
const reportPath = resolve(process.env.PUBLISH_REPORT ?? "output/publishing/publish-report.json");
const uploadAttemptId = String(process.env.UPLOAD_ATTEMPT_ID ?? "").trim();

const channels = await loadChannels(process.env.CHANNEL_PROFILES_PATH ?? "config/channels.json");
const channel = channels.find((c) => c.id === channelId);
if (!channel) throw new Error(`Channel ${channelId} is not configured`);
const state = await openChannelState(stateRoot, channel.id);
const queue = await state.getQueue();
const published = await state.getPublished();
const publishedFingerprints = new Set(published.videos.map((v) => v.fingerprint));

// Approval queue: produced + QC-passed jobs never yet published.
// Superseded corrections (an older version replaced by a newer seed) are
// NEVER uploaded: only the latest correction of a candidate may publish.
const supersededIds = new Set(queue.jobs.map((j) => j.candidate?.supersedesCandidateId).filter(Boolean));
// Also honour supersession declared in the current seed manifest chain.
const awaiting = queue.jobs.filter((j) =>
  j.status === "completed" && j.result?.produced === true && j.result?.sha256 &&
  !publishedFingerprints.has(j.result.sha256) && !supersededIds.has(j.candidate?.id));

const approvalMatch = matchApproval(awaiting, { approvedCandidateId, approvedSha256 });
const report = { channelId, generatedAt: new Date().toISOString(), approval: { candidateId: approvedCandidateId || null, sha256: approvedSha256 ? `${String(approvedSha256).slice(0, 12)}…` : null, audience: reviewedMadeForKids === null ? null : approvedAudience, matched: Boolean(approvalMatch.job), reasons: approvalMatch.reasons }, awaitingApproval: awaiting.map((j) => ({ candidateId: j.candidate?.id ?? null, fingerprint: j.result.sha256, title: j.result.title ?? null })), results: [] };
await mkdir(dirname(reportPath), { recursive: true });
async function saveReport() { await writeFile(reportPath, JSON.stringify(report, null, 2)); }

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
  if (job !== approvalMatch.job) {
    entry.status = "awaiting_per_video_approval";
    entry.reasons.push("No per-video approval names this candidate id and output hash; not authorized for upload.");
    continue;
  }
  if (reviewedMadeForKids === null) {
    entry.status = "awaiting_audience_review";
    entry.reasons.push("An explicit, reviewed audience is required for this approved video (made_for_kids or not_made_for_kids); no upload attempted.");
    continue;
  }
  entry.audience = approvedAudience;
  // A previously reserved/uncertain attempt blocks all but the SAME fresh
  // reservation. This is also checked by ordinary daily uploader invocations.
  const attempts = await state.getUploadAttempts();
  const locks = attempts.attempts.filter((a) => a.fingerprint === job.result.sha256 && a.status !== "released_no_upload");
  const lock = locks[0] ?? null;
  if (locks.length > 1 || (lock && (lock.attemptId !== uploadAttemptId || lock.status !== "reserved" || lock.candidateId !== approvedCandidateId || lock.approvedAudience !== approvedAudience)) || (uploadAttemptId && !lock)) {
    entry.status = "blocked_prior_or_mismatched_upload_attempt";
    entry.reasons.push("An upload attempt is missing, mismatched or already pending. Inspect YouTube and reconcile before retrying.");
    continue;
  }
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

  let uploaded = null;
  let requestStarted = false;
  try {
    if (lock) await state.transitionUploadAttempt(lock.attemptId, "attempting");
    entry.status = "upload_request_starting";
    await saveReport();
    const pkg = job.result.postingPackage ?? {};
    const hashtags = Array.isArray(pkg.hashtags) && pkg.hashtags.length ? pkg.hashtags : ["#Shorts"];
    requestStarted = true;
    uploaded = await uploadYouTubeVideo({
      videoPath, accessToken: token.accessToken,
      metadata: {
        title: String(video.title).slice(0, 95),
        description: String(pkg.description ?? ["Original commentary Short by Primeplug.", `Source: ${job.candidate?.sourceUrl ?? ""}`, `Rights: ${job.candidate?.license?.type ?? ""} — ${job.candidate?.license?.attributionRequirement ?? ""}`].join("\n\n")),
        hashtags,
        tags: hashtags.map((t) => String(t).replace(/^#/, "")).slice(0, 20),
        categoryId: "24", privacyStatus: "private", selfDeclaredMadeForKids: reviewedMadeForKids
      }
    });
    // Capture the returned id BEFORE processing or read-back: either can
    // fail after YouTube has already accepted the video. Never auto-retry.
    entry.status = "uploaded_verification_pending";
    entry.videoId = uploaded.videoId;
    entry.watchUrl = uploaded.watchUrl;
    console.log(JSON.stringify({ event: "youtube_upload_accepted", candidateId: entry.candidateId, videoId: uploaded.videoId, watchUrl: uploaded.watchUrl }));
    await saveReport();
    if (lock) await state.transitionUploadAttempt(lock.attemptId, "uploaded", { videoId: uploaded.videoId, watchUrl: uploaded.watchUrl });
    await state.recordPublished({ fingerprint: video.fingerprint, videoId: uploaded.videoId, candidateId: job.candidate?.id ?? null, title: video.title, privacyStatus: "private", channelId: channel.youtubeChannelId, uploadedAt: new Date().toISOString(), processingStatus: null, uploadVerification: "pending", approvedAudience, selfDeclaredMadeForKids: null, madeForKids: null });
    await saveReport();

    const processing = await waitForYouTubeProcessing({ videoId: uploaded.videoId, accessToken: token.accessToken, maxAttempts: 30, intervalMs: 15000 });
    const verifyRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id=${uploaded.videoId}`, { headers: { authorization: `Bearer ${token.accessToken}` } });
    const verifyPayload = await verifyRes.json().catch(() => ({}));
    const v = verifyPayload.items?.[0];
    const verified = verifyRes.ok && Boolean(v) && v.status?.privacyStatus === "private" && v.snippet?.channelId === channel.youtubeChannelId;
    if (!verified) {
      entry.status = "uploaded_unverified";
      entry.reasons.push("Upload returned a video id, but independent verification did not confirm private status on the expected channel. Do not retry; inspect YouTube Studio.");
    } else {
      // The API may omit the owner-declared flag or YouTube may choose a
      // different effective setting; preserve these as separate observations.
      const observedAudience = observedAudienceStatus(v.status);
      entry.observedAudience = observedAudience;
      entry.audienceVerification = observedAudience.selfDeclaredMadeForKids === null ? "not_returned" :
        observedAudience.selfDeclaredMadeForKids === reviewedMadeForKids ? "declaration_matches" : "declaration_mismatch";
      entry.effectiveAudienceVerification = observedAudience.madeForKids === null ? "not_returned" :
        observedAudience.madeForKids === reviewedMadeForKids ? "matches" : "differs";
      if (entry.audienceVerification === "declaration_mismatch" || entry.effectiveAudienceVerification === "differs") {
        entry.reasons.push("YouTube returned an audience setting different from the per-video review; inspect YouTube Studio.");
      }
      await state.updatePublishedVerification(video.fingerprint, { processingStatus: processing.processingStatus, uploadVerification: "private_channel_verified", ...observedAudience });
      if (lock) await state.transitionUploadAttempt(lock.attemptId, "verified");
      entry.status = "uploaded_private_verified";
      entry.processingStatus = processing.processingStatus;
    }
  } catch (error) {
    entry.status = uploaded?.videoId ? "uploaded_unverified" : requestStarted ? "upload_result_unknown" : "upload_not_attempted";
    entry.reasons.push(String(error?.message ?? error).slice(0, 400));
    if (requestStarted || uploaded?.videoId) entry.reasons.push("Do not retry automatically; inspect YouTube Studio to avoid a duplicate.");
    // Keep the reservation blocking retries even if YouTube's response was
    // lost or processing/verification failed after an accepted upload.
    if (lock) {
      try {
        const latest = (await state.getUploadAttempts()).attempts.find((a) => a.attemptId === lock.attemptId);
        if (latest?.status === "attempting") await state.transitionUploadAttempt(lock.attemptId, uploaded?.videoId ? "uploaded" : "unknown", uploaded ? { videoId: uploaded.videoId, watchUrl: uploaded.watchUrl } : {});
      } catch { /* The previously pushed reservation still blocks other runs. */ }
    }
  }
  await saveReport();
}

await saveReport();
console.log(JSON.stringify(report, null, 2));
