import test from "node:test";
import assert from "node:assert/strict";
import { buildPublishingPackage } from "../src/packaging/package.js";

test("builds platform-specific draft metadata and preserves stock footage credits", () => {
  const pkg = buildPublishingPackage({
    brief: { topic: "Funny Science Moments", editorial: { workingTitle: "The Weirdest Science Surprise", hookOptions: ["This experiment went wrong"], fullScript: "A strange experiment produced an unexpected result.", callToAction: "Which result surprised you most?" } },
    renderResult: { status: "rendered", outputPath: "/out/short.mp4", durationSeconds: 35, width: 1080, height: 1920, fps: "30/1", videoCodec: "h264", audioCodec: "aac", sourceAudioPreserved: false },
    assets: [{ sourceType: "licensed_stock", sourceUrl: "https://www.pexels.com/video/example/", license: "Pexels License", attribution: { provider: "Pexels", creator: "Creator", providerUrl: "https://www.pexels.com" }, videoPath: "/assets/clip.mp4" }]
  });
  assert.equal(pkg.status, "draft");
  assert.ok(pkg.platformPackages.youtube_shorts.title.length <= 100);
  assert.ok(pkg.platformPackages.tiktok.caption.includes("Which result surprised you most?"));
  assert.ok(pkg.platformPackages.instagram_reels.hashtags.includes("#Reels"));
  assert.equal(pkg.assetCredits[0].creator, "Creator");
  assert.equal(pkg.publication.status, "not_published");
});

test("does not create a publishing package from an unverified render", () => {
  assert.throws(() => buildPublishingPackage({ brief: { topic: "test" }, renderResult: { status: "failed" } }), /verified rendered-video result/);
});

test("publishing package preserves scene-level semantic visual review findings", () => {
  const semanticReview = { status: "review", reviewedScenes: 2, passedScenes: 1, failedScenes: 1, scenes: [{ scene: 2, relevant: false, reason: "Unrelated visual" }] };
  const pkg = buildPublishingPackage({
    brief: { topic: "Test", editorial: { workingTitle: "Test", fullScript: "A sufficiently long narration for this sample." } },
    renderResult: { status: "rendered", outputPath: "/out/short.mp4", durationSeconds: 12, visualQuality: { status: "review", score: 60, warnings: ["Scene 2 failed semantic visual verification"], semanticReview } }
  });
  assert.deepEqual(pkg.quality.semanticReview, semanticReview);
  assert.equal(pkg.quality.visualQualityStatus, "review");
});

function eligibleBrief(extra = {}) {
  return {
    topic: "Amazing Ocean Mystery",
    editorial: {
      workingTitle: "Amazing Ocean Mystery",
      hookOptions: ["The ocean mystery nobody expected"],
      callToAction: "What would you investigate next?",
      fullScript: "This amazing ocean mystery begins with an unusual discovery beneath the waves. The story follows the clues, explains what the evidence can and cannot show, and reveals why the mystery matters to people who study the ocean. The final scene connects the discovery to a bigger question and gives viewers a clear takeaway. This is an original narrated story with a beginning, middle and payoff.",
      visualPlan: [{ visual: "Ocean" }, { visual: "Research vessel" }, { visual: "Deep sea" }],
      claimsToVerify: [],
      ...extra
    }
  };
}

function eligibleAssets() {
  return [
    { sourceType: "original_graphic", graphicStyle: "custom editorial graphic", imagePath: "/assets/1.ppm" },
    { sourceType: "original_graphic", graphicStyle: "custom editorial graphic", imagePath: "/assets/2.ppm" },
    { sourceType: "original_graphic", graphicStyle: "custom editorial graphic", imagePath: "/assets/3.ppm" }
  ];
}

test("approves autonomous YouTube upload only when rights, originality, factual and visual gates pass", t => {
  const previous = process.env.YOUTUBE_AUTO_PUBLISH;
  t.after(() => { if (previous === undefined) delete process.env.YOUTUBE_AUTO_PUBLISH; else process.env.YOUTUBE_AUTO_PUBLISH = previous; });
  process.env.YOUTUBE_AUTO_PUBLISH = "true";
  const pkg = buildPublishingPackage({
    brief: eligibleBrief(),
    renderResult: { status: "rendered", outputPath: "/out/short.mp4", durationSeconds: 35, visualQuality: { status: "passed", score: 95, warnings: [] } },
    assets: eligibleAssets()
  });
  assert.equal(pkg.monetizationPreflight.status, "preflight_passed");
  assert.equal(pkg.publication.status, "approved_for_upload");
  assert.equal(pkg.publication.manualApprovalRequired, false);
  assert.deepEqual(pkg.publication.blockers, []);
  assert.ok(pkg.contentFingerprint);
});

test("holds videos with unverified factual claims even when other gates pass", t => {
  const previous = process.env.YOUTUBE_AUTO_PUBLISH;
  t.after(() => { if (previous === undefined) delete process.env.YOUTUBE_AUTO_PUBLISH; else process.env.YOUTUBE_AUTO_PUBLISH = previous; });
  process.env.YOUTUBE_AUTO_PUBLISH = "true";
  const pkg = buildPublishingPackage({
    brief: eligibleBrief({ claimsToVerify: ["A factual claim that needs source review."] }),
    renderResult: { status: "rendered", outputPath: "/out/short.mp4", durationSeconds: 35, visualQuality: { status: "passed", score: 95, warnings: [] } },
    assets: eligibleAssets()
  });
  assert.equal(pkg.publication.status, "not_published");
  assert.ok(pkg.monetizationPreflight.blockers.includes("factualClaimsChecked"));
});

test("holds near-duplicate scripts from the same channel", t => {
  const previous = process.env.YOUTUBE_AUTO_PUBLISH;
  t.after(() => { if (previous === undefined) delete process.env.YOUTUBE_AUTO_PUBLISH; else process.env.YOUTUBE_AUTO_PUBLISH = previous; });
  process.env.YOUTUBE_AUTO_PUBLISH = "true";
  const brief = eligibleBrief();
  const tokens = brief.editorial.fullScript.toLowerCase().match(/[a-z0-9]{3,}/g);
  const pkg = buildPublishingPackage({
    brief,
    recentContent: [{ channelId: "UC1", fingerprint: "old-hash", scriptTokens: [...new Set(tokens)] }],
    renderResult: { status: "rendered", outputPath: "/out/short.mp4", durationSeconds: 35, visualQuality: { status: "passed", score: 95, warnings: [] } },
    assets: eligibleAssets()
  });
  assert.equal(pkg.publication.status, "not_published");
  assert.ok(pkg.monetizationPreflight.blockers.includes("notInterchangeableOrMassProduced"));
});

test("keeps upload approval disabled unless channel-level automation is enabled", t => {
  const previous = process.env.YOUTUBE_AUTO_PUBLISH;
  t.after(() => { if (previous === undefined) delete process.env.YOUTUBE_AUTO_PUBLISH; else process.env.YOUTUBE_AUTO_PUBLISH = previous; });
  delete process.env.YOUTUBE_AUTO_PUBLISH;
  const pkg = buildPublishingPackage({
    brief: eligibleBrief(),
    renderResult: { status: "rendered", outputPath: "/out/short.mp4", durationSeconds: 35, visualQuality: { status: "passed", score: 95, warnings: [] } },
    assets: eligibleAssets()
  });
  assert.equal(pkg.monetizationPreflight.status, "preflight_passed");
  assert.equal(pkg.publication.status, "not_published");
  assert.equal(pkg.publication.manualApprovalRequired, true);
});
