const WINDOW_DAYS = 90;

function finite(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function ratio(current, target) {
  return Math.min(100, Math.round((finite(current) / target) * 100));
}

function milestone({ subscribers, uploads90d, watchHours365d, shortsViews90d }) {
  const earlyLong = {
    subscribers: { current: finite(subscribers), target: 500 },
    publicUploads90d: { current: finite(uploads90d), target: 3 },
    qualifiedWatchHours365d: { current: finite(watchHours365d), target: 3000 }
  };
  const earlyShort = {
    subscribers: { current: finite(subscribers), target: 500 },
    publicUploads90d: { current: finite(uploads90d), target: 3 },
    qualifiedShortsViews90d: { current: finite(shortsViews90d), target: 3000000 }
  };
  const adsLong = {
    subscribers: { current: finite(subscribers), target: 1000 },
    qualifiedWatchHours365d: { current: finite(watchHours365d), target: 4000 }
  };
  const adsShort = {
    subscribers: { current: finite(subscribers), target: 1000 },
    qualifiedShortsViews90d: { current: finite(shortsViews90d), target: 10000000 }
  };
  const complete = (checks) => Object.values(checks).every(({ current, target }) => current >= target);
  const percent = (checks) => Math.round(Object.values(checks).reduce((sum, item) => sum + ratio(item.current, item.target), 0) / Object.keys(checks).length);
  return {
    earlyAccess: {
      longForm: { eligibleByMetrics: complete(earlyLong), progressPercent: percent(earlyLong), checks: earlyLong },
      shorts: { eligibleByMetrics: complete(earlyShort), progressPercent: percent(earlyShort), checks: earlyShort },
      note: "Expanded YPP provides earlier access to selected fan-funding and shopping features; it is not full ad-revenue eligibility."
    },
    adRevenue: {
      longForm: { eligibleByMetrics: complete(adsLong), progressPercent: percent(adsLong), checks: adsLong },
      shorts: { eligibleByMetrics: complete(adsShort), progressPercent: percent(adsShort), checks: adsShort }
    }
  };
}

export function evaluateChannelMonetization({ countryCode = "NG", metrics = {}, policyStatus = "unknown", twoStepVerification = false, advancedFeatures = false, adsenseLinked = false, activeStrikes = 0 } = {}) {
  const progress = milestone(metrics);
  const country = String(countryCode).toUpperCase();
  const expandedCountries = new Set(["DZ","AS","AR","AW","AU","AT","BH","BY","BE","BM","BO","BA","BR","BG","CA","KY","CL","CO","CR","HR","CY","CZ","DK","DO","EC","EG","SV","EE","FI","FR","GF","PF","DE","GR","GP","GU","GT","HK","HN","HU","IS","IN","ID","IE","IL","IT","JP","JO","KE","KW","LV","LB","LI","LT","LU","MK","MY","MT","MA","MX","NL","NZ","NI","NG","MP","NO","OM","PA","PG","PE","PH","PL","PT","PR","PY","QA","RO","SA","SN","RS","SG","SK","SI","ZA","KR","ES","SE","CH","TW","TH","TR","TC","UG","AE","GB","US","UY","VI","VN"]);
  const prerequisites = {
    countryEligibleForExpandedYpp: expandedCountries.has(country),
    noActiveCommunityGuidelinesStrikes: finite(activeStrikes) === 0,
    twoStepVerification,
    advancedFeatures,
    adsenseLinked,
    channelPolicyStatus: policyStatus
  };
  const policyClear = policyStatus === "passed";
  const early = progress.earlyAccess.longForm.eligibleByMetrics || progress.earlyAccess.shorts.eligibleByMetrics;
  const ads = progress.adRevenue.longForm.eligibleByMetrics || progress.adRevenue.shorts.eligibleByMetrics;
  return {
    countryCode: country,
    expandedYppCountryEligible: prerequisites.countryEligibleForExpandedYpp,
    metrics: progress,
    prerequisites,
    earlyAccessReadyToApplyByMetrics: prerequisites.countryEligibleForExpandedYpp && early && prerequisites.noActiveCommunityGuidelinesStrikes && twoStepVerification && policyClear,
    adRevenueReadyToApplyByMetrics: ads && prerequisites.noActiveCommunityGuidelinesStrikes && twoStepVerification && advancedFeatures && adsenseLinked && policyClear,
    missingPrerequisites: Object.entries(prerequisites).filter(([key, value]) => value !== true && key !== "channelPolicyStatus").map(([key]) => key).concat(policyClear ? [] : ["channelPolicyStatus"]),
    important: "These calculations track stated thresholds only. YouTube validates qualified metrics and reviews the entire channel; reaching a number does not guarantee acceptance."
  };
}

export function auditVideoForMonetization({
  rightsStatus = "unknown",
  hasRightsEvidence = false,
  assetProvenance = null,
  originalCommentary = false,
  meaningfulNarrative = false,
  educationalOrEntertainmentValue = false,
  substantiveTransformation = false,
  distinctFromRecentUploads = false,
  factualClaimsVerified = false,
  metadataAccurate = false,
  aiDisclosureRequired = false,
  aiDisclosureIncluded = false
} = {}) {
  const permittedRights = new Set(["owned_by_user","licensed","permission_granted","public_domain","generated_output"]);
  const hasThirdPartyAssets = Array.isArray(assetProvenance)
    ? assetProvenance.some(asset => asset.rightsStatus === "licensed" || asset.rightsStatus === "permission_granted")
    : !["owned_by_user","generated_output"].includes(rightsStatus);
  const rightsCleared = Array.isArray(assetProvenance)
    ? assetProvenance.length > 0 && assetProvenance.every(asset => permittedRights.has(asset.rightsStatus) && asset.hasRightsEvidence === true)
    : permittedRights.has(rightsStatus) && hasRightsEvidence;
  const checks = {
    rightsCleared,
    originalContribution: originalCommentary || meaningfulNarrative || educationalOrEntertainmentValue,
    substantiveTransformationWhenUsingThirdPartyMaterial: !hasThirdPartyAssets || substantiveTransformation,
    notInterchangeableOrMassProduced: distinctFromRecentUploads,
    factualClaimsChecked: factualClaimsVerified,
    accurateMetadata: metadataAccurate,
    requiredSyntheticMediaDisclosure: !aiDisclosureRequired || aiDisclosureIncluded
  };
  const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  return {
    status: blockers.length ? "blocked_pending_review" : "eligible_for_human_review",
    checks,
    blockers,
    note: "This is an internal preflight, not a guarantee of copyright clearance, advertiser suitability or YouTube monetization approval. Human review is required."
  };
}
