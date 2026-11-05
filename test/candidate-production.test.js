import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyRepurpose, rankRow, summariseComparison } from "../scripts/candidate-utils.mjs";

const base = (over = {}) => ({
  id: "x", label: "X", creator: "NASA", sourceUrl: "https://upload.wikimedia.org/x.webm",
  rightsEvidenceUrl: "https://commons.wikimedia.org/wiki/File:X",
  license: { type: "public_domain", verificationStatus: "evidence_recorded_not_independently_verified" },
  originalProbe: { width: 1920, height: 1080 },
  status: "completed",
  pipeline: { editorialAverage: 7, visualQualityScore: 90, title: "T", selectedMoments: [] },
  qc: { status: "passed", repaired: false }, outputProbe: { durationSeconds: 20 },
  outputPath: "o.mp4", thumbnailPath: "t.jpg", sha256: "abc", ...over
});

test("multiple manifest entries are each ranked or explained", () => {
  const rows = [rankRow(base({ id: "a" })), rankRow(base({ id: "b", status: "held_editorial_gate", reason: "weak", pipeline: null, qc: null }))];
  const summary = summariseComparison(rows);
  assert.equal(summary.counts.total, 2);
  assert.equal(summary.counts.completed, 1);
  assert.equal(summary.winner, "a");
  assert.equal(summary.candidates.find((c) => c.id === "b").rankScore, null);
});

test("missing results are visible but never scored or declared winner", () => {
  const row = rankRow({ id: "ghost", status: "missing_result" });
  assert.equal(row.eligible, false);
  assert.equal(row.rankScore, null);
  assert.match(row.reason, /No structured result/);
  assert.equal(summariseComparison([row]).winner, null);
});

test("no eligible winners when every candidate is held, rejected or QC-failed", () => {
  const rows = [
    rankRow(base({ id: "weak", status: "held_editorial_gate", reason: "below gate", pipeline: null, qc: null })),
    rankRow(base({ id: "qcfail", qc: { status: "failed", failures: ["resolution"] } })),
    rankRow(base({ id: "lowres", status: "rejected_low_resolution", reason: "320x240", pipeline: null, qc: null }))
  ];
  const summary = summariseComparison(rows);
  assert.equal(summary.winner, null);
  assert.match(summary.winnerRationale, /No candidate completed/);
  assert.equal(summary.counts.eligible, 0);
});

test("QC-passed-after-repair candidates remain eligible; QC-failed do not", () => {
  assert.equal(rankRow(base({ qc: { status: "passed_after_repair", repaired: true } })).eligible, true);
  assert.equal(rankRow(base({ qc: { status: "failed" } })).rankScore, null);
});

test("winner selection prefers the genuinely stronger completed candidate", () => {
  const strong = rankRow(base({ id: "strong", pipeline: { editorialAverage: 8, visualQualityScore: 100, title: "S", selectedMoments: [] } }));
  const weaker = rankRow(base({ id: "weaker", pipeline: { editorialAverage: 6, visualQualityScore: 80, title: "W", selectedMoments: [] }, outputProbe: { durationSeconds: 7 } }));
  const summary = summariseComparison([weaker, strong]);
  assert.equal(summary.winner, "strong");
  assert.ok(summary.candidates[0].rankScore > summary.candidates[1].rankScore);
});

test("repurpose classification is truthful for each failure family", () => {
  assert.equal(classifyRepurpose({ exitCode: 2, result: { status: "editorial_review_required", plan: { editorialQuality: { averageSelectedScore: 4.2 } } } }).status, "held_editorial_gate");
  assert.equal(classifyRepurpose({ exitCode: 1, result: null, stderr: "Source video has no audio stream" }).status, "rejected_no_audio");
  assert.equal(classifyRepurpose({ exitCode: 1, result: null, stderr: "Whisper returned no valid word-level timestamps" }).status, "rejected_no_speech");
  assert.equal(classifyRepurpose({ exitCode: 0, result: { status: "completed" } }).status, "completed");
  assert.equal(classifyRepurpose({ exitCode: 1, result: null, stderr: "boom" }).status, "failed_pipeline");
});

test("candidate production workflow processes every entry and never uploads", async () => {
  const workflow = await readFile(new URL("../.github/workflows/candidate-production.yml", import.meta.url), "utf8");
  assert.match(workflow, /produce-candidates\.mjs config\/candidate-manifest\.json/);
  assert.match(workflow, /compare-candidates\.mjs/);
  assert.match(workflow, /SHA256SUMS/);
  assert.doesNotMatch(workflow, /upload-private-smoke|youtube-upload|SMOKE_UPLOAD|YOUTUBE_REFRESH_TOKEN/);
  const producer = await readFile(new URL("../scripts/produce-candidates.mjs", import.meta.url), "utf8");
  for (const gate of ["rejected_invalid_url", "rejected_rights_unverified", "rejected_low_resolution", "rejected_no_audio", "failed_qc"]) {
    assert.match(producer, new RegExp(gate), gate);
  }
  assert.match(producer, /classifyRepurpose/);
  const utils = await readFile(new URL("../scripts/candidate-utils.mjs", import.meta.url), "utf8");
  assert.match(utils, /held_editorial_gate/);
});

test("manifest records licence, attribution, evidence and processing for every candidate", async () => {
  const manifest = JSON.parse(await readFile(new URL("../config/candidate-manifest.json", import.meta.url), "utf8"));
  assert.ok(manifest.length >= 6);
  const hosts = new Set();
  for (const c of manifest) {
    assert.match(c.sourceUrl, /^https:\/\//, c.id);
    hosts.add(new URL(c.sourceUrl).hostname);
    assert.equal(c.license.type, "public_domain", c.id);
    assert.match(c.license.basis, /federal government|§ 105/, c.id);
    assert.ok(c.license.attributionRequirement, c.id);
    assert.match(c.rightsEvidenceUrl, /^https:\/\//, c.id);
    assert.ok(c.processing?.targetDurationSeconds > 0, c.id);
    assert.equal(c.resultPath, undefined, `${c.id} must not point at stale local results`);
  }
  assert.ok(hosts.size >= 2);
});
