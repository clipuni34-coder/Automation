import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { normalizeHashtags, appendVisibleHashtags } from "../src/platforms/youtube/hashtags.js";
import { updateExistingPublicVideoHashtags } from "../src/platforms/youtube/hashtag-update.js";
import { uploadYouTubeVideo } from "../src/platforms/youtube/publisher.js";

test("normalizes up to five distinct safe, topical hashtag tokens", () => {
  assert.deepEqual(normalizeHashtags(["#Shorts", "shorts", "##Chiitan", "#FunnyFails", "#very cute", "#<bad>", "#Mascot", "#Japan", "#extra"]), [
    "#Shorts", "#Chiitan", "#FunnyFails", "#Mascot", "#Japan"
  ]);
  assert.deepEqual(normalizeHashtags(["#動物", "#naïve", "#two_words", "#💥", 12, null]), ["#動物", "#naïve", "#two_words"]);
  assert.deepEqual(normalizeHashtags(null), []);
});

test("visible hashtags append to the description without damaging credits and are idempotent", () => {
  const base = "Original narration.\n\nCredit: Original Creator.\nSource: https://example.com/video#fragment\nLicense: CC BY 3.0";
  const tags = ["#Shorts", "#Chiitan", "#FunnyFails"];
  const first = appendVisibleHashtags(base, tags);
  assert.equal(first.description, `${base}\n\n#Shorts #Chiitan #FunnyFails`);
  assert.deepEqual(first.added, tags);
  const second = appendVisibleHashtags(first.description, ["#SHORTS", "#chiitan", "#FunnyFails"]);
  assert.equal(second.description, first.description);
  assert.deepEqual(second.added, []);
  assert.equal(second.reason, "already_present_or_none");
});

test("existing hashtag count limits additions and never rewrites existing text", () => {
  const base = "Description\n#One #Two #Three #Four #Five";
  const result = appendVisibleHashtags(base, ["#New", "#Other"]);
  assert.equal(result.description, base);
  assert.deepEqual(result.added, []);
  assert.equal(result.reason, "existing_hashtag_limit");
  assert.equal(appendVisibleHashtags("#Shorts\nCredits", ["#shorts", "#Animals"]).description, "#Shorts\nCredits\n\n#Animals");
});

test("does not truncate license or credits when the UTF-8 description limit is reached", () => {
  const base = "é".repeat(2497); // 4,994 bytes: not enough for a new hashtag.
  assert.throws(() => appendVisibleHashtags(base, ["#Shorts"]), /refusing to truncate/);
  assert.equal(appendVisibleHashtags(base, []).description, base);
  assert.throws(() => appendVisibleHashtags("é".repeat(2501), []), /5,000 UTF-8 bytes/);
});

