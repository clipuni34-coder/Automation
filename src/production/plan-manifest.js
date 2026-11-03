import { assertAssetRights } from "../rights/asset-rights.js";

function conciseCaption(value, fallback = "Watch what happens") {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0];
  const source = firstSentence.length <= 52 ? firstSentence : text;
  if (source.length <= 52) return source;
  const words = source.split(" ");
  let result = "";
  for (const word of words) {
    const next = result ? result + " " + word : word;
    if (next.length > 49) break;
    result = next;
  }
  return (result || source.slice(0, 46)).replace(/[.,;:!?-]+$/, "") + "…";
}

function appendScene(scenes, clip, localPath, start, platform) {
  const sourceIn = Number(clip.start ?? clip.sourceIn);
  const sourceOut = Number(clip.end ?? clip.sourceOut);
  if (!localPath || !Number.isFinite(sourceIn) || !Number.isFinite(sourceOut) || sourceIn < 0 || sourceOut <= sourceIn) throw new Error("Every planned clip needs a local media path and valid source timestamps");
  const rightsAsset = { sourceUrl: clip.sourceUrl, rightsStatus: clip.rightsStatus, rightsEvidenceUrl: clip.rightsEvidenceUrl, rightsEvidenceReference: clip.rightsEvidenceReference, allowedPlatforms: clip.allowedPlatforms, expiresAt: clip.expiresAt };
  assertAssetRights(rightsAsset, { platform });
  const duration = sourceOut - sourceIn;
  const timelineStart = scenes.length ? scenes.at(-1).end : 0;
  scenes.push({ videoPath: localPath, sourceIn, sourceOut, start: timelineStart, end: Number((timelineStart + duration).toFixed(3)), caption: conciseCaption(clip.caption ?? clip.creator ?? "Moment"), wordTimings: clip.wordTimings ?? [], punchIn: clip.treatment?.punchIn === true, motionTreatment: clip.treatment?.motionTreatment ?? (clip.treatment?.punchIn === true ? "impact_punch_in" : "subtle_push"), sourceType: "creator_clip", sourceUrl: clip.sourceUrl, license: clip.license ?? "Authorized source media", rightsStatus: clip.rightsStatus, rightsEvidenceUrl: clip.rightsEvidenceUrl ?? null, rightsEvidenceReference: clip.rightsEvidenceReference ?? null, allowedPlatforms: clip.allowedPlatforms, expiresAt: clip.expiresAt ?? null, creator: clip.creator ?? null, editorialScore: Number.isFinite(Number(clip.score)) ? Number(clip.score) : null });
}

export function buildReeditRenderManifest({ plan, sourceLocalPath, audioPath, outputPath, visualCutPoints = [] } = {}) {
  if (plan?.mode !== "standalone_reedit" || plan.status !== "edit_plan_ready" || !plan.rights?.allowed) throw new Error("A rights-approved standalone re-edit plan is required");
  if (!audioPath || !outputPath) throw new Error("Narration audioPath and outputPath are required");
  const scenes = [];
  const cutPoints = [...new Set((visualCutPoints ?? [])
    .map(Number).filter(value => Number.isFinite(value) && value >= 0))]
    .sort((a, b) => a - b);
  for (const [index, segment] of plan.editDecisionList.entries()) {
    const sourceIn = Number(segment.sourceIn), sourceOut = Number(segment.sourceOut);
    const originalWords = (segment.wordTimings ?? []).map(word => ({
      text: word.word ?? word.text, start: Number(word.start), end: Number(word.end)
    })).filter(word => word.text && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start);
    const candidateCuts = cutPoints.filter(time => time > sourceIn + 1.25 && time < sourceOut - 1.25);
    const boundaries = [sourceIn];
    for (const time of candidateCuts) {
      if (time - boundaries.at(-1) < 1.25 || sourceOut - time < 1.25) continue;
      // Never cut through a spoken word; retain the complete word on one side.
      if (originalWords.some(word => word.start < time && word.end > time)) continue;
      const beforeHasWords = originalWords.some(word => word.end > boundaries.at(-1) && word.start < time);
      const afterHasWords = originalWords.some(word => word.end > time && word.start < sourceOut);
      if (beforeHasWords && afterHasWords) boundaries.push(time);
    }
    boundaries.push(sourceOut);
    const split = boundaries.length > 2;
    for (let beatIndex = 0; beatIndex < boundaries.length - 1; beatIndex += 1) {
      const beatStart = boundaries[beatIndex], beatEnd = boundaries[beatIndex + 1];
      const wordTimings = originalWords.filter(word => word.end > beatStart && word.start < beatEnd).map(word => ({
        text: word.text,
        start: Math.max(word.start, beatStart) - beatStart,
        end: Math.min(word.end, beatEnd) - beatStart
      }));
      const caption = wordTimings.length
        ? wordTimings.map(word => word.text).join(" ").replace(/\\s+/g, " ").trim()
        : segment.caption;
      const treatment = {
        ...(segment.treatment ?? {}),
        punchIn: beatIndex === 0 && segment.treatment?.punchIn === true,
        motionTreatment: beatIndex === 0
          ? (segment.treatment?.motionTreatment ?? "subtle_push")
          : beatIndex % 2 === 1 ? "steady_hold" : "subtle_push"
      };
      appendScene(scenes, {
        ...plan.source, start: beatStart, end: beatEnd, caption,
        score: segment.score, wordTimings, treatment
      }, sourceLocalPath, 0, plan.platform);
      const scene = scenes.at(-1);
      scene.visualBeatIndex = beatIndex + 1;
      scene.visualBeatCount = boundaries.length - 1;
      scene.visualCutAtStart = split && beatIndex > 0;
      scene.visualCutSourceTime = scene.visualCutAtStart ? beatStart : null;
      scene.parentSegmentId = segment.segmentId ?? null;
      if (index === 0 && beatIndex === 0) scene.hookOverlayText = plan.hookOverlay?.text ?? null;
    }
  }
  return { outputPath, audioPath, targetPlatform: plan.platform, scenes };
}

