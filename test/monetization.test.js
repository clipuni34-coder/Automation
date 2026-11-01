import test from "node:test";
import assert from "node:assert/strict";
import { auditVideoForMonetization, evaluateChannelMonetization } from "../src/strategy/monetization.js";

test("Nigeria channel receives expanded YPP threshold tracking separately from ad revenue", () => {
  const result = evaluateChannelMonetization({
    countryCode: "NG",
    metrics: { subscribers: 500, uploads90d: 3, watchHours365d: 3000, shortsViews90d: 0 },
    policyStatus: "passed",
    twoStepVerification: true,
    advancedFeatures: true,
    adsenseLinked: true,
    activeStrikes: 0
  });
  assert.equal(result.expandedYppCountryEligible, true);
  assert.equal(result.earlyAccessReadyToApplyByMetrics, true);
  assert.equal(result.adRevenueReadyToApplyByMetrics, false);
  assert.equal(result.metrics.adRevenue.longForm.eligibleByMetrics, false);
});

test("full Shorts ad-revenue thresholds are tracked independently", () => {
  const result = evaluateChannelMonetization({
    countryCode: "NG",
    metrics: { subscribers: 1000, shortsViews90d: 10000000 },
    policyStatus: "passed",
    twoStepVerification: true,
    advancedFeatures: true,
    adsenseLinked: true
  });
  assert.equal(result.adRevenueReadyToApplyByMetrics, true);
  assert.equal(result.metrics.adRevenue.shorts.progressPercent, 100);
});

test("missing channel prerequisites prevent declaring monetization readiness", () => {
  const result = evaluateChannelMonetization({
    metrics: { subscribers: 1000, watchHours365d: 4000 },
    policyStatus: "unknown"
  });
  assert.equal(result.adRevenueReadyToApplyByMetrics, false);
  assert.ok(result.missingPrerequisites.includes("channelPolicyStatus"));
  assert.ok(result.missingPrerequisites.includes("twoStepVerification"));
});

test("third-party or repetitive video fails the monetization preflight", () => {
  const result = auditVideoForMonetization({
    rightsStatus: "permission_granted",
    hasRightsEvidence: true,
    originalCommentary: false,
    meaningfulNarrative: false,
    educationalOrEntertainmentValue: false,
    substantiveTransformation: false,
    distinctFromRecentUploads: false,
    factualClaimsVerified: true,
    metadataAccurate: true
  });
  assert.equal(result.status, "blocked_pending_review");
  assert.ok(result.blockers.includes("originalContribution"));
  assert.ok(result.blockers.includes("substantiveTransformationWhenUsingThirdPartyMaterial"));
  assert.ok(result.blockers.includes("notInterchangeableOrMassProduced"));
});

test("strong original video can pass internal preflight but still requires human review", () => {
  const result = auditVideoForMonetization({
    rightsStatus: "owned_by_user",
    hasRightsEvidence: true,
    originalCommentary: true,
    meaningfulNarrative: true,
    educationalOrEntertainmentValue: true,
    distinctFromRecentUploads: true,
    factualClaimsVerified: true,
    metadataAccurate: true,
    aiDisclosureRequired: true,
    aiDisclosureIncluded: true
  });
  assert.equal(result.status, "eligible_for_human_review");
  assert.deepEqual(result.blockers, []);
  assert.match(result.note, /not a guarantee/);
});
