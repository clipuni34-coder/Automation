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
  assert.equal(manifest.scenes[0].motionTreatment, manifest.scenes[0].punchIn ? "impact_punch_in" : "subtle_push");
  assert.equal(manifest.scenes[1].motionTreatment, manifest.scenes[1].punchIn ? "impact_punch_in" : "subtle_push");
  assert.ok(manifest.scenes[0].hookOverlayText);
});

test("re-edit selection scores moments but keeps the final dialogue in original source chronology", () => {
  const plan = buildReeditPlan({
    source: { ...rights, sourceUrl: "https://media.example/source.mp4", durationSeconds: 120 },
    targetDurationSeconds: 30,
    transcriptSegments: [
      { id: "later-hook", start: 80, end: 90, text: "The surprising final reveal", signals: { hook: 10, emotion: 10, curiosity: 10, payoff: 10, clarity: 10 } },
      { id: "early-context", start: 10, end: 20, text: "Here is the important background", signals: { hook: 2, emotion: 2, curiosity: 2, payoff: 2, clarity: 2 } },
      { id: "middle-payoff", start: 40, end: 50, text: "And this is what happened next", signals: { hook: 6, emotion: 6, curiosity: 6, payoff: 6, clarity: 6 } }
    ]
  });
  assert.deepEqual(plan.editDecisionList.map(item => item.segmentId), ["early-context", "middle-payoff", "later-hook"]);
  assert.deepEqual(plan.editDecisionList.map(item => item.sourceIn), [10, 40, 80]);
  assert.equal(plan.openingHook.segmentId, "early-context");
  assert.equal(plan.hookOverlay.segmentId, "later-hook");
  assert.match(plan.hookOverlay.text, /surprising final reveal/i);
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

test("original creative brief maps generated visuals to timed vertical render scenes", async () => {
  const { buildOriginalRenderManifest } = await import("../src/production/plan-manifest.js");
  const manifest = buildOriginalRenderManifest({
    brief: { topic: "Science", editorial: { visualPlan: [{ visual: "Planet" }, { visual: "Telescope" }, { visual: "Stars" }], scriptBeats: [{ narration: "First line" }, { narration: "Second line" }, { narration: "Final line" }] } },
    assets: [{ imagePath: "/assets/one.png", sourceType: "generated_visual", generationModel: "test-model", generationPrompt: "prompt one" }, { imagePath: "/assets/two.png", sourceType: "generated_visual", generationModel: "test-model", generationPrompt: "prompt two" }],
    audioPath: "/audio/voice.wav", outputPath: "/out/original.mp4", totalDurationSeconds: 40
  });
  assert.equal(manifest.scenes.length, 2);
  assert.equal(manifest.scenes[0].start, 0);
  assert.equal(manifest.scenes[0].end, 20);
  assert.equal(manifest.scenes[1].end, 40);
  assert.equal(manifest.scenes[0].caption, "First line");
});

test("original render manifest prefers concise editorial beat captions over full narration", async () => {
  const { buildOriginalRenderManifest } = await import("../src/production/plan-manifest.js");
  const manifest = buildOriginalRenderManifest({
    brief: { topic: "Sports", editorial: {
      visualPlan: [{ visual: "A dramatic stadium crowd" }],
      scriptBeats: [{ narration: "A long spoken sentence that explains the entire surprising moment in detail for the audience.", caption: "Nobody expected this!" }]
    } },
    assets: [{ imagePath: "/assets/one.ppm", sourceType: "original_graphic" }],
    audioPath: "/audio/voice.wav", outputPath: "/out/short.mp4", totalDurationSeconds: 12
  });
  assert.equal(manifest.scenes[0].caption, "Nobody expected this!");
  assert.ok(manifest.scenes[0].caption.length <= 52);
});

test("original render manifest carries scene descriptions into semantic visual review", async () => {
  const { buildOriginalRenderManifest } = await import("../src/production/plan-manifest.js");
  const manifest = buildOriginalRenderManifest({
    brief: { topic: "Sports", editorial: {
      visualPlan: [{ visual: "A baseball catcher throwing to second base", notes: "Show the catcher and runner." }],
      scriptBeats: [{ narration: "The catcher throws to second base.", caption: "A quick throw!" }]
    } },
    assets: [{ imagePath: "/assets/scene.ppm", sourceType: "original_graphic" }],
    audioPath: "/audio/voice.wav", outputPath: "/out/short.mp4", totalDurationSeconds: 10
  });
  assert.equal(manifest.scenes[0].visualDescription, "A baseball catcher throwing to second base");
  assert.equal(manifest.scenes[0].narrationContext, "The catcher throws to second base.");
});


test("strongest quarter receives restrained punch-ins and caption whitespace is normalized", () => {
  const plan = buildReeditPlan({
    source: { ...rights, sourceUrl: "https://media.example/source.mp4", durationSeconds: 60 },
    targetDurationSeconds: 20,
    transcriptSegments: [
      { start: 0, end: 5, text: "Wait,\nthis is surprising! A second sentence follows.", signals: { hook: 8, emotion: 8, curiosity: 8, payoff: 8, clarity: 8 } },
      { start: 10, end: 15, text: "The next part explains it.", signals: { hook: 6, emotion: 6, curiosity: 6, payoff: 6, clarity: 6 } },
      { start: 20, end: 25, text: "And finally, the outcome.", signals: { hook: 4.5, emotion: 4.5, curiosity: 4.5, payoff: 4.5, clarity: 4.5 } }
    ]
  });
  const manifest = buildReeditRenderManifest({ plan, sourceLocalPath: "/assets/source.mp4", audioPath: "/assets/voice.wav", outputPath: "/out/reedit.mp4" });
  assert.deepEqual(manifest.scenes.map(scene => scene.punchIn), [true, false, false]);
  assert.equal(manifest.scenes[0].caption, "Wait, this is surprising!");
});
