function clean(value, max = 2000) { return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max); }

function hashtags(topic, title) {
  const words = (String(topic ?? "") + " " + String(title ?? "")).normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(word => word.length >= 3);
  const unique = [...new Set(words.map(word => word.toLowerCase()))].slice(0, 5);
  return unique.map(word => "#" + word.replace(/[^\p{L}\p{N}_]/gu, ""));
}

export function buildPublishingPackage({ brief, renderResult, assets = [] } = {}) {
  const editorial = brief?.editorial ?? brief;
  if (!editorial || !renderResult || renderResult.status !== "rendered") throw new Error("A creative brief and verified rendered-video result are required");
  const title = clean(editorial.workingTitle ?? brief.topic ?? "New short video", 95);
  const topic = clean(brief.topic ?? title, 180);
  const hook = clean(editorial.hookOptions?.[0] ?? "", 240);
  const cta = clean(editorial.callToAction ?? "", 240);
  const opening = clean(editorial.fullScript ?? "", 420);
  const baseCaption = [hook || title, opening, cta].filter(Boolean).join("\n\n");
  const tags = hashtags(topic, title);
  const credits = assets.filter(asset => asset.sourceType === "licensed_stock").map(asset => ({ provider: asset.attribution?.provider ?? "Stock provider", creator: asset.attribution?.creator ?? null, sourceUrl: asset.sourceUrl, license: asset.license, providerUrl: asset.attribution?.providerUrl ?? null }));
  return {
    status: "draft", title, topic, video: { path: renderResult.outputPath, durationSeconds: renderResult.durationSeconds, width: renderResult.width, height: renderResult.height, fps: renderResult.fps, videoCodec: renderResult.videoCodec, audioCodec: renderResult.audioCodec },
    platformPackages: {
      youtube_shorts: { title, description: [baseCaption, ...credits.map(credit => "Footage: " + (credit.creator ?? "Creator") + " via " + credit.provider + " — " + credit.sourceUrl)].filter(Boolean).join("\n\n"), hashtags: [...tags, "#Shorts"] },
      tiktok: { caption: clean(baseCaption, 2100), hashtags: [...tags, "#TikTok"] },
      instagram_reels: { caption: clean(baseCaption, 2100), hashtags: [...tags, "#Reels"] }
    },
    hookOptions: (editorial.hookOptions ?? []).slice(0, 3).map(value => clean(value, 240)),
    thumbnail: assets[0]?.imagePath ?? assets[0]?.videoPath ?? null,
    assetCredits: credits,
    quality: { technicalRenderVerified: true, visualQualityStatus: renderResult.visualQuality?.status ?? "not_run", visualQualityScore: renderResult.visualQuality?.score ?? null, visualQualityWarnings: renderResult.visualQuality?.warnings ?? [], sourceAudioPreserved: renderResult.sourceAudioPreserved ?? false, factualReviewRequired: true, humanReviewRequired: true },
    publication: { status: "not_published", manualApprovalRequired: true, platforms: ["youtube_shorts", "tiktok", "instagram_reels"] }
  };
}
