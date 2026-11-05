import test from "node:test";
import assert from "node:assert/strict";
import { auditCredentials } from "../src/config/credentials.js";
import { validateChannels } from "../src/config/channels.js";

test("credential audit reports names only and resolves legacy aliases", () => {
  const report = auditCredentials({ YOUTUBE_DATA_API_KEY: "x", REFRESH_TOKEN: "secret-value", OPENROUTER_API: "k", YOUTUBE_CLIENT_ID: "id", YOUTUBE_EXPECTED_CHANNEL_ID: "UC1" });
  assert.equal(report.valuesExposed, false);
  assert.equal(JSON.stringify(report).includes("secret-value"), false);
  const rt = report.credentials.find((c) => c.name === "YOUTUBE_REFRESH_TOKEN");
  assert.equal(rt.configured, true);
  assert.equal(rt.configuredVia, "REFRESH_TOKEN");
  assert.equal(report.credentials.find((c) => c.name === "OPENROUTER_API_KEY").configuredVia, "OPENROUTER_API");
  assert.equal(report.capabilities.youtube_upload.ready, true);
  assert.equal(report.capabilities.discovery.ready, true);
  assert.deepEqual(report.capabilities.research.missing, ["TAVILY_API_KEY"]);
});

test("credential audit fails closed when nothing is configured", () => {
  const report = auditCredentials({});
  assert.equal(report.capabilities.youtube_upload.ready, false);
  assert.ok(report.capabilities.youtube_upload.missing.includes("YOUTUBE_REFRESH_TOKEN"));
});

test("channels: unique ids, private by default, public blocked without both opt-ins", () => {
  const channels = validateChannels({ channels: [
    { id: "main", name: "Main" },
    { id: "lab", name: "Lab", publishing: { enabled: true, privacyStatus: "public", allowPublic: true, maxUploadsPerDay: 2 } },
  ] }, {});
  assert.equal(channels[0].publishing.privacyStatus, "private");
  assert.equal(channels[0].publishing.enabled, false);
  assert.equal(channels[1].publishing.privacyStatus, "private");
  assert.equal(channels[1].publishing.publicBlocked, true);
  const allowed = validateChannels({ channels: [{ id: "lab", publishing: { privacyStatus: "public", allowPublic: true } }] }, { YOUTUBE_ALLOW_PUBLIC_PUBLISH: "true" });
  assert.equal(allowed[0].publishing.privacyStatus, "public");
  assert.throws(() => validateChannels({ channels: [{ id: "a" }, { id: "a" }] }), /Duplicate channel id/);
  assert.throws(() => validateChannels({ channels: [] }), /non-empty/);
});
