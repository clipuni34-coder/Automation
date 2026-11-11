import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openChannelState } from "../src/engine/state.js";
import { ingestPixabayLeads, readPlanningInbox } from "../src/engine/planning-inbox.js";
import { pixabayLeadFromVideo } from "../src/discovery/sources/pixabay-planning.js";
import { observeLocalSourceFile, observePixabayLead } from "../src/engine/pixabay-observations.js";

const when = new Date("2026-11-01T12:00:00Z");
const page = "https://pixabay.com/videos/kitten-playing-42/";
const source = "https://cdn.pixabay.com/video/2023/05/05/42-123_large.mp4";
const termsUrl = "https://pixabay.com/service/terms/";
const summaryUrl = "https://pixabay.com/service/license-summary/";
function lead(overrides = {}) {
  const a = { id: 42, sourceUrl: page, mediaType: "film", durationSeconds: 20,
    tags: "kitten, playing, cat", attribution: { creator: "ExampleCreator" },
    file: { url: source, width: 1920, height: 1080, size: 12345 }, ...overrides };
  return pixabayLeadFromVideo(a, { now: when });
}
function pages({ video = {}, visibleDate = "May 5, 2023", label = true, canonical = page } = {}) {
  const ld = { "@type": "VideoObject", acquireLicensePage: "/videos/kitten-playing-42/", contentUrl: source,
    license: summaryUrl, creator: { name: "ExampleCreator" }, datePublished: "2023-05-05T15:31:19.285Z",
    uploadDate: "2023-05-05T15:31:19.285Z", width: "1920", height: "1080", ...video };
  return {
    item: `<!doctype html><html><head><link rel="canonical" href="${canonical}"></head><body>
      ${label ? '<div>Free for use under the Pixabay <a href="/service/license-summary/">Content License</a></div>' : ''}
      <div><span>Published date</span><span>${visibleDate}</span></div>
      <script type="application/ld+json">${JSON.stringify(ld)}</script></body></html>`,
    terms: `<!doctype html><h1>Pixabay Terms of Service</h1><p>Last updated: 20 October, 2026</p><ol>
      <li><h4 id="section-4-cc0-license">4. CC0</h4><p>${"synthetic policy text ".repeat(5)}</p></li>
      <li><h4 id="section-5-content-license">5. Content</h4><p>${"synthetic policy text ".repeat(5)}</p></li>
      <li><h4 id="section-6-attribution">6. Attribution</h4><p>${"synthetic policy text ".repeat(5)}</p></li></ol>`,
    summary: '<h1>Content License Summary</h1><h4>What are you allowed to do with Content?</h4><h4>What are you not allowed to do with Content?</h4>'
  };
}
function fakeFetch(p, seen = []) {
  return async (url, options) => {
    seen.push([String(url), options]);
    assert.equal(options.method, "GET"); assert.equal(options.redirect, "manual");
    const body = url === page ? p.item : url === termsUrl ? p.terms : url === summaryUrl ? p.summary : null;
    assert.notEqual(body, null, "no unrelated host or media URL may be contacted");
    return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  };
}
const observe = (p, options = {}) => observePixabayLead(lead(), { now: when, fetchImpl: fakeFetch(p), ...options });

test("matching synthetic item, exact rendition, creator and policy markers are observations, never rights or production approval", async () => {
  const seen = [], result = await observePixabayLead(lead(), { now: when, fetchImpl: fakeFetch(pages(), seen) });
  assert.deepEqual(seen.map((x) => x[0]).sort(), [page, termsUrl, summaryUrl].sort());
  assert.equal(result.observationStatus, "consistent_metadata_manual_review_required");
  assert.equal(result.observed.canonicalMatches, true); assert.equal(result.observed.itemLinkMatches, true);
  assert.equal(result.observed.renditionMatches, true); assert.equal(result.observed.creatorMatches, true);
  assert.equal(result.observed.dimensionsMatch, true); assert.equal(result.observed.contentLicenseLabelMatches, true);
  assert.equal(result.observed.dateUnambiguousPost2019, true); assert.equal(result.observed.termsStructurePresent, true);
  assert.equal(result.observed.summaryStructurePresent, true);
  assert.equal(result.rightsStatus, "evidence_recorded_not_independently_verified");
  assert.equal(result.productionEligible, false); assert.equal(result.uploadApproved, false);
  assert.ok(result.blockers.includes("human_rights_attribution_and_third_party_review_required"));
  assert.ok(result.blockers.includes("pixabay_production_path_not_enabled"));
  assert.equal(result.clockSource, "runner_local_clock_unverified");
});

