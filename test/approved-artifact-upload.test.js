import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { restoreAndReserveApprovedArtifact } from "../src/production/approved-artifact.js";
import { openChannelState } from "../src/engine/state.js";

const repo = fileURLToPath(new URL("..", import.meta.url));
const id = "seal-test";
const attemptId = "gha-test-1";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "approved-artifact-test-"));
  const stateRoot = join(dir, "state");
  const outputDir = join(stateRoot, "Primeplug", "production", "output", "attempts", "one");
  const artifactRoot = join(dir, "artifact");
  await mkdir(outputDir, { recursive: true });
  await mkdir(join(artifactRoot, "nested"), { recursive: true });
  const bytes = Buffer.from("synthetic bytes; not a real video and never uploadable");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const path = join(outputDir, `${id}.mp4`);
  const sourceUrl = "https://example.org/creative-commons-video";
  const credit = "Example creator, CC BY 3.0, edited.";
  const job = {
    status: "completed",
    candidate: { id, sourceUrl, license: { type: "CC BY 3.0", attributionRequirement: credit }, rightsVerification: { status: "rights_verified_with_evidence", commercialUse: true, derivativesAllowed: true, observedLicence: "CC BY 3.0" } },
    result: { produced: true, sha256: sha, outputPath: path, title: "Test seal", postingPackage: { description: `Source and credit: ${credit}`, hashtags: ["#Shorts"] } }
  };
  await writeFile(join(stateRoot, "Primeplug", "queue.json"), JSON.stringify({ version: 1, jobs: [job] }));
  await writeFile(join(stateRoot, "Primeplug", "published.json"), JSON.stringify({ version: 1, videos: [] }));
  await writeFile(join(outputDir, `${id}.candidate.json`), JSON.stringify({ id, sha256: sha, sourceUrl, status: "completed", qc: { status: "passed" }, advancedQc: { passed: true } }));
  await writeFile(join(artifactRoot, "nested", `${id}.mp4`), bytes);
  return { dir, stateRoot, artifactRoot, outputDir, path, job, sha, opts: { stateRoot, artifactRoot, approvedCandidateId: id, approvedSha256: sha, approvedAudience: "not_made_for_kids", attemptId } };
}

async function clean(f) { await rm(f.dir, { recursive: true, force: true }); }
async function readJson(path) { return JSON.parse(await readFile(path, "utf8")); }

function publisher(f, extra = {}, preload = null) {
  const args = [...(preload ? ["--import", preload] : []), "scripts/publish-awaiting.mjs"];
  return spawnSync(process.execPath, args, {
    cwd: repo, encoding: "utf8",
    env: { PATH: process.env.PATH, STATE_DIR: f.stateRoot, CHANNEL_PROFILES_PATH: resolve(repo, "config/channels.json"), PUBLISH_REPORT: join(f.dir, "report.json"), APPROVED_CANDIDATE_ID: id, APPROVED_SHA256: f.sha, APPROVED_AUDIENCE: "not_made_for_kids", UPLOAD_ATTEMPT_ID: attemptId, ...extra }
  });
}

async function mockFetch(f, mode) {
  const preload = join(f.dir, `mock-${mode}.mjs`);
  await writeFile(preload, `
    import { appendFile, writeFile } from 'node:fs/promises';
    globalThis.fetch = async (input, options = {}) => {
      const url = String(input);
      await appendFile(process.env.CAPTURE, url + '\\n');
      const data = x => ({ ok: true, status: 200, json: async () => x });
      if (url === 'https://oauth2.googleapis.com/token') return data({ access_token: 'fake-access-token' });
      if (url.includes('/youtube/v3/channels?')) return data({ items: [{ id: 'UCB7EhjM0bj2wtIBy_A_kkkg', snippet: { title: 'Primeplug' } }] });
      if (url.startsWith('https://www.googleapis.com/upload/youtube/v3/videos?')) {
        await writeFile(process.env.METADATA_CAPTURE, options.body);
        return { ok: true, status: 200, headers: { get: () => 'https://www.googleapis.com/upload/youtube/v3/videos/session/fake' } };
      }
      if (url.startsWith('https://www.googleapis.com/upload/youtube/v3/videos/session/fake')) {
        if (${JSON.stringify(mode)} === 'unknown') throw new Error('mock response lost');
        return data({ id: 'fake-private-video', status: { privacyStatus: 'private' }, snippet: { channelId: 'UCB7EhjM0bj2wtIBy_A_kkkg' } });
      }
      if (url.includes('part=status%2CprocessingDetails')) {
        if (${JSON.stringify(mode)} === 'verified') return data({ items: [{ status: { privacyStatus: 'private' }, processingDetails: { processingStatus: 'succeeded' } }] });
        return { ok: false, status: 403, json: async () => ({ error: { message: 'mock read denied' } }) };
      }
      if (url.includes('part=snippet,status') && ${JSON.stringify(mode)} === 'verified') return data({ items: [{ status: { privacyStatus: 'private', selfDeclaredMadeForKids: false, madeForKids: false }, snippet: { channelId: 'UCB7EhjM0bj2wtIBy_A_kkkg' } }] });
      throw new Error('Unexpected mock request: ' + url);
    };
  `);
  return preload;
}

