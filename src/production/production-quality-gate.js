export function evaluateProductionVisualQuality(quality) {
  const reasons = [];
  if (!quality || typeof quality !== "object") reasons.push("Missing visual quality report.");
  else {
    if (quality.status !== "passed") reasons.push("Visual quality status is not passed.");
    if (!Number.isFinite(Number(quality.score)) || Number(quality.score) < 85) reasons.push("Visual quality score must be at least 85/100.");
    if (quality.rendered?.status !== "passed") reasons.push("Encoded-video technical inspection did not pass.");
    const semantic = quality.semanticReview;
    const expectedScenes = Number(quality.storyboard?.metrics?.sceneCount ?? 0);
    if (semantic?.status !== "passed") reasons.push("Scene-level semantic visual verification did not pass.");
    if (!Number.isInteger(semantic?.reviewedScenes) || semantic.reviewedScenes < 1) reasons.push("No scene frames were semantically reviewed.");
    if (expectedScenes < 1 || semantic?.reviewedScenes !== expectedScenes) reasons.push("Every storyboard scene must receive semantic visual verification.");
    if (Number(semantic?.failedScenes ?? 0) !== 0) reasons.push("One or more scenes failed semantic visual verification.");
  }
  return { eligible: reasons.length === 0, reasons };
}

export function assertProductionVisualQuality(quality) {
  const result = evaluateProductionVisualQuality(quality);
  if (!result.eligible) {
    throw new Error("Production visual-quality gate blocked this video: " + result.reasons.join(" "));
  }
  return result;
}
