// End-to-end pipeline orchestrator:
//   rights gate -> transcript candidates -> moment selection -> render ->
//   technical QC (+1 auto-repair) -> posting package -> [guarded private upload]
// Every stage is fail-closed and recorded. Upload is OFF unless the caller
// explicitly requests it, human approval is recorded, credentials are
// configured, the channel identity matches, and privacy is private.
import { assessAssetRights } from "../rights/asset-rights.js";
import { buildTranscriptCandidates } from "../clips/transcript-candidates.js";
import { runAuthorizedReedit } from "../clips/authorized-reedit.js";
import { buildRepurposePackage } from "../clips/repurpose-package.js";
import { qcAndRepair, probeVideo } from "../production/qc-repair.js";
import { selectThumbnailTime } from "../production/thumbnail.js";
import { auditCredentials } from "../config/credentials.js";

export async function runEndToEnd(input, options = {}) {
  const stages = [];
  const stage = (name, status, detail = {}) => stages.push({ name, status, ...detail });
  const platform = input.platform ?? "youtube_shorts";

  // Stage 1 — rights gate (rejects unclear/unacceptable rights before any work)
  const rights = assessAssetRights(input.source, { platform });
  stage("rights_gate", rights.allowed ? "passed" : "blocked", { reasons: rights.reasons, verificationStatus: rights.verificationStatus });
  if (!rights.allowed) return { status: "rejected_rights", stages, rendered: null, postingPackage: null, upload: { status: "not_attempted" } };

  // Stage 2 — transcript candidates (word-level timestamps required)
  let candidates;
  try {
    candidates = buildTranscriptCandidates(input.transcriptWords, input.candidateOptions ?? {});
  } catch (error) {
    stage("transcription", "failed", { error: error.message });
    return { status: "transcription_failed", stages, rendered: null, postingPackage: null, upload: { status: "not_attempted" } };
  }
  stage("transcription", "passed", { wordCount: input.transcriptWords.length, candidateCount: candidates.length, engine: input.transcriptionEngine ?? "provided_word_timestamps" });

  // Stage 3+4 — moment selection + render (runAuthorizedReedit holds weak
  // material below the 5.5/10 editorial gate instead of rendering it)
  const reedit = await (options.runReedit ?? runAuthorizedReedit)({
    sourceLocalPath: input.sourceLocalPath, outputPath: input.outputPath,
    source: input.source, transcriptSegments: candidates,
    targetDurationSeconds: input.targetDurationSeconds ?? 45, platform,
    audioPath: input.audioPath,
  }, { ffmpegPath: options.ffmpegPath ?? "ffmpeg", ffprobePath: options.ffprobePath ?? "ffprobe" });
  stage("clip_selection_and_render", reedit.status, {
    selectedMoments: reedit.plan?.editDecisionList?.length ?? 0,
    averageEditorialScore: reedit.plan?.editorialQuality?.averageSelectedScore ?? null,
  });
  if (reedit.status !== "completed") {
    return { status: reedit.status === "editorial_review_required" ? "held_weak_footage" : reedit.status, stages, rendered: null, postingPackage: null, upload: { status: "not_attempted" }, plan: reedit.plan };
  }

  // Stage 5 — technical QC with one automatic repair attempt
  const qc = await (options.qc ?? qcAndRepair)(reedit.outputPath, { ffmpegPath: options.ffmpegPath ?? "ffmpeg", ffprobePath: options.ffprobePath ?? "ffprobe" });
  stage("quality_control", qc.status, { repaired: qc.repaired, attempts: qc.attempts, failures: qc.failures, probe: qc.probe });
  if (qc.status === "failed") return { status: "qc_failed", stages, rendered: reedit.rendered, postingPackage: null, upload: { status: "not_attempted" } };
  const finalProbe = await probeVideo(reedit.outputPath, { ffprobePath: options.ffprobePath ?? "ffprobe" }).catch(() => qc.probe);

  // Stage 6 — posting package (always requires human approval; rights are
  // declaration-only until independently verified, by design)
  const postingPackage = buildRepurposePackage({ plan: reedit.plan, renderResult: { ...reedit.rendered, ...finalProbe, status: "rendered" }, thumbnailPath: input.thumbnailPath ?? null });
  stage("posting_package", postingPackage.status, { approvalStatus: postingPackage.editorialApproval.status, title: postingPackage.title });

  // Stage 7 — guarded PRIVATE upload only. All conditions must hold.
  const upload = { status: "blocked", reasons: [] };
  const creds = auditCredentials(options.env ?? process.env);
  if (!input.uploadRequested) upload.reasons.push("Upload not requested (default: off)");
  if (input.humanApproved !== true) upload.reasons.push("Human approval not recorded");
  if (!creds.capabilities.youtube_upload.ready) upload.reasons.push("Missing GitHub secrets: " + creds.capabilities.youtube_upload.missing.join(", "));
  if (upload.reasons.length === 0) {
    if (typeof options.uploader !== "function") {
      upload.status = "blocked"; upload.reasons.push("No uploader configured in this runtime");
    } else {
      const result = await options.uploader({ videoPath: reedit.outputPath, postingPackage, channel: input.channel ?? null });
      upload.status = result?.privacyStatus === "private" ? "uploaded_private" : "blocked";
      if (upload.status === "blocked") upload.reasons.push("Uploader did not confirm a private upload");
      else Object.assign(upload, { videoId: result.videoId ?? null, watchUrl: result.watchUrl ?? null });
    }
  }
  stage("youtube_upload_private", upload.status, { reasons: upload.reasons });

  return {
    status: "completed", stages, rendered: { ...reedit.rendered, probe: finalProbe },
    postingPackage, upload,
    thumbnailTimeSeconds: selectThumbnailTime(reedit.plan, finalProbe?.durationSeconds ?? 0),
    nextStep: upload.status === "uploaded_private"
      ? "Poll YouTube processing, then sync analytics after publication window."
      : "Human reviews the package in the mobile interface; upload stays blocked until approval + credentials are present.",
  };
}