test("restoration requires a specific reviewed video, rights, passed QC, audience and matching artifact", async () => {
  const f = await fixture();
  try {
    await assert.rejects(restoreAndReserveApprovedArtifact({ ...f.opts, approvedAudience: "review_required" }), /audience/);
    await assert.rejects(restoreAndReserveApprovedArtifact({ ...f.opts, approvedSha256: "a".repeat(64) }), /match exactly one/);
    await writeFile(join(f.artifactRoot, "nested", `${id}.mp4`), "tampered");
    await assert.rejects(restoreAndReserveApprovedArtifact(f.opts), /approved hash/);
    assert.equal((await openChannelState(f.stateRoot, "Primeplug")).getUploadAttempts instanceof Function, true);
    assert.deepEqual((await (await openChannelState(f.stateRoot, "Primeplug")).getUploadAttempts()).attempts, []);
  } finally { await clean(f); }
});

test("preparation restores only exact bytes and reserves an idempotent upload without network access", async () => {
  const f = await fixture();
  try {
    const result = await restoreAndReserveApprovedArtifact(f.opts);
    assert.equal(result.status, "prepared_not_uploaded");
    assert.equal(createHash("sha256").update(await readFile(f.path)).digest("hex"), f.sha);
    const state = await openChannelState(f.stateRoot, "Primeplug");
    assert.equal((await state.getUploadAttempts()).attempts[0].status, "reserved");
    await assert.rejects(restoreAndReserveApprovedArtifact({ ...f.opts, attemptId: "gha-test-2" }), /already exists/);
    assert.equal((await state.getPublished()).videos.length, 0);
  } finally { await clean(f); }
});

test("preparation rejects a missing QC pass, insufficient attribution and escaped output path", async () => {
  for (const mode of ["qc", "credit", "path"]) {
    const f = await fixture();
    try {
      if (mode === "qc") {
        const meta = await readJson(join(f.outputDir, `${id}.candidate.json`));
        meta.qc.status = "failed";
        await writeFile(join(f.outputDir, `${id}.candidate.json`), JSON.stringify(meta));
      } else if (mode === "credit") {
        f.job.result.postingPackage.description = "No creator attribution";
        await writeFile(join(f.stateRoot, "Primeplug", "queue.json"), JSON.stringify({ jobs: [f.job] }));
      } else {
        f.job.result.outputPath = join(f.dir, `${id}.mp4`);
        await writeFile(join(f.stateRoot, "Primeplug", "queue.json"), JSON.stringify({ jobs: [f.job] }));
      }
      await assert.rejects(restoreAndReserveApprovedArtifact(f.opts), /QC record|attribution|outside the production/);
      assert.deepEqual((await (await openChannelState(f.stateRoot, "Primeplug")).getUploadAttempts()).attempts, []);
    } finally { await clean(f); }
  }
});

test("a corrupt attempt ledger fails closed", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.stateRoot, "Primeplug", "upload-attempts.json"), "not-json");
    await assert.rejects(restoreAndReserveApprovedArtifact(f.opts), /invalid JSON/);
    const run = publisher(f);
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /invalid JSON/);
  } finally { await clean(f); }
});

