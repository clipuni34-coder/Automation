import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("private upload smoke workflow is private-only and owner-gated", async () => {
  const workflow = await readFile(new URL("../.github/workflows/private-upload-smoke.yml", import.meta.url), "utf8");
  assert.match(workflow, /confirm_private_upload/);
  assert.match(workflow, /YOUTUBE_PUBLISH_PRIVACY: private/);
  assert.match(workflow, /YOUTUBE_ALLOW_PUBLIC_PUBLISH: "false"/);
  assert.match(workflow, /secrets\.YOUTUBE_REFRESH_TOKEN \|\| secrets\.REFRESH_TOKEN/);
  assert.match(workflow, /A11Landing\.mov/);
  assert.doesNotMatch(workflow, /privacyStatus:\s*public/);
});

test("upload smoke script refuses without explicit confirmations", async () => {
  const script = await readFile(new URL("../scripts/upload-private-smoke.mjs", import.meta.url), "utf8");
  assert.match(script, /SMOKE_UPLOAD_CONFIRM/);
  assert.match(script, /HUMAN_APPROVED/);
  assert.match(script, /PRIVATE visibility only/);
  assert.match(script, /uploaded_private_verified/);
});

test("mobile deployment workflow publishes a Pages status page", async () => {
  const workflow = await readFile(new URL("../.github/workflows/deploy-mobile.yml", import.meta.url), "utf8");
  assert.match(workflow, /deploy-pages/);
  assert.match(workflow, /pages: write/);
  assert.doesNotMatch(workflow, /secrets\.[A-Z_]+[\s\S]{0,80}site\/index\.html/);
});