test("403 and redirects fail closed, contact no alternate host, and do not request other pages", async () => {
  for (const [status, reason] of [[403, "unavailable_or_unexpected_response"], [302, "redirect_refused"]]) {
    let calls = 0;
    const result = await observePixabayLead(lead(), { now: when, fetchImpl: async () => {
      calls++; return new Response(null, { status, headers: { location: "https://evil.example/" } });
    } });
    assert.equal(calls, 1); assert.equal(result.pageRequests[0].reason, reason);
    assert.equal(result.pageRequests[0].httpStatus, status); assert.equal(result.observed, null);
    assert.equal(result.observationStatus, "needs_investigation"); assert.equal(result.productionEligible, false);
    assert.ok(result.blockers.includes("direct_item_page_unavailable"));
  }
});

test("missing policy, HTML challenges, read failures and oversize pages are held without echoing provider errors", async () => {
  const p = pages();
  const cases = [
    { fetchImpl: async (url, options) => url === termsUrl ? new Response(null, { status: 403 }) : fakeFetch(p)(url, options), expected: "direct_terms_page_unavailable" },
    { fetchImpl: async () => new Response("challenge", { status: 200, headers: { "content-type": "text/plain" } }), expected: "direct_item_page_unavailable" },
    { fetchImpl: async () => new Response(new Uint8Array(1500 * 1024 + 1), { status: 200, headers: { "content-type": "text/html" } }), expected: "direct_item_page_unavailable" },
    { fetchImpl: async () => { throw new Error("private value must not be logged"); }, expected: "direct_item_page_unavailable" }
  ];
  for (const c of cases) {
    const result = await observePixabayLead(lead(), { now: when, fetchImpl: c.fetchImpl });
    assert.equal(result.observationStatus, "needs_investigation"); assert.ok(result.blockers.includes(c.expected));
    assert.equal(result.productionEligible, false); assert.ok(!JSON.stringify(result).includes("private value"));
  }
});

test("wrong page, rendition, creator, dimensions, licence or duplicate item objects are explicit holds", async () => {
  const variants = [
    [pages({ canonical: "https://pixabay.com/videos/other-42/" }), "item_identity_not_unambiguously_observed"],
    [pages({ video: { acquireLicensePage: "/videos/other-42/" } }), "item_identity_not_unambiguously_observed"],
    [pages({ video: { contentUrl: "https://cdn.pixabay.com/video/2023/05/05/42-123_medium.mp4" } }), "exact_rendition_not_observed_in_item_metadata"],
    [pages({ video: { creator: { name: "Different creator" } } }), "creator_missing_or_changed"],
    [pages({ video: { height: "720" } }), "rendition_dimensions_missing_or_changed"],
    [pages({ video: { license: "https://example.com/license" } }), "content_license_label_missing_or_inconsistent"],
    [pages({ label: false }), "content_license_label_missing_or_inconsistent"]
  ];
  const duplicate = pages();
  duplicate.item += `<script type="application/ld+json">${JSON.stringify({ "@type": "VideoObject", contentUrl: source })}</script>`;
  variants.push([duplicate, "item_identity_not_unambiguously_observed"]);
  const decoy = pages({ label: false });
  decoy.item += '<!-- <div>Free for use under the Pixabay <a href="/service/license-summary/">Content License</a></div> -->';
  decoy.item += '<div hidden>Free for use under the Pixabay <a href="/service/license-summary/">Content License</a></div>';
  variants.push([decoy, "content_license_label_missing_or_inconsistent"]);
  for (const [input, expected] of variants) {
    const result = await observe(input);
    assert.equal(result.observationStatus, "needs_investigation", expected);
    assert.ok(result.blockers.includes(expected), expected);
    assert.equal(result.productionEligible, false);
  }
});

test("pre-2019 and missing or conflicting publication dates are not inferred from a generic Content License label", async () => {
  const old = pages({ visibleDate: "May 11, 2016", video: { datePublished: "2016-05-11T13:44:12.390Z", uploadDate: "2016-05-11T13:44:12.390Z" } });
  for (const p of [old, pages({ visibleDate: "not available" }), pages({ visibleDate: "January 8, 2019", video: { datePublished: "2019-01-09T01:00:00.000Z", uploadDate: "2019-01-09T01:00:00.000Z" } }), pages({ visibleDate: "January 9, 2019", video: { datePublished: "2019-01-09T01:00:00.000Z", uploadDate: "2019-01-09T01:00:00.000Z" } }), pages({ video: { uploadDate: "2023-05-07T00:00:00.000Z" } }), pages({ visibleDate: "March 2, 2023", video: { datePublished: "2023-02-30T00:00:00.000Z", uploadDate: "2023-02-30T00:00:00.000Z" } })]) {
    const result = await observe(p);
    assert.equal(result.observed.dateUnambiguousPost2019, false);
    assert.ok(result.blockers.includes("published_date_or_pre2019_licence_requires_manual_resolution"));
    assert.equal(result.productionEligible, false);
  }
});

