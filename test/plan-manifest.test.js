import test from "node:test";
import assert from "node:assert/strict";
import { buildReeditPlan } from "../src/creative/reedit.js";
import { buildCompilationPlan } from "../src/clips/compilation.js";
import { buildReeditRenderManifest, buildCompilationRenderManifest } from "../src/production/plan-manifest.js";

const rights = { rightsStatus: "permission_granted", rightsEvidenceReference: "signed-consent-77", allowedPlatforms: ["youtube_shorts"], license: "Creator written permission" };

test("standalone re-edit plan maps approved source cut points into renderable scene offsets", () => {
  const plan = buildReeditPlan({ source: { ...rights, sourceUrl: "https://media.example/source.mp4", durationSeconds: 80 }, targetDurationSeconds: 20, transcriptSegments: [
    { start: 30, end: 40, text: "Strong opening", signals: { hook: 10, payoff: 8 } },
    { start: 50, end: 60, text: "Payoff", signals: { emotion: 9, payoff: 10 } }
  ] });
  const manifest = buildReeditRenderManifest({ plan, sourceLocalPath: "/assets/source.mp4", audioPath: "/assets/voice.wav", outputPath: "/out/reedit.mp4" });
  assert.equal(manifest.scenes.length, 2);
  assert.equal(manifest.scenes[0].sourceIn, 30);
  assert.equal(manifest.scenes[0].sourceOut, 40);
  assert.equal(manifest.scenes[1].start, 10);
  assert.equal(manifest.scenes[1].sourceIn, 50);
  assert.equal(manifest.scenes[0].sourceType, "creator_clip");
});

test("compilation plan maps separately authorized local clips and rejects missing media", () => {
  const base = { ...rights, sourceUrl: "https://media.example/clip.mp4", start: 5, end: 9, creator: "Creator" };
  const plan = buildCompilationPlan({ introCommentary: "Intro", outroCommentary: "Outro", clips: [
    { ...base, sourceId: "a", score: 5 }, { ...base, sourceId: "b", score: 8 }
  ] });
  const manifest = buildCompilationRenderManifest({ plan, mediaAssets: { a: { path: "/assets/a.mp4" }, b: { path: "/assets/b.mp4" } }, audioPath: "/assets/voice.wav", outputPath: "/out/compilation.mp4" });
  assert.equal(manifest.scenes.length, 2);
  assert.equal(manifest.scenes[0].sourceIn, 5);
  assert.equal(manifest.scenes[0].sourceOut, 9);
  assert.throws(() => buildCompilationRenderManifest({ plan, mediaAssets: {}, audioPath: "/voice.wav", outputPath: "/out.mp4" }), /Missing authorized local media/);
});
