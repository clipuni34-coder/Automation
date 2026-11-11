import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openChannelState } from "../src/engine/state.js";
import { readPlanningInbox } from "../src/engine/planning-inbox.js";
import { PIXABAY_SEARCH_CACHE_MS } from "../src/discovery/sources/pixabay-planning.js";
import { PIXABAY_SHARED_BRANCH, PIXABAY_SHARED_CACHE_PATH, PIXABAY_SHARED_MARKER_PATH, PIXABAY_SHARED_MARKER, searchPixabayShared } from "../src/discovery/sources/pixabay-shared-search.js";

const KEY = "synthetic_key_never_real_984263";
const when = new Date("2026-11-01T12:00:00Z");
const options = (repository, extra = {}) => ({ repository, query: "funny cats", apiKey: KEY, now: when, authorized: true, clockVerified: true, ...extra });
const hit = (extra = {}) => ({ id: 42, type: "film", duration: 20, pageURL: "https://pixabay.com/videos/kitten-playing-42/", tags: "kitten, playing, cat", user: "ExampleCreator",
  videos: { large: { url: "https://cdn.pixabay.com/video/2024/01/01/42-123_large.mp4", width: 1920, height: 1080, size: 12345 } }, ...extra });
const response = (items = [hit()]) => new Response(JSON.stringify({ totalHits: items.length, hits: items }), { status: 200, headers: { "content-type": "application/json" } });
function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 20000, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" } });
  if (r.status !== 0) throw new Error(`test git failed: ${args.join(" ")} ${r.stderr}`);
  return r.stdout.trim();
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "pixabay-git-test-")), bare = join(root, "remote.git"), a = join(root, "repo-a"), b = join(root, "repo-b");
  git(["init", "--bare", "--quiet", bare]);
  for (const repo of [a, b]) {
    git(["init", "--quiet", repo]); git(["-C", repo, "remote", "add", "origin", bare]);
    git(["-C", repo, "config", "user.name", "Synthetic Test"]); git(["-C", repo, "config", "user.email", "test@example.invalid"]);
  }
  await mkdir(join(a, "Primeplug"));
  await writeFile(join(a, PIXABAY_SHARED_MARKER_PATH), JSON.stringify(PIXABAY_SHARED_MARKER) + "\n");
  await writeFile(join(a, PIXABAY_SHARED_CACHE_PATH), '{"version":1,"entries":[]}\n');
  git(["-C", a, "add", "."]); git(["-C", a, "commit", "--quiet", "-m", "initialize synthetic cache"]);
  git(["-C", a, "push", "--quiet", "origin", `HEAD:${PIXABAY_SHARED_BRANCH}`]);
  const remote = () => git(["--git-dir", bare, "show", `${PIXABAY_SHARED_BRANCH}:${PIXABAY_SHARED_CACHE_PATH}`]);
  return { root, bare, a, b, remote, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("shared cache publishes a reservation BEFORE a request and a second checkout reuses the 24-hour result", async () => {
  const t = await setup();
  try {
    let calls = 0;
    const first = await searchPixabayShared(options(t.a, { fetchImpl: async (url, opts) => {
      calls++; assert.equal(opts.redirect, "error");
      assert.equal(new URL(url).searchParams.get("key"), KEY);
      const reserved = t.remote(); assert.ok(!reserved.includes(KEY));
      assert.equal(JSON.parse(reserved).entries[0].status, "pending");
      return response();
    } }));
    assert.equal(calls, 1); assert.equal(first.cached, false); assert.equal(first.providerRequestSent, true); assert.equal(first.leads.length, 1);
    assert.equal(JSON.parse(t.remote()).entries[0].status, "ok"); assert.ok(!t.remote().includes(KEY));
    const cached = await searchPixabayShared(options(t.b, { apiKey: "", query: "FUNNY  CATS", now: new Date(when.getTime() + PIXABAY_SEARCH_CACHE_MS - 1), fetchImpl: async () => { calls++; throw new Error("must use cache"); } }));
    assert.equal(cached.cached, true); assert.equal(cached.providerRequestSent, false); assert.equal(calls, 1);
    assert.deepEqual(cached.leads, first.leads);
    const later = await searchPixabayShared(options(t.b, { now: new Date(when.getTime() + PIXABAY_SEARCH_CACHE_MS), fetchImpl: async () => { calls++; return response(); } }));
    assert.equal(later.cached, false); assert.equal(calls, 2);
    assert.equal(git(["-C", t.a, "status", "--porcelain"]), "", "plumbing must not alter the checkout");
    assert.equal(git(["-C", t.b, "status", "--porcelain"]), "", "plumbing must not alter the other checkout");
  } finally { await t.cleanup(); }
});

test("two concurrent checkouts using the same old head allow only one provider request", { timeout: 20000 }, async () => {
  const t = await setup();
  try {
    let arrived = 0, release;
    const barrier = new Promise((resolve) => { release = resolve; });
    const beforeReservationCommit = async () => { if (++arrived === 2) release(); await barrier; };
    let requests = 0;
    const fetchImpl = async () => { requests++; return response(); };
    const results = await Promise.allSettled([
      searchPixabayShared(options(t.a, { query: "cats", fetchImpl, beforeReservationCommit })),
      searchPixabayShared(options(t.b, { query: "dogs", fetchImpl, beforeReservationCommit }))
    ]);
    assert.equal(arrived, 2); assert.equal(requests, 1);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    assert.match(results.find((r) => r.status === "rejected").reason.message, /reservation could not be confirmed/);
    const cache = JSON.parse(t.remote());
    assert.equal(cache.entries.length, 1); assert.equal(cache.entries[0].status, "ok");
    assert.ok(!t.remote().includes(KEY));
  } finally { await t.cleanup(); }
});

test("failure is cached after the provider response and a second checkout does not retry inside 24 hours", async () => {
  const t = await setup();
  try {
    let calls = 0;
    const fetchImpl = async () => { calls++; return new Response("failure", { status: 403 }); };
    await assert.rejects(searchPixabayShared(options(t.a, { fetchImpl })), /Pixabay video search returned HTTP 403/);
    assert.equal(JSON.parse(t.remote()).entries[0].status, "failed");
    await assert.rejects(searchPixabayShared(options(t.b, { now: new Date(when.getTime() + 1000), fetchImpl })), /will not be repeated/);
    assert.equal(calls, 1);
  } finally { await t.cleanup(); }
});

test("a process dying after reservation leaves a remote pending hold, even days later and for a different query", async () => {
  const t = await setup();
  try {
    const moduleUrl = pathToFileURL(resolve("src/discovery/sources/pixabay-shared-search.js")).href;
    const worker = join(t.root, "crash.mjs");
    await writeFile(worker, `import {searchPixabayShared} from ${JSON.stringify(moduleUrl)}; await searchPixabayShared({repository:${JSON.stringify(t.a)},query:'cats',apiKey:${JSON.stringify(KEY)},now:new Date(${JSON.stringify(when.toISOString())}),authorized:true,clockVerified:true,fetchImpl:async()=>process.exit(73)});\n`);
    const child = spawnSync(process.execPath, [worker], { encoding: "utf8", timeout: 30000 });
    assert.equal(child.status, 73, child.stderr);
    assert.equal(JSON.parse(t.remote()).entries[0].status, "pending");
    let calls = 0;
    await assert.rejects(searchPixabayShared(options(t.b, { query: "dogs", now: new Date(when.getTime() + 4 * PIXABAY_SEARCH_CACHE_MS), fetchImpl: async () => { calls++; return response(); } })), /pending or uncertain/);
    assert.equal(calls, 0); assert.ok(!t.remote().includes(KEY));
  } finally { await t.cleanup(); }
});

test("a rejected completion push keeps the durable pending reservation and prevents blind retry", async () => {
  const t = await setup();
  try {
    const hook = join(t.bare, "hooks", "pre-receive");
    await writeFile(hook, `#!/bin/sh\nwhile read old new ref; do\n  content=$(git show "$new:${PIXABAY_SHARED_CACHE_PATH}" 2>/dev/null) || exit 1\n  printf '%s' "$content" | grep -q '"status": "pending"' || exit 1\ndone\n`);
    await chmod(hook, 0o755);
    let calls = 0;
    await assert.rejects(searchPixabayShared(options(t.a, { fetchImpl: async () => { calls++; return response(); } })), /shared cache update could not be confirmed/);
    assert.equal(calls, 1); assert.equal(JSON.parse(t.remote()).entries[0].status, "pending");
    await assert.rejects(searchPixabayShared(options(t.b, { query: "dogs", fetchImpl: async () => { calls++; return response(); } })), /pending or uncertain/);
    assert.equal(calls, 1);
  } finally { await t.cleanup(); }
});

test("if the remote branch is deleted after fetch, the guarded push does not recreate it or send a request", async () => {
  const t = await setup();
  try {
    let calls = 0;
    await assert.rejects(searchPixabayShared(options(t.a, {
      beforeReservationCommit: async () => { git(["--git-dir", t.bare, "update-ref", "-d", PIXABAY_SHARED_BRANCH]); },
      fetchImpl: async () => { calls++; return response(); }
    })), /reservation could not be confirmed/);
    assert.equal(calls, 0);
    const result = spawnSync("git", ["--git-dir", t.bare, "rev-parse", "--verify", PIXABAY_SHARED_BRANCH], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
  } finally { await t.cleanup(); }
});

test("authorization, clock, branch shape and corrupt state fail closed before any request", async () => {
  const t = await setup();
  try {
    let calls = 0; const fetchImpl = async () => { calls++; return response(); };
    await assert.rejects(searchPixabayShared(options(t.a, { authorized: false, fetchImpl })), /authorization and a verified/);
    await assert.rejects(searchPixabayShared(options(t.a, { clockVerified: false, fetchImpl })), /authorization and a verified/);
    await writeFile(join(t.a, PIXABAY_SHARED_CACHE_PATH), "not-json");
    git(["-C", t.a, "add", "."]); git(["-C", t.a, "commit", "--quiet", "-m", "corrupt synthetic cache"]);
    git(["-C", t.a, "push", "--quiet", "origin", `HEAD:${PIXABAY_SHARED_BRANCH}`]);
    await assert.rejects(searchPixabayShared(options(t.b, { fetchImpl })), /invalid JSON/);
    assert.equal(calls, 0);
  } finally { await t.cleanup(); }
});

test("all checkouts share the same bounded query budget and fail on a backwards clock", async () => {
  const t = await setup();
  try {
    let calls = 0; const fetchImpl = async () => { calls++; return response(); };
    for (let i = 0; i < 5; i++) await searchPixabayShared(options(i % 2 ? t.a : t.b, { query: `animal ${i}`, fetchImpl }));
    await assert.rejects(searchPixabayShared(options(t.a, { query: "another animal", fetchImpl })), /cache is full of recent queries/);
    await assert.rejects(searchPixabayShared(options(t.b, { query: "animal 0", now: new Date(when.getTime() - 1), fetchImpl })), /future/);
    assert.equal(calls, 5); assert.equal(JSON.parse(t.remote()).entries.length, 5);
  } finally { await t.cleanup(); }
});

test("mismatched or multiple origin push destinations and extra branch files are refused", async () => {
  const t = await setup();
  try {
    let calls = 0; const fetchImpl = async () => { calls++; return response(); };
    git(["-C", t.b, "config", "--add", "remote.origin.pushurl", t.bare]);
    git(["-C", t.b, "config", "--add", "remote.origin.pushurl", join(t.root, "unexpected.git")]);
    await assert.rejects(searchPixabayShared(options(t.b, { fetchImpl })), /one matching origin fetch and push URL/);
    await writeFile(join(t.a, "unexpected.txt"), "not cache state");
    git(["-C", t.a, "add", "."]); git(["-C", t.a, "commit", "--quiet", "-m", "unexpected file"]);
    git(["-C", t.a, "push", "--quiet", "origin", `HEAD:${PIXABAY_SHARED_BRANCH}`]);
    await assert.rejects(searchPixabayShared(options(t.a, { fetchImpl })), /must contain only its marker and cache/);
    assert.equal(calls, 0);
  } finally { await t.cleanup(); }
});

test("Git transport and remote hooks do not inherit the Pixabay or other service credentials", async () => {
  const t = await setup();
  const original = { PIXABAY_API_KEY: process.env.PIXABAY_API_KEY, GEMINI_API_KEY: process.env.GEMINI_API_KEY, YOUTUBE_REFRESH_TOKEN: process.env.YOUTUBE_REFRESH_TOKEN };
  try {
    process.env.PIXABAY_API_KEY = KEY; process.env.GEMINI_API_KEY = "synthetic_gemini_secret"; process.env.YOUTUBE_REFRESH_TOKEN = "synthetic_youtube_secret";
    const hook = join(t.bare, "hooks", "pre-receive");
    await writeFile(hook, '#!/bin/sh\n[ -z "$PIXABAY_API_KEY" ] && [ -z "$GEMINI_API_KEY" ] && [ -z "$YOUTUBE_REFRESH_TOKEN" ] || exit 1\n');
    await chmod(hook, 0o755);
    const result = await searchPixabayShared(options(t.a, { fetchImpl: async () => response() }));
    assert.equal(result.providerRequestSent, true); assert.equal(JSON.parse(t.remote()).entries[0].status, "ok");
  } finally {
    for (const [key, value] of Object.entries(original)) value === undefined ? delete process.env[key] : process.env[key] = value;
    await t.cleanup();
  }
});

test("no key echoed in result metadata, cache commits or diagnostics", async () => {
  const t = await setup();
  try {
    const result = await searchPixabayShared(options(t.a, { fetchImpl: async () => response([hit({ tags: `kitten, ${KEY}, cat` })]) }));
    assert.equal(result.leads.length, 0);
    assert.ok(!JSON.stringify(result).includes(KEY)); assert.ok(!t.remote().includes(KEY));
    const log = git(["--git-dir", t.bare, "log", "-p", PIXABAY_SHARED_BRANCH, "--", PIXABAY_SHARED_CACHE_PATH]);
    assert.ok(!log.includes(KEY));
  } finally { await t.cleanup(); }
});

test("shared CLI writes only simulated cache and local unverified lead, with no bootstrap or upload changes", async () => {
  const t = await setup();
  try {
    const root = join(t.root, "state"), state = await openChannelState(root, "Primeplug");
    await writeFile(state.path("published.json"), '{"version":1,"videos":[]}\n');
    await writeFile(state.path("upload-attempts.json"), '{"version":1,"attempts":[]}\n');
    const before = await Promise.all(["published.json", "upload-attempts.json"].map((x) => readFile(state.path(x), "utf8")));
    const mock = join(t.root, "mock-fetch.mjs");
    await writeFile(mock, `globalThis.fetch=async (url,opts)=>{if(new URL(url).origin!=='https://pixabay.com'||opts.redirect!=='error')throw new Error('unexpected network');return new Response(${JSON.stringify(JSON.stringify({ totalHits: 1, hits: [hit()] }))},{status:200,headers:{'content-type':'application/json'}});};\n`);
    const result = spawnSync(process.execPath, ["--import", mock, resolve("scripts/planning-inbox.mjs"), "search-pixabay-shared", "funny cats"], {
      cwd: t.a, env: { ...process.env, STATE_DIR: root, PIXABAY_API_KEY: KEY, PIXABAY_SHARED_SEARCH_AUTHORIZED: "true", PIXABAY_CLOCK_VERIFIED: "true" }, encoding: "utf8", timeout: 30000
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout); assert.equal(output.status, "unverified_leads_only"); assert.equal(output.added, 1); assert.equal(output.productionEligible, false);
    assert.equal(output.leads[0].provider, "Pixabay"); assert.equal(output.leads[0].inboxStatus, "awaiting_review"); assert.equal(output.leads[0].providerAssetId, "42");
    assert.equal((await readPlanningInbox(state)).records.length, 1); assert.equal((await state.getQueue()).jobs.length, 0);
    const after = await Promise.all(["published.json", "upload-attempts.json"].map((x) => readFile(state.path(x), "utf8")));
    assert.deepEqual(after, before); assert.ok(!result.stdout.includes(KEY)); assert.ok(!t.remote().includes(KEY));
  } finally { await t.cleanup(); }
});
