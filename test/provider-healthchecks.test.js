import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const expected = `UC${"a".repeat(22)}`;
const other = `UC${"b".repeat(22)}`;
const secrets = { YOUTUBE_CLIENT_ID: "synthetic_client", YOUTUBE_CLIENT_SECRET: "synthetic_client_secret", YOUTUBE_REFRESH_TOKEN: "synthetic_refresh_token", GEMINI_API_KEY: "synthetic_gemini_key" };
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "provider-health-"));
  return { root, mock: join(root, "fetch.mjs"), marker: join(root, "called.txt"), cleanup: () => rm(root, { recursive: true, force: true }) };
}
function run(t, script, extra = {}) {
  return spawnSync(process.execPath, ["--import", t.mock, resolve(script)], {
    cwd: resolve("."), env: { ...process.env, ...secrets, YOUTUBE_EXPECTED_CHANNEL_ID: expected, TMPDIR: t.root, PRIMEPLUG_VOICE_CHECK_AUTHORIZED: "true", ...extra }, encoding: "utf8", timeout: 30000
  });
}
function assertNoSecrets(result) {
  for (const secret of Object.values(secrets)) assert.ok(!result.stdout.includes(secret) && !result.stderr.includes(secret), `credential leaked: ${secret}`);
  assert.ok(!result.stdout.includes("synthetic_access_token") && !result.stderr.includes("synthetic_access_token"));
}
function oauthMock(t, channel = expected) {
  return `import {writeFileSync} from 'node:fs'; globalThis.fetch=async(value,options)=>{writeFileSync(${JSON.stringify(t.marker)},'called');const u=new URL(value);if(options.redirect!=='error')throw new Error('redirect not refused');if(u.origin==='https://oauth2.googleapis.com'){const f=new URLSearchParams(options.body);if(f.get('refresh_token')!=='synthetic_refresh_token')throw new Error('wrong request');return new Response(JSON.stringify({access_token:'synthetic_access_token',expires_in:3600}),{status:200});}if(u.origin==='https://www.googleapis.com'&&u.pathname==='/youtube/v3/channels'){if(options.headers.authorization!=='Bearer synthetic_access_token')throw new Error('wrong bearer');return new Response(JSON.stringify({items:[{id:${JSON.stringify(channel)},snippet:{title:'Synthetic channel'}}]}),{status:200});}throw new Error('unexpected request');};\n`;
}
function voiceMock(t, durationSamples = 48000, silent = false) {
  return `import {writeFileSync} from 'node:fs'; globalThis.fetch=async(value,options)=>{writeFileSync(${JSON.stringify(t.marker)},'called');if(String(value)!=='https://generativelanguage.googleapis.com/v1beta/interactions'||options.redirect!=='error'||options.headers['x-goog-api-key']!=='synthetic_gemini_key')throw new Error('unexpected request');const body=JSON.parse(options.body);if(!body.input[0].content[0].text.includes('diagnostic voice check'))throw new Error('unexpected text');const dataBytes=${durationSamples}*2;const b=Buffer.alloc(44+dataBytes);b.write('RIFF',0);b.writeUInt32LE(36+dataBytes,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(dataBytes,40);if(!${silent})for(let i=0;i<${durationSamples};i++)b.writeInt16LE(Math.round(4000*Math.sin(2*Math.PI*220*i/24000)),44+i*2);return new Response(JSON.stringify({output_audio:{data:b.toString('base64')}}),{status:200});};\n`;
}

test("OAuth identity check verifies the expected synthetic channel without exposing tokens or attempting upload", async () => {
  const t = await setup();
  try {
    await writeFile(t.mock, oauthMock(t));
    const result = run(t, "scripts/validate-youtube-oauth.mjs");
    assert.equal(result.status, 0, result.stderr); assertNoSecrets(result);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "channel_identity_verified"); assert.equal(output.channelMatchesExpected, true);
    assert.equal(output.uploadAttempted, false); assert.equal(output.publicationApproved, false);
  } finally { await t.cleanup(); }
});

test("missing expected channel is held before credential use; mismatched channel is never reported as ready", async () => {
  const t = await setup();
  try {
    await writeFile(t.mock, oauthMock(t));
    const absent = run(t, "scripts/validate-youtube-oauth.mjs", { YOUTUBE_EXPECTED_CHANNEL_ID: "" });
    assert.notEqual(absent.status, 0); assert.match(absent.stderr, /expected channel ID/); assertNoSecrets(absent);
    await assert.rejects(readFile(t.marker), { code: "ENOENT" });
    await writeFile(t.mock, oauthMock(t, other));
    const mismatch = run(t, "scripts/validate-youtube-oauth.mjs");
    assert.notEqual(mismatch.status, 0); assert.equal(JSON.parse(mismatch.stdout).status, "channel_mismatch");
    assert.equal(JSON.parse(mismatch.stdout).uploadAttempted, false); assertNoSecrets(mismatch);
  } finally { await t.cleanup(); }
});

