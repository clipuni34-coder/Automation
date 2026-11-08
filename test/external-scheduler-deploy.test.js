import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const deployer = new URL("../infra/external-scheduler/deploy-api.mjs", import.meta.url).href;

// Exercise the real CLI against a fake Cloudflare API; the only credentials are
// obviously fake test strings. No network requests or real deployments occur.
const harness = String.raw`
import assert from "node:assert/strict";
process.argv[2] = process.env.MOCK_MODE ?? "--apply";
globalThis.setTimeout = (fn) => { queueMicrotask(fn); return 1; };
const json = (result) => new Response(JSON.stringify({ success: true, result }), {
  status: 200, headers: { "content-type": "application/json" },
});
globalThis.fetch = async (address, init = {}) => {
  const url = new URL(String(address));
  const path = url.pathname.replace(/^\/client\/v4/, "");
  const method = init.method ?? "GET";
  if (url.hostname.endsWith("workers.dev")) {
    if (path === "/health") {
      if (process.env.MOCK_BAD_HEALTH) return new Response(JSON.stringify({ok:false}), {status:503});
      return new Response(JSON.stringify({ok:true,tokenConfigured:true,adminTokenConfigured:true,kvBound:true,
        schedulerVersion: process.env.MOCK_OLD_VERSION ? "old-version" : "external-scheduler/2-health-expiry",
        lastAutomationRun: process.env.MOCK_GITHUB_ERROR ? {error:"github_auth_failed"} : null}));
    }
    if (path === "/selftest" && process.env.ADMIN_TOKEN) {
      return new Response(JSON.stringify({ok:!process.env.MOCK_BAD_SELFTEST}), {status:process.env.MOCK_BAD_SELFTEST ? 500 : 200});
    }
    throw new Error("unexpected public request");
  }
  if (path === "/accounts" && method === "GET") return json([{ id: "test-account", name: "test" }]);
  if (path === "/accounts/test-account/workers/scripts" && method === "GET") {
    return json(process.env.MOCK_NEW ? [] : [{ id: "automation", modified_on: "test-time" }]);
  }
  const root = "/accounts/test-account/workers/scripts/automation";
  if (path === root + "/settings" && method === "GET") return json({ bindings: [] });
  if (path === root + "/schedules" && method === "GET") return json({ schedules: [] });
  if (path === root + "/secrets" && method === "GET") {
    return json(process.env.MOCK_MISSING_SECRET
      ? [{ name: "ADMIN_TOKEN" }]
      : [{ name: "DISPATCH_TOKEN" }, { name: "ADMIN_TOKEN" }]);
  }
  if (path === "/accounts/test-account/storage/kv/namespaces" && method === "GET") {
    return json([{ id: "test-kv", title: "primeplug-scheduler-history" }]);
  }
  if (path === root && method === "PUT") {
    const metadata = JSON.parse(init.body.get("metadata"));
    assert.deepEqual(metadata.keep_bindings, ["secret_text"]);
    assert.ok(metadata.bindings.some((b) => b.type === "kv_namespace" && b.namespace_id === "test-kv"));
    console.log("MOCK_UPLOAD_PRESERVES_SECRET_BINDINGS");
    return json({ id: "automation", version_id: "fake-version-id" });
  }
  if (path === root + "/secrets" && method === "PUT") {
    const secret = JSON.parse(init.body);
    if (!process.env.MOCK_EXPECT_SECRET_WRITES) throw new Error("unexpected secret replacement");
    assert.ok(["DISPATCH_TOKEN", "ADMIN_TOKEN"].includes(secret.name));
    console.log("MOCK_REPLACED_SECRET_NAME", secret.name);
    return json({ name: secret.name });
  }
  if (path === root + "/schedules" && method === "PUT") return json({});
  if (path === root + "/subdomain" && method === "POST") return json({});
  if (path === "/accounts/test-account/workers/subdomain" && method === "GET") return json({ subdomain: "test" });
  throw new Error("unexpected request " + method + " " + path);
};
await import(process.env.DEPLOYER_URL);
`;