export function buildCompilationRenderManifest({ plan, mediaAssets, audioPath, outputPath } = {}) {
  if (plan?.mode !== "viral_compilation" || plan.status !== "compilation_plan_ready") throw new Error("A rights-approved compilation plan is required");
  if (!audioPath || !outputPath || !mediaAssets || typeof mediaAssets !== "object") throw new Error("Narration audioPath, outputPath and mediaAssets map are required");
  const scenes = [];
  for (const [index, clip] of plan.sequence.entries()) {
    const asset = mediaAssets[clip.sourceId];
    if (!asset?.path) throw new Error("Missing authorized local media for compilation source " + clip.sourceId);
    if (asset.sourceUrl && asset.sourceUrl !== clip.sourceUrl) throw new Error("Local media source URL does not match the approved compilation plan");
    const baseCaption = clip.caption ?? `#${clip.rank} · ${clip.creator ?? "Moment"}`;
    const framedCaption = index === 0 ? `${plan.introCommentary}. ${baseCaption}`
      : index === plan.sequence.length - 1 ? `${plan.outroCommentary}. ${baseCaption}`
      : baseCaption;
    appendScene(scenes, { ...clip, caption: framedCaption }, asset.path, 0, plan.platform);
  }
  return { outputPath, audioPath, targetPlatform: plan.platform, scenes };
}

export function buildOriginalRenderManifest({ brief, assets, audioPath, outputPath, totalDurationSeconds, platform = "youtube_shorts" } = {}) {
  const editorial = brief?.editorial ?? brief;
  if (!editorial || !Array.isArray(editorial.visualPlan) || !Array.isArray(assets) || assets.length < 1 || assets.length > editorial.visualPlan.length) throw new Error("Every selected original visual-plan scene needs exactly one generated or licensed asset");
  if (!audioPath || !outputPath || !Number.isFinite(totalDurationSeconds) || totalDurationSeconds <= 0) throw new Error("Narration path, output path and positive audio duration are required");
  const beats = Array.isArray(editorial.scriptBeats) ? editorial.scriptBeats : [];
  const count = assets.length;
  const visualPlan = editorial.visualPlan.slice(0, count);
  const scenes = assets.map((asset, index) => {
    const start = Number((totalDurationSeconds * index / count).toFixed(3));
    const end = Number((totalDurationSeconds * (index + 1) / count).toFixed(3));
    const beatIndex = beats.length ? Math.min(beats.length - 1, Math.floor(index * beats.length / count)) : -1;
    const caption = beatIndex >= 0 ? conciseCaption(beats[beatIndex].caption ?? beats[beatIndex].narration, String(visualPlan[index].visual ?? "Watch what happens")) : conciseCaption(visualPlan[index].visual);
    const scene = { ...asset, start, end, caption, visualDescription: String(visualPlan[index].visual ?? visualPlan[index].description ?? "").slice(0, 500), narrationContext: String(beats[beatIndex]?.narration ?? visualPlan[index].notes ?? "").slice(0, 700), sourceAudioVolume: 0.35 };
    if (asset.sourceType === "generated_visual" && (!asset.generationModel || !asset.generationPrompt)) throw new Error("Generated visual scene " + (index + 1) + " is missing generation provenance");
    if (asset.sourceType === "licensed_stock" && (!asset.sourceUrl || !asset.license)) throw new Error("Licensed visual scene " + (index + 1) + " is missing license provenance");
    return scene;
  });
  return { outputPath, audioPath, targetPlatform: platform, preserveSourceAudio: true, scenes };
}
