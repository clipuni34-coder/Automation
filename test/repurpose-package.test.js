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
      { sourceIn: 12, sourceOut: 17, caption: "From the archive", score: 5.4, treatment: { punchIn: false } },
      { sourceIn: 30, sourceOut: 36, caption: "Why this surprising moment matters", score: 8.4, treatment: { punchIn: true } }
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


test("posting package requires human story review when selected context is disconnected and no semantic analysis qualifies it", () => {
  const plan = {
    mode: "standalone_reedit", status: "edit_plan_ready", platform: "youtube_shorts",
    source: { title: "Archive", sourceUrl: "https://example.org/source", rightsStatus: "public_domain", allowedPlatforms: ["youtube_shorts"] },
    openingHook: { sourceIn: 0, sourceOut: 3, score: 7 },
    hookOverlay: { text: "A real question?", segmentId: "one" },
    editDecisionList: [{ sourceIn: 0, sourceOut: 3, caption: "A real question?", score: 7, treatment: {} }],
    editorialQuality: {
      averageSelectedScore: 7,
      contextualStoryAnalysis: { status: "disconnected_sequence" },
      narrativeStructure: {
        status: "no_ordered_arc_detected",
        semanticContextAnalysis: { status: "not_configured" },
        semanticContinuityQualification: { qualified: false }
      }
    }
  };
  const result = buildRepurposePackage({
    plan,
    renderResult: { status: "rendered", outputPath: "short.mp4", durationSeconds: 3, width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", sourceAudioPreserved: true, visualQuality: { status: "passed", score: 95, warnings: [] } }
  });
  assert.equal(result.status, "editorial_review_required");
  assert.equal(result.editorialApproval.approved, false);
  assert.ok(result.editorialApproval.reasons.some(reason => /ordered story arc|connected contextual sequence/.test(reason)));
});


test("connected partial semantic excerpts remain explicitly under human story review", () => {
  const plan = {
    mode: "standalone_reedit", status: "edit_plan_ready", platform: "youtube_shorts",
    source: { title: "Archive", sourceUrl: "https://example.org/source", rightsStatus: "public_domain", allowedPlatforms: ["youtube_shorts"] },
    openingHook: { sourceIn: 10, sourceOut: 12.7, score: 5.1 },
    hookOverlay: { text: "We're breathing again.", segmentId: "relief" },
    editDecisionList: [
      { sourceIn: 10, sourceOut: 12.7, caption: "We copy you on the ground.", score: 5.1, treatment: {} },
      { sourceIn: 13, sourceOut: 15.7, caption: "We're breathing again.", score: 6.5, treatment: {} },
      { sourceIn: 16, sourceOut: 18.7, caption: "You're looking good here.", score: 5.8, treatment: {} }
    ],
    editorialQuality: {
      averageSelectedScore: 5.8,
      contextualStoryAnalysis: { status: "disconnected_sequence" },
      narrativeStructure: {
        status: "partial_arc_detected",
        contextualContinuityQualification: { status: "beat_sequence_has_disconnected_context" },
        semanticContextAnalysis: { status: "human_review_required" },
        semanticContinuityQualification: { qualified: true },
        semanticStoryWindow: { qualified: true, selectionType: "connected_excerpt", arcStatus: "partial", confidence: 0.6 }
      }
    }
  };
  const result = buildRepurposePackage({
    plan,
    renderResult: { status: "rendered", outputPath: "short.mp4", durationSeconds: 8.1, width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", sourceAudioPreserved: true, visualQuality: { status: "passed", score: 95, warnings: [] } }
  });
  assert.equal(result.status, "editorial_review_required");
  assert.equal(result.editorialApproval.status, "review_required");
  assert.equal(result.editorialApproval.approved, false);
  assert.ok(result.editorialApproval.reasons.some(reason => /semantic story analysis/i.test(reason)));
});

test("a validated complete semantic story window overrides unrelated source-level disconnected transitions", () => {
  const plan = {
    mode: "standalone_reedit", status: "edit_plan_ready", platform: "youtube_shorts",
    source: { title: "Archive", sourceUrl: "https://example.org/source", rightsStatus: "public_domain", allowedPlatforms: ["youtube_shorts"] },
    openingHook: { sourceIn: 20, sourceOut: 23, score: 8 },
    editDecisionList: [
      { sourceIn: 20, sourceOut: 23, caption: "Why did it happen?", score: 7, treatment: {} },
      { sourceIn: 24, sourceOut: 27, caption: "The problem became clear.", score: 7, treatment: {} },
      { sourceIn: 28, sourceOut: 31, caption: "They solved the problem.", score: 8, treatment: {} }
    ],
    editorialQuality: {
      averageSelectedScore: 7.3,
      contextualStoryAnalysis: { status: "disconnected_sequence" },
      narrativeStructure: {
        status: "no_ordered_arc_detected",
        contextualContinuityQualification: { status: "beat_sequence_has_disconnected_context" },
        semanticContextAnalysis: { status: "human_review_required" },
        semanticContinuityQualification: { qualified: false },
        semanticStoryWindow: { qualified: true, arcStatus: "complete", confidence: 0.95, summary: "A complete problem-and-resolution story." }
      }
    }
  };
  const result = buildRepurposePackage({
    plan,
    renderResult: { status: "rendered", outputPath: "short.mp4", durationSeconds: 11, width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", sourceAudioPreserved: true, visualQuality: { status: "passed", score: 95, warnings: [] } }
  });
  assert.equal(result.status, "draft");
  assert.equal(result.editorialApproval.status, "eligible_for_human_approval");
  assert.equal(result.editorialApproval.approved, false);
  assert.deepEqual(result.editorialApproval.reasons, []);
});