test("future upload sends visible hashtags in description as well as independent background tags", async () => {
  const dir = await mkdtemp(join(tmpdir(), "youtube-hashtags-"));
  try {
    const videoPath = join(dir, "short.mp4");
    await writeFile(videoPath, "synthetic");
    let count = 0;
    await uploadYouTubeVideo({
      videoPath, accessToken: "fake",
      metadata: { title: "Test", description: "Credit: original creator", hashtags: ["#Shorts", "#FunnyAnimals"], tags: ["Shorts", "FunnyAnimals"], selfDeclaredMadeForKids: false },
      fetchImpl: async (_url, options) => {
        count++;
        if (count === 1) {
          const request = JSON.parse(options.body);
          assert.equal(request.snippet.description, "Credit: original creator\n\n#Shorts #FunnyAnimals");
          assert.deepEqual(request.snippet.tags, ["Shorts", "FunnyAnimals"]);
          assert.equal(request.status.privacyStatus, "private");
          assert.equal(request.status.selfDeclaredMadeForKids, false);
          return { ok: true, headers: { get: () => "https://www.googleapis.com/upload/youtube/v3/videos/session/mock" } };
        }
        return { ok: true, json: async () => ({ id: "test-video" }) };
      }
    });
    assert.equal(count, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

function fixture() {
  return {
    id: "KBHalqUmHxk", etag: '"version-a"',
    snippet: { channelId: "UCB-Primeplug", title: "Mascot", categoryId: "24", description: "Existing credit and description", tags: ["existing"], defaultLanguage: "en" },
    status: { privacyStatus: "public", selfDeclaredMadeForKids: false, madeForKids: false }
  };
}
const okJson = (value) => ({ ok: true, status: 200, json: async () => structuredClone(value) });

test("existing public video update preserves snippet fields, uses ETag, and never writes status", async () => {
  const initial = fixture();
  let current = structuredClone(initial);
  let updates = 0;
  const fetchImpl = async (urlValue, options = {}) => {
    const url = new URL(urlValue);
    if (options.method !== "PUT") return okJson({ items: [current] });
    updates++;
    assert.equal(url.searchParams.get("part"), "snippet");
    assert.equal(options.headers["if-match"], initial.etag);
    const body = JSON.parse(options.body);
    assert.equal(body.id, initial.id);
    assert.equal(Object.hasOwn(body, "status"), false);
    assert.deepEqual(body.snippet.tags, initial.snippet.tags);
    assert.equal(body.snippet.title, initial.snippet.title);
    assert.equal(body.snippet.categoryId, initial.snippet.categoryId);
    assert.equal(body.snippet.defaultLanguage, "en");
    assert.equal(body.snippet.description, "Existing credit and description\n\n#Shorts #Chiitan");
    current = { ...current, etag: '"version-b"', snippet: { ...current.snippet, ...body.snippet } };
    return okJson({});
  };
  const input = { videoId: initial.id, expectedChannelId: "UCB-Primeplug", hashtags: ["#Shorts", "#Chiitan"], accessToken: "fake", fetchImpl };
  const result = await updateExistingPublicVideoHashtags(input);
  assert.equal(result.status, "updated_verified");
  assert.equal(result.privacyBefore, "public");
  assert.equal(result.privacyAfter, "public");
  assert.deepEqual(result.audienceBefore, { selfDeclaredMadeForKids: false, madeForKids: false });
  assert.deepEqual(result.audienceAfter, result.audienceBefore);
  assert.deepEqual(result.addedHashtags, ["#Shorts", "#Chiitan"]);
  assert.equal(updates, 1);
  const second = await updateExistingPublicVideoHashtags(input);
  assert.equal(second.status, "already_present");
  assert.equal(updates, 1, "a repeated request must not send another update");
});

test("existing update refuses wrong channel, non-public video, or missing ETag before PUT", async () => {
  for (const mutation of [
    (v) => { v.snippet.channelId = "other"; },
    (v) => { v.status.privacyStatus = "private"; },
    (v) => { delete v.etag; }
  ]) {
    const v = fixture(); mutation(v);
    let puts = 0;
    const result = await updateExistingPublicVideoHashtags({
      videoId: v.id, expectedChannelId: "UCB-Primeplug", hashtags: ["#Shorts"], accessToken: "fake",
      fetchImpl: async (_url, options = {}) => { if (options.method === "PUT") puts++; return okJson({ items: [v] }); }
    });
    assert.match(result.status, /^blocked_/);
    assert.equal(puts, 0);
  }
});

test("a concurrent edit or missing update permission fails without retrying", async () => {
  for (const status of [412, 403]) {
    const v = fixture();
    let puts = 0;
    const result = await updateExistingPublicVideoHashtags({
      videoId: v.id, expectedChannelId: "UCB-Primeplug", hashtags: ["#Shorts"], accessToken: "fake",
      fetchImpl: async (_url, options = {}) => {
        if (options.method === "PUT") { puts++; return { ok: false, status }; }
        return okJson({ items: [v] });
      }
    });
    assert.equal(result.status, status === 412 ? "blocked_concurrent_edit" : "update_failed");
    assert.equal(result.httpStatus, status);
    assert.equal(puts, 1);
  }
});

test("network error after PUT reports unknown outcome and is never retried", async () => {
  const v = fixture(); let puts = 0;
  const result = await updateExistingPublicVideoHashtags({
    videoId: v.id, expectedChannelId: "UCB-Primeplug", hashtags: ["#Shorts"], accessToken: "fake",
    fetchImpl: async (_url, options = {}) => {
      if (options.method === "PUT") { puts++; throw new Error("connection closed"); }
      return okJson({ items: [v] });
    }
  });
  assert.equal(result.status, "update_outcome_unknown");
  assert.equal(puts, 1);
});

test("after-update verification does not report success if privacy or other metadata differs", async () => {
  const original = fixture(); let reads = 0;
  const result = await updateExistingPublicVideoHashtags({
    videoId: original.id, expectedChannelId: "UCB-Primeplug", hashtags: ["#Shorts"], accessToken: "fake",
    fetchImpl: async (_url, options = {}) => {
      if (options.method === "PUT") return okJson({});
      reads++;
      if (reads === 1) return okJson({ items: [original] });
      return okJson({ items: [{ ...original, snippet: { ...original.snippet, description: original.snippet.description + "\n\n#Shorts" }, status: { ...original.status, privacyStatus: "private" } }] });
    }
  });
  assert.equal(result.status, "updated_unverified");
});

test("the one-time updater is explicitly authorized and the workflow stays separate from daily production", async () => {
  const out = spawnSync(process.execPath, ["scripts/update-primeplug-hashtags.mjs"], { cwd: process.cwd(), encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /explicit owner confirmation/);
  const workflow = await readFile(resolve(".github/workflows/e2e-smoke.yml"), "utf8");
  assert.match(workflow, /update_primeplug_hashtags/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /node scripts\/update-primeplug-hashtags\.mjs/);
  assert.doesNotMatch(workflow, /YOUTUBE_PUBLISH_PRIVACY:\s*public/);
});
