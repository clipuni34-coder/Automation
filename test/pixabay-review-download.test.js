import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pixabayLeadFromVideo } from "../src/discovery/sources/pixabay-planning.js";
import { downloadPixabayForReview } from "../src/engine/pixabay-review-download.js";
import { openChannelState } from "../src/engine/state.js";
import { ingestPixabayLeads, readPlanningInbox } from "../src/engine/planning-inbox.js";

const now = new Date("2026-11-01T12:00:00Z");
const page = "https://pixabay.com/videos/kitten-playing-42/";
const source = "https://cdn.pixabay.com/video/2023/05/05/42-123_large.mp4";
const terms = "https://pixabay.com/service/terms/", summary = "https://pixabay.com/service/license-summary/";
const bytes = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(2036, 1)]);
function lead() { return pixabayLeadFromVideo({ id: 42, sourceUrl: page, mediaType: "film", durationSeconds: 20, tags: "kitten, playing, cat", attribution: { creator: "ExampleCreator" }, file: { url: source, width: 1920, height: 1080, size: bytes.length } }, { now }); }
function fixtures() {
  const ld = { "@type": "VideoObject", acquireLicensePage: "/videos/kitten-playing-42/", contentUrl: source, license: summary, creator: { name: "ExampleCreator" }, datePublished: "2023-05-05T15:31:19.285Z", uploadDate: "2023-05-05T15:31:19.285Z", width: "1920", height: "1080" };
  return {
    [page]: `<link rel="canonical" href="${page}"><div>Free for use under the Pixabay <a href="/service/license-summary/">Content License</a></div><div><span>Published date</span><span>May 5, 2023</span></div><script type="application/ld+json">${JSON.stringify(ld)}</script>`,
    [terms]: `<h1>Pixabay Terms of Service</h1><p>Last updated: 20 October, 2026</p><ol>${["section-4-cc0-license", "section-5-content-license", "section-6-attribution"].map((id) => `<li><h4 id="${id}">Synthetic section</h4><p>${"synthetic policy ".repeat(6)}</p></li>`).join("")}</ol>`,
    [summary]: "<h1>Content License Summary</h1><h4>What are you allowed to do with Content?</h4><h4>What are you not allowed to do with Content?</h4>"
  };
}
const opts = (extra = {}) => ({ authorized: true, termsReviewed: true, clockVerified: true, now, ...extra });
function fakeFetch(pages, seen = [], media = () => new Response(bytes, { status: 200, headers: { "content-type": "video/mp4", "content-length": String(bytes.length) } })) {
  return async (url, options) => {
    seen.push(String(url)); assert.equal(options.redirect, "manual"); assert.equal(options.method, "GET");
    if (url === source) return media();
    assert.ok(Object.hasOwn(pages, url), "unexpected network host");
    return new Response(pages[url], { status: 200, headers: { "content-type": "text/html" } });
  };
}