test("policy structure changes and a missing parser fail closed", async () => {
  const bad = pages(); bad.terms = bad.terms.replace('id="section-5-content-license"', 'id="changed"');
  const changed = await observe(bad);
  assert.ok(changed.blockers.includes("provider_policy_structure_unavailable_or_changed"));
  assert.equal(changed.observed.termsStructurePresent, false);
  const missing = await observe(pages(), { pythonPath: "/definitely/not/python" });
  assert.equal(missing.observed, null); assert.ok(missing.blockers.includes("page_observation_parser_unavailable_or_failed"));
  assert.equal(missing.productionEligible, false);
});

test("a local file hash is source-bound only as an unverified operator claim, and symlinks are refused", async () => {
  const root = await mkdtemp(join(tmpdir(), "pixabay-observe-file-"));
  try {
    const path = join(root, "reviewed.mp4"), link = join(root, "link.mp4"), bytes = Buffer.from("synthetic media bytes, not Pixabay footage");
    await writeFile(path, bytes); await symlink(path, link);
    const result = await observe(pages(), { sourceFile: path });
    assert.equal(result.renditionUrl, source);
    assert.equal(result.sourceFile.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(result.sourceFile.provenance, "operator_supplied_file_not_independently_bound_to_url");
    assert.ok(result.blockers.includes("file_origin_and_complete_footage_not_independently_reviewed"));
    assert.equal(result.productionEligible, false);
    await assert.rejects(observeLocalSourceFile(link));
    const fifo = join(root, "pipe.mp4");
    if (spawnSync("mkfifo", [fifo]).status === 0) await assert.rejects(observeLocalSourceFile(fifo), /not regular/);
    const symlinkResult = await observe(pages(), { sourceFile: link });
    assert.equal(symlinkResult.sourceFile, null);
    assert.ok(symlinkResult.blockers.includes("local_source_file_could_not_be_safely_hashed"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("invalid lead or backward clock cannot become an actionable result", async () => {
  let calls = 0;
  const invalid = { ...lead(), sourceUrl: "https://evil.example/42.mp4" };
  await assert.rejects(observePixabayLead(invalid, { now: when, fetchImpl: async () => { calls++; } }), /valid, unverified/);
  assert.equal(calls, 0);
  let i = 0;
  const backwards = await observe(pages(), { now: () => new Date(when.getTime() - (i++ ? 1000 : 0)) });
  assert.equal(backwards.finishedAt, null);
  assert.ok(backwards.blockers.includes("observer_clock_invalid_or_moved_backwards"));
  assert.equal(backwards.productionEligible, false);
});

test("diagnostic CLI neither materializes reviewed cats nor changes inbox, queue or upload ledgers", async () => {
  const root = await mkdtemp(join(tmpdir(), "pixabay-observe-cli-"));
  try {
    const state = await openChannelState(root, "Primeplug");
    await ingestPixabayLeads(state, [lead()], { now: when });
    const record = (await readPlanningInbox(state)).records[0];
    await writeFile(state.path("published.json"), '{"version":1,"videos":[]}\n');
    await writeFile(state.path("upload-attempts.json"), '{"version":1,"attempts":[]}\n');
    const before = await Promise.all(["planning-inbox.json", "published.json", "upload-attempts.json"].map((x) => readFile(state.path(x), "utf8")));
    const p = pages(), mock = join(root, "mock-fetch.mjs"), local = join(root, "source.mp4");
    await writeFile(local, "synthetic source file");
    await writeFile(mock, `const pages=${JSON.stringify({ [page]: p.item, [termsUrl]: p.terms, [summaryUrl]: p.summary })}; globalThis.fetch=async (url,options) => { if(options.redirect!=='manual'||!(String(url) in pages)) throw new Error('unexpected network'); return new Response(pages[String(url)],{status:200,headers:{'content-type':'text/html'}}); };\n`);
    const result = spawnSync(process.execPath, ["--import", mock, resolve("scripts/planning-inbox.mjs"), "inspect-pixabay", record.key, local], {
      cwd: resolve("."), env: { ...process.env, STATE_DIR: root, PIXABAY_API_KEY: "not_used_mock_key" }, encoding: "utf8", timeout: 30000
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.productionEligible, false); assert.equal(report.rightsStatus, "evidence_recorded_not_independently_verified");
    assert.equal(report.sourceFile.sha256, createHash("sha256").update("synthetic source file").digest("hex"));
    assert.ok(!result.stdout.includes("not_used_mock_key"));
    assert.equal((await readPlanningInbox(state)).records.length, 1);
    assert.equal((await state.getQueue()).jobs.length, 0);
    const after = await Promise.all(["planning-inbox.json", "published.json", "upload-attempts.json"].map((x) => readFile(state.path(x), "utf8")));
    assert.deepEqual(after, before);
  } finally { await rm(root, { recursive: true, force: true }); }
});
