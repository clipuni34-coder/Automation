import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppServer } from "../src/server.js";

test("mobile interface, status API and approval recording", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "mobile-"));
  process.env.APPROVAL_STORE_PATH = join(dir, "approvals.jsonl");
  const server = createAppServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;

  const home = await fetch(base + "/");
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-type"), /text\/html/);
  const html = await home.text();
  assert.match(html, /viewport/);
  assert.match(html, /Automation Control/);
  assert.match(html, /public publishing is OFF/i);

  const status = await (await fetch(base + "/api/status")).json();
  assert.equal(status.ok, true);
  assert.equal(status.publicPublishingEnabled, false);
  assert.ok(status.capabilities.youtube_upload.missing.length > 0);
  assert.ok(Array.isArray(status.pipelineStages) && status.pipelineStages.length === 11);
  assert.equal(JSON.stringify(status).includes("refreshToken"), false);

  const bad = await fetch(base + "/api/approval", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ packageId: "", decision: "approved" }) });
  assert.equal(bad.status, 400);

  const ok = await fetch(base + "/api/approval", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ packageId: "pkg-1", decision: "approved" }) });
  assert.equal(ok.status, 201);
  const record = await ok.json();
  assert.equal(record.publishesAnything, false);
});
