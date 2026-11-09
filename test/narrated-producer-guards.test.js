import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, chmod, readFile, rm, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { primeplugCreativePathwayGate } from "../src/engine/primeplug-creative-policy.js";
import { narratedRequeueDecision } from "../src/engine/retry-policy.js";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "narrated-guard-"));
  const bin = join(root, "bin"), work = join(root, "work"), out = join(root, "out");
  await Promise.all([mkdir(bin), mkdir(work), mkdir(out)]);
  const source = join(root, "source.bin");
  const bytes = Buffer.from("local fake source used only for guard tests");
  await writeFile(source, bytes);
  for (const name of ["model.onnx", "voices.bin"]) await writeFile(join(root, name), "fake model");
  const executables = {
    curl: `#!/usr/bin/env node\nconst fs=require('fs');const a=process.argv;fs.copyFileSync(process.env.MOCK_SOURCE,a[a.indexOf('-o')+1]);fs.writeFileSync(process.env.CURL_MARKER,'called');\n`,
    ffprobe: `#!/usr/bin/env node\nif(process.argv.includes('json')) console.log(JSON.stringify({format:{duration:'30'},streams:[{codec_type:'video',width:1280,height:720},{codec_type:'audio'}]})); else console.log('14');\n`,
    kokoro: `#!/usr/bin/env node\nconst fs=require('fs');const req=JSON.parse(fs.readFileSync(0,'utf8'));fs.writeFileSync(req.outputPath,'fake wav');console.log(JSON.stringify({status:'generated',provider:'kokoro-onnx',voice:req.voice}));\n`,
    asr: `#!/usr/bin/env node\nconst fs=require('fs');if(process.env.ASR_MODE==='error'){console.error('network timed out');process.exit(1);}if(['mismatch','wrong-engine'].includes(process.env.ASR_MODE))fs.writeFileSync(process.argv[4],JSON.stringify({status:'transcribed',engine:process.env.ASR_MODE==='wrong-engine'?'mock':'faster-whisper',model:'base',language:'en',droppedWordCount:0,words:[{word:'one',start:0,end:.2,probability:.9}]}));\n`
  };
  for (const [name, content] of Object.entries(executables)) { const path = join(bin, name); await writeFile(path, content); await chmod(path, 0o755); }
  const seed = {
    id: "test-seal", label: "Test seal", creator: "Test creator", sourceUrl: "https://upload.wikimedia.org/test.webm",
    rightsEvidenceUrl: "https://commons.wikimedia.org/wiki/File:test.webm", license: { rightsStatus: "licensed", type: "CC BY 4.0", basis: "A test-only documented reuse licence", attributionRequirement: "Test attribution" },
    productionMode: "narrated", window: { startSeconds: 0, seconds: 20 }, hookText: "A playful seal spots the diver.", postingTitle: "A seal and a diver", visualSubject: "seal",
    narrationScript: "A playful seal spots the diver. It circles the fin and comes very close to the camera. The curious seal returns to the diver before swimming away again.",
    storyBeats: { hook: "The seal spots the diver.", development: "It circles the fin.", payoff: "The seal swims away." },
    visualHookReview: { status: "editorial_reviewed", sourceUrl: "https://upload.wikimedia.org/test.webm", sourceSha256: createHash("sha256").update(bytes).digest("hex"), windowStartSeconds: 0, firstActionSourceSeconds: 0.2, reviewedThroughSourceSeconds: 1.75, onScreenText: "A playful seal", visualAction: "The seal approaches the diver's fin.", reviewMethod: "Eight quarter-second source frames reviewed.", reviewedBy: "Synthetic test reviewer" }
  };
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, ENABLE_GEMINI_TTS: "false", GEMINI_API_KEY: "", KOKORO_MODEL_PATH: join(root, "model.onnx"), KOKORO_VOICES_PATH: join(root, "voices.bin"), KOKORO_PYTHON: join(bin, "kokoro"), PYTHON: join(bin, "asr"), MOCK_SOURCE: source, CURL_MARKER: join(root, "curl-called") };
  return { root, out, work, seed, env, cleanup: () => rm(root, { recursive: true, force: true }) };
}
async function run(t, entry, asrMode = "no-file") {
  const manifest = join(t.root, "manifest.json");
  await writeFile(manifest, JSON.stringify([entry]));
  const result = spawnSync(process.execPath, [resolve("scripts/produce-narrated.mjs"), manifest, t.out, t.work], { cwd: resolve("."), env: { ...t.env, ASR_MODE: asrMode }, encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(await readFile(join(t.out, `${entry.id}.candidate.json`), "utf8"));
}

test("missing opening review and invalid source-audio rights hold before downloading", async () => {
  const t = await setup();
  try {
    const unreviewed = { ...t.seed }; delete unreviewed.visualHookReview;
    const first = await run(t, unreviewed);
    assert.equal(first.status, "held_hook_unreviewed");
    await assert.rejects(access(join(t.root, "curl-called")));
    const badAudio = { ...t.seed, sourceAudio: { enabled: true, license: "unknown" } };
    const second = await run(t, badAudio);
    assert.equal(second.status, "held_audio_rights_unverified");
    await assert.rejects(access(join(t.root, "curl-called")));
  } finally { await t.cleanup(); }
});

test("a changed downloaded source cannot reuse an old editorial opening review", async () => {
  const t = await setup();
  try {
    const changed = { ...t.seed, visualHookReview: { ...t.seed.visualHookReview, sourceSha256: "0".repeat(64) } };
    const outcome = await run(t, changed);
    assert.equal(outcome.status, "held_hook_source_changed");
    assert.notEqual(outcome.visualHookReview.sourceSha256, changed.visualHookReview.sourceSha256);
    assert.equal(outcome.outputPath, null);
  } finally { await t.cleanup(); }
});

test("stale narration timings are deleted; an ASR success without a fresh file is held", async () => {
  const t = await setup();
  try {
    const stale = join(t.work, `${t.seed.id}.narration-words.json`);
    await writeFile(stale, JSON.stringify({ status: "transcribed", words: [{ word: "stale", start: 0, end: 1 }] }));
    const outcome = await run(t, t.seed, "no-file");
    assert.equal(outcome.status, "held_caption_alignment_unavailable");
    assert.match(outcome.reason, /fresh word-timing file/);
    await assert.rejects(access(stale));
    assert.equal(outcome.sourceAudio.mixed, false);
  } finally { await t.cleanup(); }
});

test("transcription failure and unmatched speech cannot pass or render an output", async () => {
  const t = await setup();
  try {
    const unavailable = await run(t, t.seed, "error");
    assert.equal(unavailable.status, "held_caption_alignment_unavailable");
    assert.match(unavailable.reason, /network timed out/);
    const wrongEngine = await run(t, t.seed, "wrong-engine");
    assert.equal(wrongEngine.status, "held_caption_alignment_unavailable");
    assert.match(wrongEngine.reason, /unexpected engine/);
    const mismatch = await run(t, t.seed, "mismatch");
    assert.equal(mismatch.status, "held_caption_alignment");
    assert.match(mismatch.reason, /word counts differ/);
    assert.equal(mismatch.outputPath, null);
    assert.equal(mismatch.sourceAudio.mixed, false);
  } finally { await t.cleanup(); }
});

test("Primeplug's legacy excerpt path cannot bypass opening and audio clearance; other channels are unchanged", () => {
  assert.equal(primeplugCreativePathwayGate({ id: "Primeplug" }, { productionMode: "narrated" }).allowed, true);
  const held = primeplugCreativePathwayGate({ id: "Primeplug" }, { productionMode: "excerpt" });
  assert.equal(held.allowed, false); assert.equal(held.outcome, "held_excerpt_creative_review");
  assert.equal(primeplugCreativePathwayGate({ id: "other" }, { productionMode: "excerpt" }).allowed, true);
});

test("a legacy excerpt held by this new gate reopens only with a reviewed narrated replacement", async () => {
  const t = await setup();
  try {
    const old = { ...t.seed, productionMode: "excerpt" }; delete old.visualHookReview;
    const job = { status: "completed", candidate: { id: old.id, sourceUrl: old.sourceUrl, seedManifestEntry: old }, result: { produced: false, outcome: "held_excerpt_creative_review" } };
    assert.deepEqual(narratedRequeueDecision(job, t.seed), { requeue: true, reason: "reviewed_narrated_plan_for_legacy_excerpt" });
    const noReview = { ...t.seed }; delete noReview.visualHookReview;
    assert.equal(narratedRequeueDecision(job, noReview).requeue, false);
  } finally { await t.cleanup(); }
});
