import test from "node:test";
import assert from "node:assert/strict";
import { classifyObservedLicence, parseCcLicence, verifyCandidateRights } from "../src/engine/rights-verification.js";
import { matchApproval } from "../src/engine/approval.js";
import { parseSilencedetect, evaluateAdvancedQc } from "../src/production/advanced-qc.js";
import { collectCommonsCandidates } from "../src/discovery/sources/commons.js";
import { buildProductionReport } from "../src/engine/run-report.js";
import { validateNarratedEntry } from "../src/production/narrated-plan.js";
import { decideOverlayCorrection } from "../src/production/narrated-plan.js";

const meta = (short, extra = {}) => ({ LicenseShortName: { value: short }, UsageTerms: { value: short }, AttributionRequired: { value: "true" }, Artist: { value: "Some Creator" }, ...extra });

test("rights: exact licence version mismatch is unclear, not verified", () => {
  const v = classifyObservedLicence({ claimedType: "CC BY 4.0", claimedStatus: "licensed", observedMeta: meta("CC BY 3.0", { LicenseUrl: { value: "https://creativecommons.org/licenses/by/3.0/" } }) });
  assert.equal(v.status, "permission_unclear");
  assert.match(v.reasons.join(" "), /version mismatch/i);
});

test("rights: licence family mismatch (claim BY, page says BY-SA) is unclear", () => {
  const v = classifyObservedLicence({ claimedType: "CC BY 4.0", claimedStatus: "licensed", observedMeta: meta("CC BY-SA 4.0", { LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" } }) });
  assert.equal(v.status, "permission_unclear");
  assert.match(v.reasons.join(" "), /family mismatch/i);
});

test("rights: changed licence (claim public domain, page now CC BY) is unclear", () => {
  const v = classifyObservedLicence({ claimedType: "Public domain", claimedStatus: "public_domain", observedMeta: meta("CC BY 4.0", { LicenseUrl: { value: "https://creativecommons.org/licenses/by/4.0/" } }) });
  assert.equal(v.status, "permission_unclear");
});

test("rights: generic claim identifies nothing exactly and cannot verify", () => {
  const v = classifyObservedLicence({ claimedType: "", claimedStatus: "licensed", observedMeta: meta("CC BY 4.0", { LicenseUrl: { value: "https://creativecommons.org/licenses/by/4.0/" } }) });
  assert.equal(v.status, "permission_unclear");
});

test("rights: inconsistent attribution metadata is unclear", () => {
  const v = classifyObservedLicence({ claimedType: "CC BY 4.0", claimedStatus: "licensed", observedMeta: meta("CC BY 4.0", { LicenseUrl: { value: "https://creativecommons.org/licenses/by/4.0/" }, AttributionRequired: { value: "false" } }) });
  assert.equal(v.status, "permission_unclear");
  assert.match(v.reasons.join(" "), /[Aa]ttribution/);
});

test("rights: exact match verifies with family, version and attribution recorded", () => {
  const v = classifyObservedLicence({ claimedType: "CC BY-SA 4.0", claimedStatus: "licensed", observedMeta: meta("CC BY-SA 4.0", { LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" } }) });
  assert.equal(v.status, "rights_verified_with_evidence");
  assert.equal(v.licenceFamily, "by-sa");
  assert.equal(v.licenceVersion, "4.0");
  assert.equal(v.shareAlike, true);
  assert.equal(v.attributionRequired, true);
  assert.match(v.reasons.join(" "), /not legal certification/);
  assert.deepEqual(parseCcLicence("https://creativecommons.org/licenses/by-nc-sa/3.0/"), { family: "by-nc-sa", version: "3.0", kind: "cc" });
});

test("rights: inaccessible or missing source page is recorded-not-verified, never invented", async () => {
  const cand = { id: "x", rightsEvidenceUrl: "https://commons.wikimedia.org/wiki/File:Gone.webm", license: { type: "CC BY 4.0", rightsStatus: "licensed" } };
  const down = await verifyCandidateRights(cand, { fetchImpl: async () => { throw new Error("network down"); } });
  assert.equal(down.status, "evidence_recorded_not_independently_verified");
  const missing = await verifyCandidateRights(cand, { fetchImpl: async () => ({ ok: true, json: async () => ({ query: { pages: { "-1": { missing: "" } } } }) }) });
  assert.equal(missing.status, "evidence_recorded_not_independently_verified");
  assert.ok(missing.verificationError);
});

test("approval: per-video approval matches exactly one candidate and hash", () => {
  const awaiting = [
    { candidate: { id: "a" }, result: { sha256: "a".repeat(64) } },
    { candidate: { id: "b" }, result: { sha256: "b".repeat(64) } }
  ];
  assert.equal(matchApproval(awaiting, { approvedCandidateId: "b", approvedSha256: "b".repeat(64) }).job.candidate.id, "b");
  // Another video's hash never authorizes this one.
  assert.equal(matchApproval(awaiting, { approvedCandidateId: "b", approvedSha256: "a".repeat(64) }).job, null);
  // A re-render (new hash) is not authorized by the old approval.
  assert.equal(matchApproval(awaiting, { approvedCandidateId: "b", approvedSha256: "c".repeat(64) }).job, null);
  // No approval authorizes nothing; malformed hash authorizes nothing.
  assert.equal(matchApproval(awaiting, {}).job, null);
  assert.equal(matchApproval(awaiting, { approvedCandidateId: "b", approvedSha256: "xyz" }).job, null);
});

test("qc: silence at end of file is counted and gated", () => {
  const parsed = parseSilencedetect("silence_start: 20.0\n", 25.8);
  assert.equal(parsed.trailingSilenceSeconds, 5.8);
  assert.equal(parsed.silenceSeconds, 5.8);
  const probe = { streams: [{ codec_type: "video", codec_name: "h264", width: 1080, height: 1920 }, { codec_type: "audio", codec_name: "aac" }] };
  const trailing = evaluateAdvancedQc({ probe, volume: { meanDb: -17, maxDb: -1 }, black: { blackSeconds: 0 }, silence: parsed, scenes: { sceneChanges: 3 }, durationSeconds: 25.8, fastStart: { fastStart: true, reason: "ok" } });
  assert.equal(trailing.passed, false);
  assert.ok(trailing.checks.find((c) => c.name === "no_trailing_silence" && !c.passed));
});

test("qc: a render with no audio stream fails", () => {
  const probe = { streams: [{ codec_type: "video", codec_name: "h264", width: 1080, height: 1920 }] };
  const r = evaluateAdvancedQc({ probe, volume: { meanDb: null, maxDb: null }, black: { blackSeconds: 0 }, silence: { silenceSeconds: 0 }, scenes: { sceneChanges: 3 }, durationSeconds: 25, fastStart: { fastStart: true, reason: "ok" } });
  assert.equal(r.passed, false);
  assert.ok(r.checks.find((c) => c.name === "audio_present_aac" && !c.passed));
});

test("discovery: commons collector returns only verified reusable videos", async () => {
  const page = (title, short, url, height = 1080) => ({ title, imageinfo: [{ url: `https://upload.wikimedia.org/${title}`, descriptionurl: `https://commons.wikimedia.org/wiki/${title}`, width: 1920, height, mime: "video/webm", extmetadata: meta(short, { LicenseUrl: { value: `https://creativecommons.org/licenses/${short.replace("CC ", "").replace(" ", "/").toLowerCase()}/` } }) }] });
  const fetchImpl = async () => ({ ok: true, json: async () => ({ query: { pages: {
    "1": page("File:Funny_dog.webm", "CC BY 4.0", "x"),
    "2": page("File:No_reuse.webm", "CC BY-NC 4.0", "y"),
    "3": page("File:Tiny.webm", "CC BY 4.0", "z", 360)
  } } }) });
  const r = await collectCommonsCandidates({ queries: ["dog"], fetchImpl });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].rightsVerification.status, "rights_verified_with_evidence");
  assert.equal(r.items[0].license.type, "CC BY 4.0");
  assert.ok(r.items[0].license.attributionRequirement.includes("Some Creator"));
  assert.equal(r.items[0].needsProductionPlan, true);
  assert.ok(r.rejected.length >= 2);
});

test("reporting: zero production is no_production, never success", () => {
  const empty = buildProductionReport({ generatedAt: "t", runs: [{ channelId: "Primeplug", status: "ok", discovered: 35, researchOnlyRejected: 11, rightsVerified: 3, eligible: 2, rejected: [], duplicates: 24, produced: 0, qcPassed: 0 }] }, { productionEnabled: true });
  assert.equal(empty.productionOutcome, "no_production");
  assert.equal(empty.totals.discovered, 35);
  assert.equal(empty.totals.researchOnlyRejected, 11);
  const made = buildProductionReport({ generatedAt: "t", runs: [{ channelId: "Primeplug", status: "ok", produced: 1, qcPassed: 1, rejected: [] }] }, { productionEnabled: true });
  assert.equal(made.productionOutcome, "produced");
  const off = buildProductionReport({ generatedAt: "t", runs: [{ channelId: "Primeplug", status: "ok", produced: 0, rejected: [] }] }, { productionEnabled: false });
  assert.equal(off.productionOutcome, "production_disabled");
});

test("editorial: incomplete story plans are held", () => {
  const base = { productionMode: "narrated", postingTitle: "A proper title here", hookText: "Watch this", visualSubject: "elephant", narrationScript: "Watch this elephant slip. It falls down." };
  const r = validateNarratedEntry(base);
  assert.equal(r.valid, false);
  assert.ok(r.reasons.some((x) => /storyBeats/.test(x)));
  const noPayoff = { ...base, storyBeats: { hook: "h", development: "d", payoff: "" }, narrationScript: "Watch this elephant slip in the mud today. It slides further and further down the bank. Then it climbs out, shakes off, and trots back to the herd." };
  assert.equal(validateNarratedEntry(noPayoff).valid, false);
});

test("overlay: centre-band overlays are held, never reframed", () => {
  assert.equal(decideOverlayCorrection({ status: "ok", overlays: [{ band: "centre", fraction: 0.2 }] }).action, "hold");
  assert.equal(decideOverlayCorrection({ status: "ok", overlays: [{ band: "top", fraction: 0.2 }] }).action, "reframe");
  assert.equal(decideOverlayCorrection({ status: "check_failed", overlays: [] }).action, "hold");
});