function runMock(extra = {}) {
  const env = { ...process.env, DEPLOYER_URL: deployer, WORKER_NAME: "automation", CLOUDFLARE_API_TOKEN: "FAKE_CF_TEST_VALUE" };
  delete env.GITHUB_DISPATCH_TOKEN;
  delete env.ADMIN_TOKEN;
  Object.assign(env, extra);
  return spawnSync(process.execPath, ["--input-type=module", "--eval", harness], {
    env, encoding: "utf8", timeout: 20000,
  });
}

test("deployer: code-only redeploy preserves both encrypted secrets without reading them", () => {
  const r = runMock();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /MOCK_UPLOAD_PRESERVES_SECRET_BINDINGS/);
  assert.match(r.stdout, /existing Worker secrets preserved without reading them/);
  assert.match(r.stdout, /selftest skipped/);
  assert.match(r.stdout, /upload version_id: fake-version-id/);
  assert.doesNotMatch(r.stdout, /MOCK_REPLACED_SECRET_NAME/);
  assert.doesNotMatch(r.stdout, /FAKE_CF_TEST_VALUE/);
});

test("deployer: missing existing secret aborts before making any change", () => {
  const r = runMock({ MOCK_MISSING_SECRET: "1" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /DISPATCH_TOKEN is neither supplied nor confirmed/);
  assert.doesNotMatch(r.stdout, /MOCK_UPLOAD_PRESERVES_SECRET_BINDINGS/);
});

test("deployer: supplied replacements are sent but never printed", () => {
  const r = runMock({
    MOCK_EXPECT_SECRET_WRITES: "1",
    GITHUB_DISPATCH_TOKEN: "FAKE_DISPATCH_DO_NOT_PRINT",
    ADMIN_TOKEN: "FAKE_ADMIN_DO_NOT_PRINT",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /MOCK_REPLACED_SECRET_NAME DISPATCH_TOKEN/);
  assert.match(r.stdout, /MOCK_REPLACED_SECRET_NAME ADMIN_TOKEN/);
  assert.match(r.stdout, /selftest HTTP 200/);
  for (const secret of ["FAKE_CF_TEST_VALUE", "FAKE_DISPATCH_DO_NOT_PRINT", "FAKE_ADMIN_DO_NOT_PRINT"]) {
    assert.equal((r.stdout + r.stderr).includes(secret), false);
  }
});

test("deployer: invalid mode does not contact Cloudflare", () => {
  const r = runMock({ MOCK_MODE: "--wrong" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Choose --inspect or --apply/);
  assert.doesNotMatch(r.stdout, /account:/);
});

test("deployer: a new Worker requires both secrets before creating anything", () => {
  const r = runMock({ MOCK_NEW: "1" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /DISPATCH_TOKEN is neither supplied nor confirmed/);
  assert.doesNotMatch(r.stdout, /MOCK_UPLOAD_PRESERVES_SECRET_BINDINGS/);
});

test("deployer: a new Worker with supplied secrets is created without printing them", () => {
  const r = runMock({
    MOCK_NEW: "1",
    MOCK_EXPECT_SECRET_WRITES: "1",
    GITHUB_DISPATCH_TOKEN: "FAKE_NEW_DISPATCH_SECRET",
    ADMIN_TOKEN: "FAKE_NEW_ADMIN_SECRET",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /created exactly one Worker/);
  for (const secret of ["FAKE_CF_TEST_VALUE", "FAKE_NEW_DISPATCH_SECRET", "FAKE_NEW_ADMIN_SECRET"]) {
    assert.equal((r.stdout + r.stderr).includes(secret), false);
  }
});

test("deployer: a bad health response or stale version is not reported as verified", () => {
  for (const config of [{ MOCK_BAD_HEALTH: "1" }, { MOCK_OLD_VERSION: "1" }, { MOCK_GITHUB_ERROR: "1" }]) {
    const r = runMock(config);
    assert.notEqual(r.status, 0);
    assert.doesNotMatch(r.stdout, /reused the existing Worker \(no duplicate created\)/);
    assert.match(r.stderr, /Worker was uploaded, but/);
  }
});

test("deployer: a failed self-test is not reported as success", () => {
  const r = runMock({ MOCK_EXPECT_SECRET_WRITES: "1", ADMIN_TOKEN: "FAKE_ADMIN", MOCK_BAD_SELFTEST: "1" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /deployed self-test failed/);
  assert.equal((r.stdout + r.stderr).includes("FAKE_ADMIN"), false);
});
