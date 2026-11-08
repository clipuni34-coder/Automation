import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseReviewedAudience, observedAudienceStatus } from "../src/platforms/youtube/audience.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const configPath = resolve(root, "config/channels.json");

function executePublisher(stateDir, reportPath, approval = {}, nodeArgs = []) {
  // Only synthetic local credentials are ever used in tests, and only with
  // a preloaded fake fetch implementation when an upload path is exercised.
  return spawnSync(process.execPath, [...nodeArgs, "scripts/publish-awaiting.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      STATE_DIR: stateDir,
      CHANNEL_PROFILES_PATH: configPath,
      PUBLISH_REPORT: reportPath,
      ...approval
    }
  });
}

async function setupQueue(dir, jobs) {
  const stateDir = join(dir, "state");
  await mkdir(join(stateDir, "Primeplug"), { recursive: true });
  await writeFile(join(stateDir, "Primeplug", "queue.json"), JSON.stringify({ version: 1, jobs }));
  await writeFile(join(stateDir, "Primeplug", "published.json"), JSON.stringify({ version: 1, videos: [] }));
  return stateDir;
}

function job(id, sha, path = "/no-such-file.mp4") {
  return {
    status: "completed",
    candidate: { id, title: `Test ${id}` },
    result: { produced: true, sha256: sha, title: `Test ${id}`, outputPath: path }
  };
}

test("reviewed audience parsing rejects omissions and invalid values rather than defaulting", () => {
  assert.equal(parseReviewedAudience("made_for_kids"), true);
  assert.equal(parseReviewedAudience("not_made_for_kids"), false);
  for (const value of [undefined, null, "", "review_required", "false", "true", false, true, "made for kids"]) {
    assert.equal(parseReviewedAudience(value), null);
  }
});

test("owner-declared and effective YouTube settings are independent and missing values stay unknown", () => {
  assert.deepEqual(observedAudienceStatus({ selfDeclaredMadeForKids: false, madeForKids: true }), {
    selfDeclaredMadeForKids: false, madeForKids: true
  });
  assert.deepEqual(observedAudienceStatus({ selfDeclaredMadeForKids: "false" }), {
    selfDeclaredMadeForKids: null, madeForKids: null
  });
  assert.deepEqual(observedAudienceStatus(null), { selfDeclaredMadeForKids: null, madeForKids: null });
});

