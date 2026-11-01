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
