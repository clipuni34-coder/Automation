// Restore ONE already-produced video for a private, per-video-approved upload.
// No production, re-render, YouTube request, or publication happens here.
import { createReadStream, constants } from "node:fs";
import { copyFile, lstat, readFile, readdir, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { openChannelState } from "../engine/state.js";
import { matchApproval } from "../engine/approval.js";
import { parseReviewedAudience } from "../platforms/youtube/audience.js";

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function isWithin(root, path) {
  const suffix = relative(root, path);
  return Boolean(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
}

async function findNamedFiles(root, name) {
  const files = [];
  const pending = [root];
  let visited = 0;
  while (pending.length) {
    const dir = pending.pop();
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (++visited > 20000) throw new Error("Artifact has too many files");
      const path = join(dir, entry.name);
      // Never follow symlinks from an archive.
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name === name) files.push(path);
    }
  }
  return files;
}

export async function restoreAndReserveApprovedArtifact({
  stateRoot, artifactRoot, approvedCandidateId, approvedSha256, approvedAudience, attemptId
} = {}) {
  const candidateId = String(approvedCandidateId ?? "").trim();
  const fingerprint = String(approvedSha256 ?? "").trim().toLowerCase();
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(candidateId) || !/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new Error("Exact candidate id and SHA-256 approval are required");
  }
  if (parseReviewedAudience(approvedAudience) === null) throw new Error("A separately reviewed audience is required");
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(String(attemptId ?? ""))) throw new Error("A unique upload-attempt id is required");
  if (!stateRoot || !artifactRoot) throw new Error("State and artifact roots are required");
  const root = resolve(stateRoot);
  const state = await openChannelState(root, "Primeplug");
  if ((await state.getControl()).paused) throw new Error("Primeplug is paused; refusing to prepare an upload");

  // Fail closed on missing or corrupt authoritative state, rather than
  // treating an unreadable registry as empty and risking a duplicate.
  const queue = JSON.parse(await readFile(join(root, "Primeplug", "queue.json"), "utf8"));
  const published = JSON.parse(await readFile(join(root, "Primeplug", "published.json"), "utf8"));
  if (!Array.isArray(queue.jobs) || !Array.isArray(published.videos)) throw new Error("Authoritative channel state has an invalid shape");
  if (published.videos.some((video) => video.fingerprint === fingerprint)) throw new Error("This video is already recorded as uploaded");
  const superseded = new Set(queue.jobs.map((job) => job.candidate?.supersedesCandidateId).filter(Boolean));
  const awaiting = queue.jobs.filter((job) => job.status === "completed" && job.result?.produced === true && job.result?.sha256 && !published.videos.some((v) => v.fingerprint === job.result.sha256) && !superseded.has(job.candidate?.id));
  const matching = awaiting.filter((job) => job.candidate?.id === candidateId && String(job.result?.sha256).toLowerCase() === fingerprint);
  const match = matchApproval(awaiting, { approvedCandidateId: candidateId, approvedSha256: fingerprint });
  if (!match.job || matching.length !== 1) throw new Error("Approval must match exactly one completed, unsuperseded video in the queue");
  const job = match.job;
  const rights = job.candidate?.rightsVerification;
  if (rights?.status !== "rights_verified_with_evidence" || rights.commercialUse !== true || rights.derivativesAllowed !== true || rights.observedLicence !== job.candidate?.license?.type) {
    throw new Error("The approved video lacks matching, recorded commercial/derivative rights evidence");
  }
  const credit = job.candidate?.license?.attributionRequirement;
  if (!credit || !String(job.result?.postingPackage?.description ?? "").includes(credit)) throw new Error("The approved posting description is missing required attribution");

  const outputPath = resolve(job.result.outputPath ?? "");
  if (basename(outputPath) !== `${candidateId}.mp4`) throw new Error("Recorded output filename does not match the approved candidate");
  const outputRoot = await realpath(join(root, "Primeplug", "production", "output", "attempts"));
  const outputParent = await realpath(dirname(outputPath));
  if (!isWithin(outputRoot, outputParent)) throw new Error("Recorded output path is outside the production-attempts directory");
  const destination = join(outputParent, basename(outputPath));
  const metadataPath = join(outputParent, `${candidateId}.candidate.json`);
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  if (metadata.id !== candidateId || metadata.sha256 !== fingerprint || metadata.status !== "completed" || metadata.qc?.status !== "passed" || metadata.advancedQc?.passed !== true || metadata.sourceUrl !== job.candidate.sourceUrl) {
    throw new Error("The video does not match its passed production and QC record");
  }
  const artifact = await realpath(artifactRoot);
  const files = await findNamedFiles(artifact, `${candidateId}.mp4`);
  if (files.length !== 1 || await sha256File(files[0]) !== fingerprint) throw new Error("Artifact does not contain exactly one copy of the approved video with the approved hash");
  try {
    const existing = await lstat(destination);
    if (!existing.isFile() || await sha256File(destination) !== fingerprint) throw new Error("Destination already exists but does not contain the approved file");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await copyFile(files[0], destination, constants.COPYFILE_EXCL);
  }
  if (await sha256File(destination) !== fingerprint) throw new Error("Restored file failed its independent hash check");

  // The caller must commit and push this reservation BEFORE sending any
  // YouTube upload request. A later uncertain response then blocks retries.
  const reservation = await state.reserveUploadAttempt({ attemptId, candidateId, fingerprint, approvedAudience });
  return { status: "prepared_not_uploaded", candidateId, fingerprint, approvedAudience, attemptId: reservation.attemptId, restoredPath: destination };
}
