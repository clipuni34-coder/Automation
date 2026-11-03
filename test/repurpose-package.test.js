import test from "node:test";
import assert from "node:assert/strict";
import { buildRepurposePackage } from "../src/clips/repurpose-package.js";

test("builds platform-specific draft metadata from selected source moments", () => {
  const plan = {
    mode: "standalone_reedit",
    status: "edit_plan_ready",
    platform: "youtube_shorts",
    source: { title: "Original source", creator: "Creator", sourceUrl: "https://example.org/source", rightsStatus: "licensed", rightsEvidenceUrl: "https://example.org/license", allowedPlatforms: ["youtube_shorts"] },
    openingHook: { sourceIn: 12, sourceOut: 17, score: 8.4 },
    editDecisionList: [
      { sourceIn: 12, sourceOut: 17, caption: "Why this surprising moment matters", score: 8.4, treatment: { punchIn: true } },
      { sourceIn: 30, sourceOut: 36, caption: "Here is what happened next", score: 7.2, treatment: { punchIn: true } }
    ],
    editorialNotes: ["Preserve original meaning."],
    editorialQuality: { averageSelectedScore: 7.8 }
  };
  const result = buildRepurposePackage({
    plan,
    renderResult: { status: "rendered", outputPath: "short.mp4", durationSeconds: 11, width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", sourceAudioPreserved: true, visualQuality: { status: "passed", score: 85, warnings: [] } },
    thumbnailPath: "short.thumbnail.jpg"
  });
  assert.equal(result.status, "draft");
  assert.equal(result.manualPublishingApprovalRequired, true);
  assert.equal(result.title, "Why this surprising moment matters");
  assert.equal(result.platformPackages.youtube_shorts.title, result.title);
  assert.ok(result.platformPackages.youtube_shorts.hashtags.includes("#Shorts"));
  assert.equal(result.platformPackages.tiktok, undefined);
  assert.equal(result.platformPackages.instagram_reels, undefined);
  assert.equal(result.thumbnailPath, "short.thumbnail.jpg");
  assert.equal(result.editRationale.selectedMomentCount, 2);
  assert.equal(result.quality.visualQualityStatus, "passed");
});

test("posting package refuses unapproved sources or unverified renders", () => {
  assert.throws(() => buildRepurposePackage({ plan: { mode: "standalone_reedit", status: "analysis_only" }, renderResult: { status: "rendered" } }), /rights-approved/);
});
