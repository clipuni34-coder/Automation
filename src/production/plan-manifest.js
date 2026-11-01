import { assertAssetRights } from "../rights/asset-rights.js";

function appendScene(scenes, clip, localPath, start, platform) {
  const sourceIn = Number(clip.start ?? clip.sourceIn);
  const sourceOut = Number(clip.end ?? clip.sourceOut);
  if (!localPath || !Number.isFinite(sourceIn) || !Number.isFinite(sourceOut) || sourceIn < 0 || sourceOut <= sourceIn) throw new Error("Every planned clip needs a local media path and valid source timestamps");
  const rightsAsset = { sourceUrl: clip.sourceUrl, rightsStatus: clip.rightsStatus, rightsEvidenceUrl: clip.rightsEvidenceUrl, rightsEvidenceReference: clip.rightsEvidenceReference, allowedPlatforms: clip.allowedPlatforms, expiresAt: clip.expiresAt };
  assertAssetRights(rightsAsset, { platform });
  const duration = sourceOut - sourceIn;
  const timelineStart = scenes.length ? scenes.at(-1).end : 0;
  scenes.push({ videoPath: localPath, sourceIn, sourceOut, start: timelineStart, end: Number((timelineStart + duration).toFixed(3)), caption: clip.caption ?? clip.creator ?? "Moment", sourceType: "creator_clip", sourceUrl: clip.sourceUrl, license: clip.license ?? "Authorized source media", rightsStatus: clip.rightsStatus, rightsEvidenceUrl: clip.rightsEvidenceUrl ?? null, rightsEvidenceReference: clip.rightsEvidenceReference ?? null, allowedPlatforms: clip.allowedPlatforms, expiresAt: clip.expiresAt ?? null, creator: clip.creator ?? null });
}

export function buildReeditRenderManifest({ plan, sourceLocalPath, audioPath, outputPath } = {}) {
  if (plan?.mode !== "standalone_reedit" || plan.status !== "edit_plan_ready" || !plan.rights?.allowed) throw new Error("A rights-approved standalone re-edit plan is required");
  if (!audioPath || !outputPath) throw new Error("Narration audioPath and outputPath are required");
  const scenes = [];
  for (const segment of plan.editDecisionList) appendScene(scenes, { ...plan.source, start: segment.sourceIn, end: segment.sourceOut, caption: segment.caption }, sourceLocalPath, 0, plan.platform);
  return { outputPath, audioPath, targetPlatform: plan.platform, scenes };
}

export function buildCompilationRenderManifest({ plan, mediaAssets, audioPath, outputPath } = {}) {
  if (plan?.mode !== "viral_compilation" || plan.status !== "compilation_plan_ready") throw new Error("A rights-approved compilation plan is required");
  if (!audioPath || !outputPath || !mediaAssets || typeof mediaAssets !== "object") throw new Error("Narration audioPath, outputPath and mediaAssets map are required");
  const scenes = [];
  for (const clip of plan.sequence) {
    const asset = mediaAssets[clip.sourceId];
    if (!asset?.path) throw new Error("Missing authorized local media for compilation source " + clip.sourceId);
    if (asset.sourceUrl && asset.sourceUrl !== clip.sourceUrl) throw new Error("Local media source URL does not match the approved compilation plan");
    appendScene(scenes, { ...clip, caption: clip.caption ?? `#${clip.rank} · ${clip.creator ?? "Moment"}` }, asset.path, 0, plan.platform);
  }
  return { outputPath, audioPath, targetPlatform: plan.platform, scenes };
}
