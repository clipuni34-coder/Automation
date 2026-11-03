const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "what", "when", "why", "how", "you", "your", "are", "was", "were", "have", "has", "had", "into", "about", "just", "then", "than", "they", "them", "their", "there", "here", "will", "would", "could", "should"]);

function clean(value, max = 2000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function makeHashtags(text, platform) {
  const words = clean(text, 5000).normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/).map((word) => word.toLowerCase())
    .filter((word) => word.length >= 4 && !STOP.has(word));
  const unique = [...new Set(words)].slice(0, 5).map((word) => "#" + word);
  const platformTag = platform === "youtube_shorts" ? "#Shorts" : platform === "instagram_reels" ? "#Reels" : "#TikTok";
  return [...unique, platformTag];
}

export function buildRepurposePackage({ plan, renderResult, thumbnailPath = null } = {}) {
  if (plan?.mode !== "standalone_reedit" || plan.status !== "edit_plan_ready" || renderResult?.status !== "rendered") {
    throw new Error("A rights-approved re-edit plan and verified render result are required");
  }
  const moments = plan.editDecisionList ?? [];
  if (!moments.length) throw new Error("The re-edit plan contains no selected moments");
  const opening = moments[0];
  const title = clean(opening.caption || plan.source?.title || "Edited video", 95);
  const transcript = moments.map((moment) => clean(moment.caption, 800)).filter(Boolean);
  const description = [
    transcript.join("\n\n"),
    plan.source?.creator ? "Original creator: " + clean(plan.source.creator, 120) : "",
    plan.source?.sourceUrl ? "Source: " + plan.source.sourceUrl : ""
  ].filter(Boolean).join("\n\n").slice(0, 4500);
  const hashtagText = [plan.source?.title, ...transcript].filter(Boolean).join(" ");
  const platform = plan.platform;
  if (!["youtube_shorts", "tiktok", "instagram_reels"].includes(platform) || !(plan.source?.allowedPlatforms ?? []).includes(platform)) throw new Error("A posting package can only be created for a platform cleared by the source rights record.");
  const averageEditorialScore = Number(plan.editorialQuality?.averageSelectedScore ?? 0);
  const visualReviewRequired = renderResult.visualQuality?.status !== "passed";
  const editorialReviewRequired = !Number.isFinite(averageEditorialScore) || averageEditorialScore < 5.5;
  const editorialApprovalRequired = visualReviewRequired || editorialReviewRequired;
  const platforms = [platform];
  const platformPackages = Object.fromEntries(platforms.map((platform) => {
    const tags = makeHashtags(hashtagText, platform);
    return [platform, platform === "youtube_shorts"
      ? { title, description, hashtags: tags }
      : { caption: clean([title, ...transcript].join("\n\n"), 2100), hashtags: tags }];
  }));
  return {
    status: editorialApprovalRequired ? "editorial_review_required" : "draft",
    manualPublishingApprovalRequired: true,
    editorialApproval: {
      status: editorialApprovalRequired ? "review_required" : "eligible_for_human_approval",
      approved: false,
      humanReviewRequired: true,
      reasons: [
        ...(visualReviewRequired ? ["Visual quality review has not passed."] : []),
        ...(editorialReviewRequired ? ["Editorial score is missing or below the 5.5/10 threshold."] : [])
      ]
    },
    title,
    source: {
      title: plan.source?.title ?? null,
      creator: plan.source?.creator ?? null,
      url: plan.source?.sourceUrl ?? null,
      rightsStatus: plan.source?.rightsStatus ?? "unknown",
      rightsEvidenceUrl: plan.source?.rightsEvidenceUrl ?? null,
      allowedPlatforms: plan.source?.allowedPlatforms ?? []
    },
    video: {
      path: renderResult.outputPath,
      durationSeconds: renderResult.durationSeconds,
      width: renderResult.width,
      height: renderResult.height,
      videoCodec: renderResult.videoCodec,
      audioCodec: renderResult.audioCodec,
      sourceAudioPreserved: renderResult.sourceAudioPreserved ?? false
    },
    thumbnailPath,
    platformPackages,
    editRationale: {
      openingMoment: { sourceIn: plan.openingHook.sourceIn, sourceOut: plan.openingHook.sourceOut, score: plan.openingHook.score },
      selectedMomentCount: moments.length,
      selectedSourceRanges: moments.map((moment) => ({ sourceIn: moment.sourceIn, sourceOut: moment.sourceOut, score: moment.score })),
      appliedTreatments: [...new Set(moments.map((moment) => moment.treatment?.punchIn ? "score-based punch-in" : "vertical reframing"))],
      editorialNotes: plan.editorialNotes ?? []
    },
    quality: {
      technicalRenderStatus: renderResult.status,
      visualQualityStatus: renderResult.visualQuality?.status ?? "not_run",
      visualQualityScore: renderResult.visualQuality?.score ?? null,
      visualQualityWarnings: renderResult.visualQuality?.warnings ?? [],
      averageEditorialScore: Number.isFinite(averageEditorialScore) ? averageEditorialScore : null
    },
    note: "This is a draft posting package. Performance is not guaranteed; verify context, rights, title accuracy and platform requirements before posting."
  };
}
