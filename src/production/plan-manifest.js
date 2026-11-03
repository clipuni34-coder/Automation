import { assertAssetRights } from "../rights/asset-rights.js";

function conciseCaption(value, fallback = "Watch what happens") {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  const firstSentence = text.split(/(?<=[.!?])\s+)/[0];
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
  scenes.push({ videoPath: localPath, sourceIn, sourceOut, start: timelineStart, end: Number((timelineStart + duration).toFixed(3)), caption: conciseCaption(clip.caption ?? clip.creator ?? "Moment"), wordTimings: clip.wordTimings ?? [], punchIn: clip.treatment?.punchIn === true, sourceType: "creator_clip", sourceUrl: clip.sourceUrl, license: clip.license ?? "Authorized source media", rightsStatus: clip.rightsStatus, rightsEvidenceUrl: clip.rightsEvidenceUrl ?? null, rightsEvidenceReference: clip.rightsEvidenceReference ?? null, allowedPlatforms: clip.allowedPlatforms, expiresAt: clip.expiresAt ?? null, creator: clip.creator ?? null, editorialScore: Number.isFinite(Number(clip.score)) ? Number(clip.score) : null });
}

export function buildReeditRenderManifest({ plan, sourceLocalPath, audioPath, outputPath } = {}) {
  if (plan?.mode !== "standalone_reedit" || plan.status !== "edit_plan_ready" || !plan.rights?.allowed) throw new Error("A rights-approved standalone re-edit plan is required");
  if (!audioPath || !outputPath) throw new Error("Narration audioPath and outputPath are required");
  const scenes = [];
  for (const segment of plan.editDecisionList) {
    const wordTimings = (segment.wordTimings ?? []).map((word) => ({ text: word.word ?? word.text, start: Number(word.start) - segment.sourceIn, end: Number(word.end) - segment.sourceIn }));
    appendScene(scenes, { ...plan.source, start: segment.sourceIn, end: segment.sourceOut, caption: segment.caption, score: segment.score, wordTimings, treatment: segment.treatment }, sourceLocalPath, 0, plan.platform);
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