test("the reserved file is uploaded once, privately, with its reviewed audience and source credit (mock only)", async () => {
  const f = await fixture();
  try {
    await restoreAndReserveApprovedArtifact(f.opts);
    const preload = await mockFetch(f, "verified");
    const env = { YOUTUBE_CLIENT_ID: "fake", YOUTUBE_REFRESH_TOKEN: "fake", CAPTURE: join(f.dir, "requests.txt"), METADATA_CAPTURE: join(f.dir, "metadata.json") };
    const run = publisher(f, env, preload);
    assert.equal(run.status, 0, run.stderr);
    const entry = (await readJson(join(f.dir, "report.json"))).results[0];
    assert.equal(entry.status, "uploaded_private_verified");
    assert.equal(entry.audienceVerification, "declaration_matches");
    assert.equal(entry.effectiveAudienceVerification, "matches");
    assert.equal(entry.processingStatus, "succeeded");
    const sent = await readJson(env.METADATA_CAPTURE);
    assert.equal(sent.status.privacyStatus, "private");
    assert.equal(sent.status.selfDeclaredMadeForKids, false);
    assert.match(sent.snippet.description, /Example creator, CC BY 3.0/);
    const state = await openChannelState(f.stateRoot, "Primeplug");
    assert.equal((await state.getUploadAttempts()).attempts[0].status, "verified");
    assert.equal((await state.getPublished()).videos[0].uploadVerification, "private_channel_verified");
    const before = await readFile(env.CAPTURE, "utf8");
    const second = publisher(f, env, preload);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(await readFile(env.CAPTURE, "utf8"), before);
  } finally { await clean(f); }
});

test("an accepted upload remains recorded and cannot repeat when processing verification fails (mock only)", async () => {
  const f = await fixture();
  try {
    await restoreAndReserveApprovedArtifact(f.opts);
    const preload = await mockFetch(f, "accepted");
    const env = { YOUTUBE_CLIENT_ID: "fake", YOUTUBE_REFRESH_TOKEN: "fake", CAPTURE: join(f.dir, "requests.txt"), METADATA_CAPTURE: join(f.dir, "metadata.json") };
    const run = publisher(f, env, preload);
    assert.equal(run.status, 0, run.stderr);
    const report = await readJson(join(f.dir, "report.json"));
    assert.equal(report.results[0].status, "uploaded_unverified");
    assert.equal(report.results[0].videoId, "fake-private-video");
    const state = await openChannelState(f.stateRoot, "Primeplug");
    assert.equal((await state.getUploadAttempts()).attempts[0].status, "uploaded");
    assert.equal((await state.getPublished()).videos[0].videoId, "fake-private-video");
    assert.equal((await state.getPublished()).videos[0].uploadVerification, "pending");
    const before = await readFile(env.CAPTURE, "utf8");
    const second = publisher(f, env, preload);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(await readFile(env.CAPTURE, "utf8"), before);
  } finally { await clean(f); }
});

test("an unknown upload result keeps the reservation and blocks another request (mock only)", async () => {
  const f = await fixture();
  try {
    await restoreAndReserveApprovedArtifact(f.opts);
    const preload = await mockFetch(f, "unknown");
    const env = { YOUTUBE_CLIENT_ID: "fake", YOUTUBE_REFRESH_TOKEN: "fake", CAPTURE: join(f.dir, "requests.txt"), METADATA_CAPTURE: join(f.dir, "metadata.json") };
    const run = publisher(f, env, preload);
    assert.equal(run.status, 0, run.stderr);
    assert.equal((await readJson(join(f.dir, "report.json"))).results[0].status, "upload_result_unknown");
    const state = await openChannelState(f.stateRoot, "Primeplug");
    assert.equal((await state.getUploadAttempts()).attempts[0].status, "unknown");
    assert.equal((await state.getPublished()).videos.length, 0);
    const before = await readFile(env.CAPTURE, "utf8");
    const second = publisher(f, env, preload);
    assert.equal(second.status, 0, second.stderr);
    assert.equal((await readJson(join(f.dir, "report.json"))).results[0].status, "blocked_prior_or_mismatched_upload_attempt");
    assert.equal(await readFile(env.CAPTURE, "utf8"), before);
  } finally { await clean(f); }
});

test("artifact upload is private, manual, isolated from hashtag updates, and reserves before upload", async () => {
  const text = await readFile(join(repo, ".github/workflows/e2e-smoke.yml"), "utf8");
  assert.match(text, /github\.event_name == 'workflow_dispatch' && inputs\.upload_existing_private == true/);
  assert.match(text, /inputs\.update_primeplug_hashtags != true && inputs\.private_upload_smoke != true/);
  assert.match(text, /actions\/download-artifact@v4/);
  assert.match(text, /APPROVED_AUDIENCE: \$\{\{ inputs\.approve_audience \}\}/);
  assert.match(text, /YOUTUBE_ALLOW_PUBLIC_PUBLISH: "false"/);
  assert.ok(text.indexOf("Persist duplicate-prevention reservation BEFORE upload") < text.indexOf("Upload the approved file PRIVATE"));
  assert.match(text, /group: daily-operations/);
});