test("OAuth provider error bodies and credential values are never logged", async () => {
  const t = await setup();
  try {
    await writeFile(t.mock, `globalThis.fetch=async()=>new Response(JSON.stringify({error_description:'invalid_client synthetic_client_secret synthetic_refresh_token'}),{status:401});\n`);
    const result = run(t, "scripts/validate-youtube-oauth.mjs");
    assert.notEqual(result.status, 0); assertNoSecrets(result);
    const out = JSON.parse(result.stderr); assert.equal(out.status, "held"); assert.equal(out.category, "invalid_client"); assert.equal(out.uploadAttempted, false);
  } finally { await t.cleanup(); }
});

test("hosted voice probe validates nontrivial WAV duration, deletes audio and does not approve a video voice", async () => {
  const t = await setup();
  try {
    await writeFile(t.mock, voiceMock(t));
    const result = run(t, "scripts/validate-hosted-voice.mjs");
    assert.equal(result.status, 0, result.stderr); assertNoSecrets(result);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "hosted_voice_generated"); assert.equal(output.provider, "gemini"); assert.equal(output.durationSeconds, 2);
    assert.equal(output.uploadAttempted, false); assert.equal(output.videoVoiceApproved, false);
    assert.ok(!(await readdir(t.root)).some((name) => name.startsWith("primeplug-voice-check-")));
  } finally { await t.cleanup(); }
});

test("voice probe refuses unauthorized or missing-key requests and rejects a too-short synthetic WAV", async () => {
  const t = await setup();
  try {
    await writeFile(t.mock, voiceMock(t, 2));
    const unauthorized = run(t, "scripts/validate-hosted-voice.mjs", { PRIMEPLUG_VOICE_CHECK_AUTHORIZED: "false" });
    assert.notEqual(unauthorized.status, 0); assert.equal(JSON.parse(unauthorized.stderr).category, "voice_probe_not_authorized");
    await assert.rejects(readFile(t.marker), { code: "ENOENT" });
    const missing = run(t, "scripts/validate-hosted-voice.mjs", { GEMINI_API_KEY: "" });
    assert.notEqual(missing.status, 0); assert.equal(JSON.parse(missing.stderr).category, "hosted_voice_not_configured");
    await assert.rejects(readFile(t.marker), { code: "ENOENT" });
    const short = run(t, "scripts/validate-hosted-voice.mjs");
    assert.notEqual(short.status, 0); assert.equal(JSON.parse(short.stderr).category, "unavailable_or_invalid_audio"); assertNoSecrets(short);
    assert.ok(!(await readdir(t.root)).some((name) => name.startsWith("primeplug-voice-check-")));
  } finally { await t.cleanup(); }
});

test("voice probe holds a correctly sized but silent WAV and deletes the temporary file", async () => {
  const t = await setup();
  try {
    await writeFile(t.mock, voiceMock(t, 48000, true));
    const result = run(t, "scripts/validate-hosted-voice.mjs");
    assert.notEqual(result.status, 0); assertNoSecrets(result);
    assert.equal(JSON.parse(result.stderr).category, "unavailable_or_invalid_audio");
    assert.ok(!(await readdir(t.root)).some((name) => name.startsWith("primeplug-voice-check-")));
  } finally { await t.cleanup(); }
});

test("voice quota errors are categorized without echoing the provider's response", async () => {
  const t = await setup();
  try {
    await writeFile(t.mock, `globalThis.fetch=async()=>new Response('quota 429 synthetic_gemini_key',{status:429});\n`);
    const result = run(t, "scripts/validate-hosted-voice.mjs");
    assert.notEqual(result.status, 0); assertNoSecrets(result);
    assert.equal(JSON.parse(result.stderr).category, "quota_or_rate_limit");
  } finally { await t.cleanup(); }
});

test("provider-check workflow is manual and has no upload, schedule or state persistence", async () => {
  const workflow = await readFile(".github/workflows/primeplug-healthcheck.yml", "utf8");
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(?:push|schedule):/m);
  assert.match(workflow, /contents:\s*read/); assert.doesNotMatch(workflow, /contents:\s*write|actions:\s*write/);
  assert.match(workflow, /if:\s*inputs\.check_youtube_oauth == true/); assert.match(workflow, /if:\s*inputs\.check_hosted_voice == true/);
  assert.doesNotMatch(workflow, /upload-artifact|publish-awaiting|upload-cli|persist-channel-state/);
  assert.match(workflow, /PRIMEPLUG_VOICE_CHECK_AUTHORIZED:\s*"true"/);
});
