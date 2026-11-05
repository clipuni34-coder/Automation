import test from "node:test";
import assert from "node:assert/strict";
import { classifyObservedLicence, verifyCandidateRights } from "../src/engine/rights-verification.js";
import { parseVolumedetect, parseBlackdetect, parseSilencedetect, parseSceneChanges, evaluateAdvancedQc } from "../src/production/advanced-qc.js";
import { screenCandidate } from "../src/engine/scheduler.js";

const meta = (short, extra = {}) => ({ LicenseShortName: { value: short }, UsageTerms: { value: short }, ...extra });

test("rights classification: verified / unclear / prohibited are distinct", () => {
  assert.equal(classifyObservedLicence({ claimedType: "public_domain", claimedStatus: "public_domain", observedMeta: meta("Public domain") }).status, "rights_verified_with_evidence");
  const cc = classifyObservedLicence({ claimedType: "CC BY 3.0", claimedStatus: "licensed", observedMeta: meta("CC BY 3.0", { LicenseUrl: { value: "https://creativecommons.org/licenses/by/3.0" } }) });
  assert.equal(cc.status, "rights_verified_with_evidence"); assert.equal(cc.commercialUse, true); assert.equal(cc.derivativesAllowed, true);
  assert.equal(classifyObservedLicence({ claimedType: "CC BY 3.0", claimedStatus: "licensed", observedMeta: meta("CC BY-NC 4.0") }).status, "reuse_prohibited");
  assert.equal(classifyObservedLicence({ claimedType: "public_domain", claimedStatus: "public_domain", observedMeta: meta("CC BY 4.0") }).status, "permission_unclear");
  assert.equal(classifyObservedLicence({ claimedType: "public_domain", claimedStatus: "public_domain", observedMeta: null }).status, "evidence_recorded_not_independently_verified");
});

test("rights verifier reads the Commons API and never invents a licence on failure", async () => {
  const okFetch = async () => ({ ok: true, json: async () => ({ query: { pages: { "1": { imageinfo: [{ extmetadata: meta("CC BY 3.0", { LicenseUrl: { value: "https://creativecommons.org/licenses/by/3.0" } }) }] } } } }) });
  const v = await verifyCandidateRights({ id: "x", rightsEvidenceUrl: "https://commons.wikimedia.org/wiki/File:Test.webm", license: { type: "CC BY 3.0", rightsStatus: "licensed" } }, { fetchImpl: okFetch });
  assert.equal(v.status, "rights_verified_with_evidence");
  const down = await verifyCandidateRights({ id: "x", rightsEvidenceUrl: "https://commons.wikimedia.org/wiki/File:Test.webm", license: { type: "CC BY 3.0", rightsStatus: "licensed" } }, { fetchImpl: async () => { throw new Error("network down"); } });
  assert.equal(down.status, "evidence_recorded_not_independently_verified");
  assert.ok(down.verificationError);
});

test("rights gate blocks prohibited/unclear and NC-ND terms at scheduling", () => {
  const base = { sourceUrl: "https://upload.wikimedia.org/x.webm", creator: "c", rightsEvidenceUrl: "https://commons.wikimedia.org/wiki/File:X.webm", license: { type: "CC BY 3.0", rightsStatus: "licensed" } };
  assert.equal(screenCandidate(base).eligible, true);
  assert.equal(screenCandidate({ ...base, rightsVerification: { status: "reuse_prohibited" } }).eligible, false);
  assert.equal(screenCandidate({ ...base, rightsVerification: { status: "permission_unclear" } }).eligible, false);
  assert.equal(screenCandidate({ ...base, license: { type: "CC BY-NC 4.0", rightsStatus: "licensed", usageTerms: "NonCommercial" } }).eligible, false);
});

test("advanced QC parsers and thresholds are numeric and strict", () => {
  assert.deepEqual(parseVolumedetect("[x] mean_volume: -18.1 dB\n[y] max_volume: -0.7 dB"), { meanDb: -18.1, maxDb: -0.7 });
  assert.equal(parseBlackdetect("[blackdetect] black_start:1 black_end:2.5 black_start:4 black_end:4.5").blackSeconds, 2);
  assert.equal(parseSilencedetect("silence_start: 1.0\nsilence_end: 2.0").silenceSeconds, 1);
  assert.equal(parseSceneChanges("pts_time:1.2 pts_time:3.4").sceneChanges, 2);
  const probe = { streams: [{ codec_type: "video", codec_name: "h264", width: 1080, height: 1920 }, { codec_type: "audio", codec_name: "aac" }] };
  const good = evaluateAdvancedQc({ probe, volume: { meanDb: -18, maxDb: -1 }, black: { blackSeconds: 0 }, silence: { silenceSeconds: 2 }, scenes: { sceneChanges: 4 }, durationSeconds: 25, fastStart: { fastStart: true, reason: "ok" } });
  assert.equal(good.passed, true);
  const bad = evaluateAdvancedQc({ probe, volume: { meanDb: -30, maxDb: -1 }, black: { blackSeconds: 0 }, silence: { silenceSeconds: 2 }, scenes: { sceneChanges: 4 }, durationSeconds: 25, fastStart: { fastStart: true, reason: "ok" } });
  assert.equal(bad.passed, false);
  assert.ok(bad.checks.find((c) => c.name === "narration_audible" && !c.passed));
});

test("stress: invalid, unavailable and duplicate candidates are handled truthfully", async () => {
  const { runChannelCycle } = await import("../src/engine/scheduler.js");
  const { openChannelState } = await import("../src/engine/state.js");
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "pp-stress-"));
  const state = await openChannelState(root, "Primeplug");
  const channel = { id: "Primeplug", niche: "funny-moments", operation: { enabled: true, paused: false, maxCandidatesPerDay: 6 } };
  const good = { id: "g", title: "t", sourceUrl: "https://upload.wikimedia.org/good.webm", creator: "c", rightsEvidenceUrl: "https://commons.wikimedia.org/wiki/File:G.webm", license: { rightsStatus: "licensed" } };
  const invalid = { id: "bad", title: "t", sourceUrl: "http://insecure.example/x.mp4", creator: "c", license: { rightsStatus: "licensed" } };
  let attempts = 0;
  const run = await runChannelCycle({ channel, niche: { id: "funny-moments" }, state, candidateProvider: async () => [good, invalid, good], produceJob: async () => { attempts += 1; if (attempts < 3) throw new Error("simulated network interruption"); return { produced: true }; } });
  assert.equal(run.rejected.length, 1); // invalid URL/rights screened out
  // failed -> queued -> retry across cycles, succeeds on third attempt
  const r2 = await runChannelCycle({ channel, niche: { id: "funny-moments" }, state, candidateProvider: async () => [], produceJob: async () => { attempts += 1; if (attempts < 3) throw new Error("still down"); return { produced: true }; } });
  const r3 = await runChannelCycle({ channel, niche: { id: "funny-moments" }, state, candidateProvider: async () => [], produceJob: async () => { attempts += 1; return { produced: true }; } });
  const q = await state.getQueue();
  assert.ok(q.jobs.filter((j) => j.status === "completed").length >= 1, JSON.stringify({ run, r2, r3, attempts }));
  // duplicate candidate in the same provider batch is deduped by source state
  const run4 = await runChannelCycle({ channel, niche: { id: "funny-moments" }, state, candidateProvider: async () => [good], produceJob: async () => ({ produced: true }) });
  assert.ok(run4.duplicates >= 1);
});
