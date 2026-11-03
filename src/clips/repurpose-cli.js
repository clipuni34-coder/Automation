import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { buildTranscriptCandidates } from "./transcript-candidates.js";
import { analyzeMediaSignals } from "./media-signals.js";
import { buildRepurposePackage } from "./repurpose-package.js";
import { runAuthorizedReedit } from "./authorized-reedit.js";
import { selectThumbnailTime } from "../production/thumbnail.js";

function fail(message) { throw new Error(message); }

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: npm run repurpose -- <repurpose-input.json> [result.json]");
  process.exitCode = 1;
} else {
  try {
    const input = JSON.parse(await readFile(resolve(inputPath), "utf8"));
    if (!input.sourceLocalPath || !input.outputPath || !input.source?.sourceUrl) {
      fail("Input requires sourceLocalPath, outputPath and source.sourceUrl.");
    }
    const sourceLocalPath = resolve(input.sourceLocalPath);
    const probe = spawnSync(input.ffprobePath ?? "ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", sourceLocalPath
    ], { encoding: "utf8" });
    if (probe.status !== 0) fail("FFprobe could not inspect the source video: " + (probe.stderr || "unknown error").trim());
    const durationSeconds = Number(probe.stdout.trim());
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) fail("Source video has no valid duration.");

    const mediaSignals = input.mediaAnalysis === false ? null : analyzeMediaSignals(sourceLocalPath, {
      ffmpegPath: input.ffmpegPath ?? "ffmpeg",
      ffprobePath: input.ffprobePath ?? "ffprobe",
      durationSeconds
    });

    let words = input.transcriptWords;
    let transcriptPath = input.transcriptPath ? resolve(input.transcriptPath) : null;
    if (!Array.isArray(words) || words.length === 0) {
      transcriptPath ??= resolve(input.outputPath + ".transcript.json");
      const python = input.pythonPath ?? process.env.PYTHON ?? "python3";
      const transcription = spawnSync(python, [
        "scripts/transcribe_video.py", sourceLocalPath, transcriptPath,
        "--model", input.whisperModel ?? "base"
      ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      if (transcription.status !== 0) fail("Whisper transcription failed: " + (transcription.stderr || transcription.stdout || "unknown error").trim());
      const saved = JSON.parse(await readFile(transcriptPath, "utf8"));
      words = saved.words;
    }

    const candidates = buildTranscriptCandidates(words, { ...(input.candidateOptions ?? {}), mediaSignals });
    const source = { ...input.source, durationSeconds };
    const result = await runAuthorizedReedit({
      sourceLocalPath,
      outputPath: input.outputPath,
      source,
      transcriptSegments: candidates,
      targetDurationSeconds: input.targetDurationSeconds ?? 45,
      platform: input.platform ?? "youtube_shorts"
    }, {
      ffmpegPath: input.ffmpegPath ?? "ffmpeg",
      ffprobePath: input.ffprobePath ?? "ffprobe"
    });
    let thumbnailPath = null;
    let thumbnailTimeSeconds = null;
    if (result.status === "completed") {
      const thumbnail = resolve(input.thumbnailPath ?? input.outputPath.replace(/\.[^.]+$/i, ".thumbnail.jpg"));
      const frameTime = selectThumbnailTime(result.plan, result.rendered?.durationSeconds ?? 0);
      thumbnailTimeSeconds = frameTime;
      const extracted = spawnSync(input.ffmpegPath ?? "ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(frameTime), "-i", result.outputPath, "-frames:v", "1", "-q:v", "2", thumbnail], { stdio: "ignore" });
      if (extracted.status === 0) thumbnailPath = thumbnail;
    }
    const postingPackage = result.status === "completed"
      ? buildRepurposePackage({ plan: result.plan, renderResult: result.rendered, thumbnailPath })
      : null;
    const output = resolve(process.argv[3] ?? inputPath.replace(/\.json$/i, ".repurpose-result.json"));
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify({
      ...result,
      postingPackage,
      editorialApproval: postingPackage?.editorialApproval ?? null,
      transcription: {
        engine: Array.isArray(input.transcriptWords) ? "provided_word_timestamps" : "faster-whisper",
        transcriptPath,
        wordCount: words.length,
        candidateCount: candidates.length,
        scoringMethod: "local_lexical_heuristic_plus_ffmpeg_media_signals",
        mediaAnalysis: mediaSignals ? {
          engine: mediaSignals.engine,
          sceneChangeCount: mediaSignals.sceneChanges.length,
          silenceIntervalCount: mediaSignals.silenceIntervals.length,
          audioPresent: mediaSignals.audioPresent
        } : { status: "disabled" }
      }
    }, null, 2));
    console.log(JSON.stringify({
      status: result.status,
      outputPath: result.outputPath,
      durationSeconds: result.rendered?.durationSeconds ?? null,
      candidates: candidates.length,
      selectedMoments: result.plan?.editDecisionList?.length ?? 0,
      transcription: Array.isArray(input.transcriptWords) ? "provided" : "faster-whisper",
      rights: result.plan?.rights?.status ?? "blocked",
      thumbnailPath,
      thumbnailTimeSeconds,
      postingPackage: postingPackage ? postingPackage.status : "not_created",
      editorialApproval: postingPackage?.editorialApproval?.status ?? "not_ready"
    }, null, 2));
    if (result.status !== "completed") process.exitCode = 2;
  } catch (error) {
    console.error(JSON.stringify({ status: "failed", error: error.message }));
    process.exitCode = 1;
  }
}
