import { auditVideoForMonetization } from "../strategy/monetization.js";
import { assessContentDistinctness, tokenizeScript } from "../strategy/content-history.js";

function clean(value, max = 2000) { return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max); }

function hashtags(topic, title) {
  const words = (String(topic ?? "") + " " + String(title ?? "")).normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(word => word.length >= 3);
  const unique = [...new Set(words.map(word => word.toLowerCase()))].slice(0, 5);
  return unique.map(word => "#" + word.replace(/[^\p{L}\p{N}_]/gu, ""));
}

function assetRights(asset) {
  if (asset.sourceType === "original_graphic") return { sourceType: asset.sourceType, rightsStatus: "owned_by_user", hasRightsEvidence: Boolean(asset.graphicStyle) };
  if (asset.sourceType === "generated_visual") return { sourceType: asset.sourceType, rightsStatus: "generated_output", hasRightsEvidence: Boolean(asset.generationModel && asset.generationPrompt) };
  if (asset.sourceType === "licensed_stock") return { sourceType: asset.sourceType, rightsStatus: "licensed", hasRightsEvidence: Boolean(asset.license && asset.sourceUrl && asset.attribution?.provider) };
  return { sourceType: asset.sourceType ?? "unknown", rightsStatus: "unknown", hasRightsEvidence: false };
}

export function buildPublishingPackage({ brief, renderResult, assets = [], recentContent = [] } = {}) {
  const editorial = brief?.editorial ?? brief;
  if (!editorial || !renderResult || renderResult.status !== "rendered") throw new Error("A creative brief and verified rendered-video result are required");
  const title = clean(editorial.workingTitle ?? brief.topic ?? "New short video", 95);
  const topic = clean(brief.topic ?? title, 180);
  const hook = clean(editorial.hookOptions?.[0] ?? "", 240);
  const cta = clean(editorial.callToAction ?? "", 240);
  const script = clean(editorial.fullScript ?? "", 12000);
  const baseCaption = [hook || title, script, cta].filter(Boolean).join("\n\n");
  const tags = hashtags(topic, title);
  const credits = assets.filter(asset => asset.sourceType === "licensed_stock").map(asset => ({ provider: asset.attribution?.provider ?? "Stock provider", creator: asset.attribution?.creator ?? null, sourceUrl: asset.sourceUrl, license: asset.license, providerUrl: asset.attribution?.providerUrl ?? null }));
  const channelId = editorial.channelId ?? brief.channelId ?? process.env.YOUTUBE_EXPECTED_CHANNEL_ID ?? null;
  const priorForChannel = recentContent.filter(item => !channelId || item.channelId === channelId).slice(-20);
  const distinctness = assessContentDistinctness(script, priorForChannel);
  const assetProvenance = assets.map(assetRights);
  const claims = Array.isArray(editorial.claimsToVerify) ? editorial.claimsToVerify : [];
  const titleTokens = tokenizeScript(title);
  const scriptTokens = new Set(tokenizeScript(script));
  const titleOverlap = titleTokens.filter(token => scriptTokens.has(token)).length;
  const metadataAccurate = Boolean(title && title.length <= 100 && titleTokens.length > 0 && titleOverlap >= Math.min(2, titleTokens.length));
  const narrativePresent = script.length >= 250 && Array.isArray(editorial.visualPlan) && editorial.visualPlan.length >= 3;
  const factualClaimsVerified = claims.length === 0 || (
    editorial.claimLedger?.verifiedClaims === claims.length &&
    Array.isArray(editorial.claimLedger?.claims) &&
    editorial.claimLedger.claims.every(claim => claim.verificationDecision === "human_verified")
  );
  const monetizationPreflight = auditVideoForMonetization({
    assetProvenance,
    originalCommentary: narrativePresent,
    meaningfulNarrative: narrativePresent,
    educationalOrEntertainmentValue: narrativePresent && Boolean(hook || editorial.recommendedAngle),
    substantiveTransformation: narrativePresent,
    distinctFromRecentUploads: distinctness.distinct,
    factualClaimsVerified,
    metadataAccurate,
    aiDisclosureRequired: editorial.aiDisclosureRequired === true,
    aiDisclosureIncluded: editorial.aiDisclosureIncluded === true
  });
  const visualQualityStatus = renderResult.visualQuality?.status ?? "not_run";
  const autoPublishEnabled = process.env.YOUTUBE_AUTO_PUBLISH === "true";
  const autoApproved = autoPublishEnabled && visualQualityStatus === "passed" && monetizationPreflight.status === "preflight_passed";
  return {
    status: "draft",
    channelId,
    title,
    topic,
    video: { path: renderResult.outputPath, durationSeconds: renderResult.durationSeconds, width: renderResult.width, height: renderResult.height, fps: renderResult.fps, videoCodec: renderResult.videoCodec, audioCodec: renderResult.audioCodec },
    platformPackages: {
      youtube_shorts: { title, description: [baseCaption, ...credits.map(credit => "Footage: " + (credit.creator ?? "Creator") + " via " + credit.provider + " — " + credit.sourceUrl)].filter(Boolean).join("\n\n"), hashtags: [...tags, "#Shorts"] },
      tiktok: { caption: clean(baseCaption, 2100), hashtags: [...tags, "#TikTok"] },
      instagram_reels: { caption: clean(baseCaption, 2100), hashtags: [...tags, "#Reels"] }
    },
    hookOptions: (editorial.hookOptions ?? []).slice(0, 3).map(value => clean(value, 240)),
    thumbnail: assets[0]?.imagePath ?? assets[0]?.videoPath ?? null,
    assetCredits: credits,
    assetProvenance,
    contentFingerprint: distinctness.fingerprint,
    contentTokens: distinctness.scriptTokens,
    contentDistinctness: distinctness,
    monetizationPreflight,
    quality: { technicalRenderVerified: true, visualQualityStatus, visualQualityScore: renderResult.visualQuality?.score ?? null, visualQualityWarnings: renderResult.visualQuality?.warnings ?? [], semanticReview: renderResult.visualQuality?.semanticReview ?? null, sourceAudioPreserved: renderResult.sourceAudioPreserved ?? false, factualReviewRequired: !factualClaimsVerified, humanReviewRequired: !autoApproved },
    publication: {
      status: autoApproved ? "approved_for_upload" : "not_published",
      manualApprovalRequired: !autoApproved,
      autoPublishEnabled,
      blockers: [...monetizationPreflight.blockers, ...(visualQualityStatus === "passed" ? [] : ["visualQualityNotPassed"])],
      platforms: ["youtube_shorts"]
    }
  };
}
