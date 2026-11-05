// Shared candidate classification and ranking logic (pure functions, unit-tested).

export function classifyRepurpose({ exitCode, result, stderr }) {
  if (result?.status === "completed") return { status: "completed", reason: null };
  if (result?.status === "editorial_review_required") return { status: "held_editorial_gate", reason: `Editorial gate held this footage (average selected score ${result.plan?.editorialQuality?.averageSelectedScore ?? "unknown"}/10; minimum 5.5/10). Not rendered.` };
  const text = `${stderr ?? ""} ${result?.error ?? ""}`;
  if (/no audio stream/i.test(text)) return { status: "rejected_no_audio", reason: "Source has no audio stream; nothing to transcribe." };
  if (/no valid word-level timestamps|no valid word timestamps|returned no.*words/i.test(text)) return { status: "rejected_no_speech", reason: "Transcription produced no usable speech (no intelligible spoken words found)." };
  if (exitCode === 1) return { status: "failed_pipeline", reason: `Repurpose pipeline failed: ${text.trim().slice(-400) || "unknown error"}` };
  return { status: "failed_pipeline", reason: `Unexpected pipeline outcome (exit ${exitCode}, status ${result?.status ?? "none"}).` };
}

export function rankRow(candidate) {
  const eligible = candidate?.status === "completed" && ["passed", "passed_after_repair"].includes(candidate?.qc?.status ?? "");
  const base = {
    id: candidate?.id ?? "unknown", label: candidate?.label ?? null, creator: candidate?.creator ?? null,
    sourceUrl: candidate?.sourceUrl ?? null, rightsEvidenceUrl: candidate?.rightsEvidenceUrl ?? null,
    licenseType: candidate?.license?.type ?? null,
    verificationStatus: candidate?.rightsVerification?.status ?? candidate?.license?.verificationStatus ?? null,
    originalResolution: candidate?.originalProbe ? `${candidate.originalProbe.width}x${candidate.originalProbe.height}` : null,
    status: candidate?.status ?? "missing_result",
    reason: candidate?.reason ?? (candidate?.status === "missing_result" || !candidate ? "No structured result was produced for this candidate in the current run." : null),
    title: candidate?.pipeline?.title ?? null, outputPath: candidate?.outputPath ?? null,
    thumbnailPath: candidate?.thumbnailPath ?? null, sha256: candidate?.sha256 ?? null,
    selectedMoments: candidate?.pipeline?.selectedMoments ?? []
  };
  if (!eligible) return { ...base, eligible: false, rankScore: null, editorialAverage: candidate?.pipeline?.editorialAverage ?? null, visualQcScore: candidate?.pipeline?.visualQualityScore ?? null, technicalQc: candidate?.qc?.status ?? null };
  const editorial = Number(candidate.pipeline?.editorialAverage ?? 0);
  const visual = Number(candidate.pipeline?.visualQualityScore ?? 0);
  const height = Number(candidate.originalProbe?.height ?? 0);
  const resolutionScore = height >= 1080 ? 10 : height >= 720 ? 8 : 2;
  const duration = Number(candidate.outputProbe?.durationSeconds ?? 0);
  const durationScore = duration >= 10 && duration <= 55 ? 10 : duration >= 6 ? 7 : duration > 0 ? 4 : 0;
  const rankScore = Number((editorial * 0.4 + (visual / 100) * 10 * 0.25 + resolutionScore * 0.2 + durationScore * 0.15).toFixed(2));
  return { ...base, eligible: true, rankScore, editorialAverage: editorial || null, visualQcScore: visual || null, technicalQc: candidate.qc?.status ?? null, repaired: candidate.qc?.repaired ?? false, durationSeconds: duration || null, resolutionScore, durationScore };
}

export function summariseComparison(rows, rankedAt = new Date().toISOString()) {
  const sorted = [...rows].sort((a, b) => (b.rankScore ?? -1) - (a.rankScore ?? -1));
  const winnerRow = sorted.find((r) => r.eligible) ?? null;
  return {
    rankedAt, winner: winnerRow?.id ?? null,
    winnerRationale: winnerRow
      ? `${winnerRow.label} is the highest-ranked candidate that completed the pipeline and passed QC (rank ${winnerRow.rankScore}/10; editorial ${winnerRow.editorialAverage}/10; visual QC ${winnerRow.visualQcScore}/100; native source ${winnerRow.originalResolution}; ${winnerRow.durationSeconds}s).`
      : "No candidate completed the pipeline and passed QC in this run, so no winner is declared.",
    counts: {
      total: sorted.length,
      completed: sorted.filter((r) => r.status === "completed").length,
      eligible: sorted.filter((r) => r.eligible).length,
      heldOrRejected: sorted.filter((r) => String(r.status).startsWith("held_") || String(r.status).startsWith("rejected_")).length,
      failed: sorted.filter((r) => String(r.status).startsWith("failed_") || r.status === "missing_result").length
    },
    candidates: sorted
  };
}