test("one authorized mocked review download binds exact page, exact requested rendition and SHA without approval", async () => {
  const root = await mkdtemp(join(tmpdir(), "pixabay-review-"));
  try {
    const output = join(root, "source.mp4"), seen = [];
    const result = await downloadPixabayForReview(lead(), output, opts({ fetchImpl: fakeFetch(fixtures(), seen) }));
    assert.equal(result.status, "downloaded_for_inspection_only");
    assert.equal(result.itemPageUrl, page); assert.equal(result.renditionUrl, source);
    assert.equal(result.sourceSha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(result.sourceProvenance, "direct_https_exact_rendition_no_redirect");
    assert.deepEqual(await readFile(output), bytes);
    assert.equal(result.rightsStatus, "evidence_recorded_not_independently_verified");
    assert.equal(result.productionEligible, false); assert.equal(result.uploadApproved, false);
    assert.equal(seen.filter((url) => url === source).length, 1);
    assert.deepEqual((await readdir(root)).sort(), ["source.mp4"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("authorization, terms and clock must all be explicitly acknowledged before any request", async () => {
  const root = await mkdtemp(join(tmpdir(), "pixabay-review-"));
  try {
    let calls = 0;
    for (const value of [{ authorized: false }, { termsReviewed: false }, { clockVerified: false }]) {
      await assert.rejects(downloadPixabayForReview(lead(), join(root, "source.mp4"), opts({ ...value, fetchImpl: async () => { calls++; } })), /authorized single review download/);
    }
    assert.equal(calls, 0); assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("403 or a mismatched item-page rendition holds before any media request", async () => {
  const root = await mkdtemp(join(tmpdir(), "pixabay-review-"));
  try {
    let calls = 0;
    const blocked = await downloadPixabayForReview(lead(), join(root, "first.mp4"), opts({ fetchImpl: async () => { calls++; return new Response(null, { status: 403 }); } }));
    assert.equal(blocked.status, "held"); assert.equal(calls, 1); assert.equal(blocked.evidence.pageRequests[0].httpStatus, 403);
    const p = fixtures(); p[page] = p[page].replace(source, source.replace("large", "medium"));
    const seen = [], mismatch = await downloadPixabayForReview(lead(), join(root, "second.mp4"), opts({ fetchImpl: fakeFetch(p, seen) }));
    assert.equal(mismatch.status, "held"); assert.ok(mismatch.evidence.blockers.includes("exact_rendition_not_observed_in_item_metadata"));
    assert.ok(!seen.includes(source)); assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("redirects, unsafe media types, wrong lengths and invalid MP4 headers save no file or partial", async () => {
  const root = await mkdtemp(join(tmpdir(), "pixabay-review-"));
  try {
    const cases = [
      () => new Response(null, { status: 302, headers: { location: "https://evil.example/file.mp4" } }),
      () => new Response(bytes, { status: 200, headers: { "content-type": "text/html" } }),
      () => new Response(bytes, { status: 200, headers: { "content-type": "video/mp4", "content-length": "999999999" } }),
      () => new Response(bytes.subarray(0, bytes.length - 1), { status: 200, headers: { "content-type": "video/mp4" } }),
      () => new Response(Buffer.alloc(bytes.length, 1), { status: 200, headers: { "content-type": "video/mp4" } }),
      () => new Response(Buffer.concat([bytes, Buffer.from([1])]), { status: 200, headers: { "content-type": "video/mp4" } }),
      () => new Response(bytes, { status: 200, headers: { "content-type": "video/mp4", "content-encoding": "gzip" } })
    ];
    for (const [i, media] of cases.entries()) {
      const output = join(root, `bad-${i}.mp4`), seen = [];
      const result = await downloadPixabayForReview(lead(), output, opts({ fetchImpl: fakeFetch(fixtures(), seen, media) }));
      assert.equal(result.status, "held", `case ${i}`); assert.equal(result.productionEligible, false);
      assert.equal(seen.filter((url) => url === source).length, 1);
    }
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("existing destination and a concurrent destination creation never overwrite files", async () => {
  const root = await mkdtemp(join(tmpdir(), "pixabay-review-"));
  try {
    const existing = join(root, "existing.mp4"); await writeFile(existing, "keep me");
    let calls = 0;
    await assert.rejects(downloadPixabayForReview(lead(), existing, opts({ fetchImpl: async () => { calls++; } })), /already exists/);
    assert.equal(calls, 0);
    const raced = join(root, "race.mp4");
    const media = async () => { await writeFile(raced, "concurrent writer"); return new Response(bytes, { status: 200, headers: { "content-type": "video/mp4" } }); };
    const result = await downloadPixabayForReview(lead(), raced, opts({ fetchImpl: fakeFetch(fixtures(), [], media) }));
    assert.equal(result.status, "held"); assert.equal(await readFile(raced, "utf8"), "concurrent writer");
    assert.deepEqual((await readdir(root)).sort(), ["existing.mp4", "race.mp4"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a backwards clock during download holds and removes the partial file", async () => {
  const root = await mkdtemp(join(tmpdir(), "pixabay-review-"));
  try {
    let i = 0;
    const result = await downloadPixabayForReview(lead(), join(root, "source.mp4"), opts({ fetchImpl: fakeFetch(fixtures()), now: () => new Date(now.getTime() - (i++ >= 2 ? 1000 : 0)) }));
    assert.equal(result.status, "held"); assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("review-download CLI leaves the inbox, queue and upload ledgers unchanged with mocked pages and media", async () => {
  const root = await mkdtemp(join(tmpdir(), "pixabay-review-cli-"));
  try {
    const state = await openChannelState(root, "Primeplug"); await ingestPixabayLeads(state, [lead()], { now });
    const record = (await readPlanningInbox(state)).records[0];
    await writeFile(state.path("published.json"), '{"version":1,"videos":[]}\n');
    await writeFile(state.path("upload-attempts.json"), '{"version":1,"attempts":[]}\n');
    const before = await Promise.all(["planning-inbox.json", "published.json", "upload-attempts.json"].map((x) => readFile(state.path(x), "utf8")));
    const mock = join(root, "mock-fetch.mjs"), output = join(root, "source.mp4"), p = fixtures();
    await writeFile(mock, `const p=${JSON.stringify(p)};const source=${JSON.stringify(source)};const data=Buffer.from(${JSON.stringify(bytes.toString("base64"))},'base64');globalThis.fetch=async(url,opts)=>{if(opts.redirect!=='manual')throw new Error('unsafe redirect');if(String(url)===source)return new Response(data,{status:200,headers:{'content-type':'video/mp4','content-length':String(data.length)}});if(!(String(url) in p))throw new Error('unexpected network');return new Response(p[String(url)],{status:200,headers:{'content-type':'text/html'}});};\n`);
    const child = spawnSync(process.execPath, ["--import", mock, resolve("scripts/planning-inbox.mjs"), "download-pixabay-review", record.key, output], {
      cwd: resolve("."), env: { ...process.env, STATE_DIR: root, PIXABAY_REVIEW_DOWNLOAD_AUTHORIZED: "true", PIXABAY_TERMS_REVIEWED: "true", PIXABAY_CLOCK_VERIFIED: "true" }, encoding: "utf8", timeout: 30000
    });
    assert.equal(child.status, 0, child.stderr); const result = JSON.parse(child.stdout);
    assert.equal(result.status, "downloaded_for_inspection_only"); assert.equal(result.productionEligible, false); assert.equal(result.uploadApproved, false);
    assert.deepEqual(await readFile(output), bytes); assert.equal((await readPlanningInbox(state)).records.length, 1); assert.equal((await state.getQueue()).jobs.length, 0);
    const after = await Promise.all(["planning-inbox.json", "published.json", "upload-attempts.json"].map((x) => readFile(state.path(x), "utf8")));
    assert.deepEqual(after, before);
  } finally { await rm(root, { recursive: true, force: true }); }
});