test("a candidate/hash approval without its own audience selection holds the matching video", async () => {
  const dir = await mkdtemp(join(tmpdir(), "audience-gate-"));
  try {
    const shaA = "a".repeat(64);
    const shaB = "b".repeat(64);
    const stateDir = await setupQueue(dir, [job("a", shaA), job("b", shaB)]);
    const approval = { APPROVED_CANDIDATE_ID: "a", APPROVED_SHA256: shaA };
    for (const audience of [undefined, "", "review_required", "false"]) {
      const reportPath = join(dir, "publish-report.json");
      const outcome = executePublisher(stateDir, reportPath, { ...approval, ...(audience === undefined ? {} : { APPROVED_AUDIENCE: audience }) });
      assert.equal(outcome.status, 0, outcome.stderr);
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      assert.equal(report.approval.matched, true);
      assert.equal(report.results[0].status, "awaiting_audience_review");
      assert.equal(report.results[1].status, "awaiting_per_video_approval");
      assert.match(report.results[0].reasons.join(" "), /no upload attempted/);
    }
    const reportPath = join(dir, "selected-report.json");
    const outcome = executePublisher(stateDir, reportPath, { ...approval, APPROVED_AUDIENCE: "made_for_kids" });
    assert.equal(outcome.status, 0, outcome.stderr);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.results[0].status, "awaiting_approval_file_not_in_runner");
    assert.equal(report.results[0].audience, "made_for_kids");
    assert.equal(report.results[1].status, "awaiting_per_video_approval");

    const unmatched = executePublisher(stateDir, reportPath, { APPROVED_CANDIDATE_ID: "a", APPROVED_SHA256: shaB, APPROVED_AUDIENCE: "made_for_kids" });
    assert.equal(unmatched.status, 0, unmatched.stderr);
    const wrongHashReport = JSON.parse(await readFile(reportPath, "utf8"));
    assert.ok(wrongHashReport.results.every((entry) => entry.status === "awaiting_per_video_approval"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("exact video approval sends its reviewed audience and reports an API override separately (mock only)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "audience-mock-"));
  try {
    const videoPath = join(dir, "test.mp4");
    const bytes = Buffer.from("synthetic video data for a mocked test only");
    await writeFile(videoPath, bytes);
    const sha = createHash("sha256").update(bytes).digest("hex");
    const stateDir = await setupQueue(dir, [job("a", sha, videoPath), job("b", "b".repeat(64))]);
    const capturePath = join(dir, "captured.json");
    const preloadPath = join(dir, "mock-fetch.mjs");
    await writeFile(preloadPath, `
      import { writeFile } from "node:fs/promises";
      globalThis.fetch = async (input, options = {}) => {
        const url = String(input);
        const data = (x) => ({ ok: true, status: 200, json: async () => x });
        if (url === "https://oauth2.googleapis.com/token") return data({ access_token: "fake-access-token" });
        if (url.includes("/youtube/v3/channels?")) return data({ items: [{ id: "UCB7EhjM0bj2wtIBy_A_kkkg", snippet: { title: "Primeplug" } }] });
        if (url.startsWith("https://www.googleapis.com/upload/youtube/v3/videos?")) {
          await writeFile(process.env.TEST_CAPTURE_PATH, options.body);
          return { ok: true, status: 200, headers: { get: () => "https://www.googleapis.com/upload/youtube/v3/videos/session/mock" } };
        }
        if (url.startsWith("https://www.googleapis.com/upload/youtube/v3/videos/session/mock")) {
          return data({ id: "mock-video-id", status: { privacyStatus: "private" }, snippet: { channelId: "UCB7EhjM0bj2wtIBy_A_kkkg" } });
        }
        if (url.includes("part=status%2CprocessingDetails")) return data({ items: [{ status: { privacyStatus: "private" }, processingDetails: { processingStatus: "succeeded" } }] });
        if (url.includes("part=snippet,status")) return data({ items: [{ status: { privacyStatus: "private", selfDeclaredMadeForKids: true, madeForKids: false }, snippet: { channelId: "UCB7EhjM0bj2wtIBy_A_kkkg" } }] });
        throw new Error("Unexpected fake fetch URL: " + url);
      };
    `);
    const reportPath = join(dir, "report.json");
    const outcome = executePublisher(stateDir, reportPath, {
      APPROVED_CANDIDATE_ID: "a", APPROVED_SHA256: sha, APPROVED_AUDIENCE: "made_for_kids",
      YOUTUBE_CLIENT_ID: "fake-id", YOUTUBE_REFRESH_TOKEN: "fake-refresh", TEST_CAPTURE_PATH: capturePath
    }, ["--import", preloadPath]);
    assert.equal(outcome.status, 0, outcome.stderr);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.results[0].status, "uploaded_private_verified");
    assert.equal(report.results[1].status, "awaiting_per_video_approval");
    assert.equal(report.results[0].audienceVerification, "declaration_matches");
    assert.equal(report.results[0].effectiveAudienceVerification, "differs");
    assert.match(report.results[0].reasons.join(" "), /different from the per-video review/);
    const sent = JSON.parse(await readFile(capturePath, "utf8"));
    assert.equal(sent.status.privacyStatus, "private");
    assert.equal(sent.status.selfDeclaredMadeForKids, true);
    const state = JSON.parse(await readFile(join(stateDir, "Primeplug", "published.json"), "utf8"));
    assert.equal(state.videos.length, 1);
    assert.equal(state.videos[0].approvedAudience, "made_for_kids");
    assert.equal(state.videos[0].madeForKids, false);

    // A repeat using the same approval is idempotent and uploads nothing.
    const second = executePublisher(stateDir, reportPath, {
      APPROVED_CANDIDATE_ID: "a", APPROVED_SHA256: sha, APPROVED_AUDIENCE: "made_for_kids"
    });
    assert.equal(second.status, 0, second.stderr);
    assert.equal(JSON.parse(await readFile(join(stateDir, "Primeplug", "published.json"), "utf8")).videos.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("private smoke upload requires both a video-specific approval and audience before OAuth", async () => {
  const baseEnv = { PATH: process.env.PATH, SMOKE_UPLOAD_CONFIRM: "true", HUMAN_APPROVED: "true", YOUTUBE_PUBLISH_PRIVACY: "private" };
  const run = (extra) => spawnSync(process.execPath, ["scripts/upload-private-smoke.mjs"], { cwd: root, encoding: "utf8", env: { ...baseEnv, ...extra } });
  const missingApproval = run({ APPROVED_AUDIENCE: "made_for_kids" });
  assert.notEqual(missingApproval.status, 0);
  assert.match(missingApproval.stderr, /needs per-video approval/);
  const missingAudience = run({ APPROVED_CANDIDATE_ID: "apollo11-landing-baseline-smoke", APPROVED_SHA256: "a".repeat(64) });
  assert.notEqual(missingAudience.status, 0);
  assert.match(missingAudience.stderr, /explicitly reviewed audience/);
});

test("private smoke upload rejects a file whose SHA differs from approval", async () => {
  const dir = await mkdtemp(join(tmpdir(), "smoke-audience-hash-"));
  try {
    const videoPath = join(dir, "video.mp4");
    const resultPath = join(dir, "result.json");
    await writeFile(videoPath, "synthetic file");
    await writeFile(resultPath, JSON.stringify({ status: "completed", outputPath: videoPath, postingPackage: { platformPackages: { youtube_shorts: { title: "Example" } } } }));
    const outcome = spawnSync(process.execPath, ["scripts/upload-private-smoke.mjs", resultPath], {
      cwd: root, encoding: "utf8",
      env: {
        PATH: process.env.PATH, SMOKE_UPLOAD_CONFIRM: "true", HUMAN_APPROVED: "true", YOUTUBE_PUBLISH_PRIVACY: "private",
        APPROVED_CANDIDATE_ID: "apollo11-landing-baseline-smoke", APPROVED_SHA256: "a".repeat(64), APPROVED_AUDIENCE: "not_made_for_kids"
      }
    });
    assert.notEqual(outcome.status, 0);
    assert.match(outcome.stderr, /does not match the exact owner-approved SHA-256/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("workflow passes the reviewed audience with each private approval", async () => {
  const daily = await readFile(resolve(root, ".github/workflows/daily-operations.yml"), "utf8");
  const smoke = await readFile(resolve(root, ".github/workflows/private-upload-smoke.yml"), "utf8");
  assert.match(daily, /approve_audience:/);
  assert.equal((daily.match(/APPROVED_AUDIENCE: \$\{\{ inputs\.approve_audience \}\}/g) ?? []).length, 2);
  assert.match(smoke, /APPROVED_AUDIENCE: \$\{\{ inputs\.approve_audience \}\}/);
  assert.match(smoke, /APPROVED_CANDIDATE_ID: \$\{\{ inputs\.approve_candidate_id \}\}/);
  assert.match(smoke, /APPROVED_SHA256: \$\{\{ inputs\.approve_sha256 \}\}/);
});
