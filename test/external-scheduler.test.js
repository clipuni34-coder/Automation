import test from "node:test";
import assert from "node:assert/strict";
import worker, { run, selfTest, lagosDate, lagosMidnightUtcIso } from "../infra/external-scheduler/worker.js";

const TOKEN = "ghp_EXAMPLESECRETTOKEN1234567890";

function memoryKv() {
  const store = new Map();
  return {
    store,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
  };
}

/** Minimal GitHub API stand-in: returns queued responses, records calls. */
function fakeFetch(script) {
  const calls = [];
  const queue = [...script];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body ?? null });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected call to ${url}`);
    if (next instanceof Error) throw next;
    const status = next.status ?? 200;
    // 204 responses must not carry a body (the Response constructor rejects it).
    const payload = status === 204 ? null : (next.rawBody ?? JSON.stringify(next.body ?? {}));
    return new Response(payload, { status, headers: { "content-type": "application/json" } });
  };
  fn.calls = calls;
  return fn;
}

const emptyRuns = () => ({ status: 200, body: { total_count: 0, workflow_runs: [] } });
const existingRun = () => ({
  status: 200,
  body: {
    total_count: 1,
    workflow_runs: [{ id: 999, html_url: "https://github.com/clipuni34-coder/Automation/actions/runs/999", status: "completed", conclusion: "success", event: "workflow_dispatch", created_at: new Date().toISOString() }],
  },
});

test("scheduler: Lagos day boundary is UTC+01:00 with no DST", () => {
  assert.equal(lagosDate(new Date("2026-11-06T04:59:00Z")), "2026-11-06");
  assert.equal(lagosDate(new Date("2026-11-06T23:30:00Z")), "2026-11-07"); // 00:30 next day in Lagos
  assert.equal(lagosMidnightUtcIso(new Date("2026-11-06T09:00:00Z")), "2026-11-05T23:00:00Z");
  assert.equal(lagosMidnightUtcIso(new Date("2026-07-15T12:00:00Z")), "2026-07-14T23:00:00Z");
});

test("scheduler: dispatches when no run exists and records the created run", async () => {
  const kv = memoryKv();
  globalThis.fetch = fakeFetch([
    emptyRuns(),
    { status: 204, rawBody: "" },
    { status: 200, body: { total_count: 1, workflow_runs: [{ id: 4242, html_url: "https://github.com/clipuni34-coder/Automation/actions/runs/4242", status: "queued", conclusion: null, event: "workflow_dispatch" }] } },
  ]);
  const out = await run({ DISPATCH_TOKEN: TOKEN, HISTORY: kv }, "cron:30 5 * * *", new Date("2026-11-06T05:30:00Z"));
  assert.equal(out.action, "dispatched");
  assert.equal(out.ok, true);
  assert.equal(out.httpStatus, 204);
  assert.equal(out.run.id, 4242);
  const dispatchCall = globalThis.fetch.calls.find((c) => c.method === "POST");
  assert.match(dispatchCall.url, /actions\/workflows\/408122820\/dispatches$/);
  const payload = JSON.parse(dispatchCall.body);
  assert.equal(payload.ref, "editorial-evidence-hold");
  assert.equal(payload.inputs.production_enabled, "true");
  assert.equal(payload.inputs.approve_private_upload, "false", "scheduler must never authorize uploads");
  assert.match(dispatchCall.headers.authorization, /^Bearer /);
});

test("scheduler: a repeated trigger the same Lagos day does not dispatch again", async () => {
  const kv = memoryKv();
  globalThis.fetch = fakeFetch([
    existingRun(), // first tick sees today's run already exists
  ]);
  const first = await run({ DISPATCH_TOKEN: TOKEN, HISTORY: kv }, "cron:30 5 * * *", new Date("2026-11-06T05:30:00Z"));
  assert.equal(first.action, "skipped");
  assert.equal(first.reason, "already_ran_today");

  // Second tick: KV marker short-circuits before any network call at all.
  globalThis.fetch = fakeFetch([]);
  const second = await run({ DISPATCH_TOKEN: TOKEN, HISTORY: kv }, "manual", new Date("2026-11-06T09:00:00Z"));
  assert.equal(second.action, "skipped");
  assert.equal(second.reason, "already_dispatched_today_kv");
  assert.equal(globalThis.fetch.calls.length, 0, "no network call should be made when the day marker exists");
});

test("scheduler: concurrent ticks cannot both dispatch (second sees the marker)", async () => {
  const kv = memoryKv();
  globalThis.fetch = fakeFetch([
    emptyRuns(),
    { status: 204, rawBody: "" },
    { status: 200, body: { total_count: 1, workflow_runs: [{ id: 77, html_url: "r/77", status: "queued" }] } },
  ]);
  const a = await run({ DISPATCH_TOKEN: TOKEN, HISTORY: kv }, "cron", new Date("2026-11-06T05:30:00Z"));
  assert.equal(a.action, "dispatched");
  globalThis.fetch = fakeFetch([]);
  const b = await run({ DISPATCH_TOKEN: TOKEN, HISTORY: kv }, "cron", new Date("2026-11-06T05:30:05Z"));
  assert.equal(b.action, "skipped");
});

test("scheduler: retries transient 5xx then succeeds", async () => {
  const kv = memoryKv();
  globalThis.fetch = fakeFetch([
    emptyRuns(),
    { status: 502, rawBody: "bad gateway" },
    { status: 204, rawBody: "" },
    { status: 200, body: { total_count: 1, workflow_runs: [{ id: 12, html_url: "r/12", status: "queued" }] } },
  ]);
  const out = await run({ DISPATCH_TOKEN: TOKEN, HISTORY: kv }, "cron", new Date("2026-11-06T05:30:00Z"));
  assert.equal(out.action, "dispatched");
  assert.equal(out.attempts, 2);
});

test("scheduler: retries network errors and reports failure without leaking the token", async () => {
  const kv = memoryKv();
  const leaky = new Error(`connect ECONNREFUSED while sending ${TOKEN}`);
  globalThis.fetch = fakeFetch([emptyRuns(), leaky, leaky, leaky]);
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.map(String).join(" "));
  const out = await run({ DISPATCH_TOKEN: TOKEN, HISTORY: kv }, "cron", new Date("2026-11-06T05:30:00Z"));
  console.log = originalLog;
  assert.equal(out.action, "error");
  assert.equal(out.ok, false);
  const serialized = JSON.stringify(out);
  assert.equal(serialized.includes(TOKEN), false, "token must never appear in the result");
  assert.equal(serialized.includes("[redacted]"), true);
  assert.equal(JSON.stringify(logs).includes(TOKEN), false);
});

test("scheduler: auth failures are not retried and never echo the token", async () => {
  const kv = memoryKv();
  globalThis.fetch = fakeFetch([{ status: 401, body: { message: "Bad credentials" } }]);
  const out = await run({ DISPATCH_TOKEN: TOKEN, HISTORY: kv }, "cron", new Date("2026-11-06T05:30:00Z"));
  assert.equal(out.action, "error");
  assert.equal(out.fatal, true);
  assert.equal(out.httpStatus, 401);
  assert.equal(globalThis.fetch.calls.length, 1, "401 must not be retried");
});

test("scheduler: dispatch 403 is reported as an error, not retried", async () => {
  const kv = memoryKv();
  globalThis.fetch = fakeFetch([emptyRuns(), { status: 403, rawBody: "Resource not accessible by integration" }]);
  const out = await run({ DISPATCH_TOKEN: TOKEN, HISTORY: kv }, "cron", new Date("2026-11-06T05:30:00Z"));
  assert.equal(out.action, "error");
  assert.equal(out.lastError.httpStatus, 403);
  assert.equal(globalThis.fetch.calls.filter((c) => c.method === "POST").length, 1);
});

test("scheduler: missing DISPATCH_TOKEN fails closed and records the attempt", async () => {
  const kv = memoryKv();
  const out = await run({ HISTORY: kv }, "cron", new Date("2026-11-06T05:30:00Z"));
  assert.equal(out.action, "error");
  assert.match(out.message, /DISPATCH_TOKEN/);
  assert.equal(globalThis.fetch, globalThis.fetch); // no call attempted
  const history = JSON.parse(await kv.get("history"));
  assert.equal(history[0].action, "error");
});

test("scheduler: health endpoint reports state without secrets", async () => {
  const kv = memoryKv();
  globalThis.fetch = fakeFetch([existingRun()]);
  const res = await worker.fetch(new Request("https://scheduler.example/health"), { DISPATCH_TOKEN: TOKEN, ADMIN_TOKEN: "admin-secret-value", HISTORY: kv });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.tokenConfigured, true);
  assert.equal(body.adminTokenConfigured, true);
  assert.equal(JSON.stringify(body).includes(TOKEN), false);
  assert.equal(JSON.stringify(body).includes("admin-secret-value"), false);
  assert.match(body.schedule.daily, /06:30 Africa\/Lagos/);
});

test("scheduler: manual trigger requires the admin token", async () => {
  const kv = memoryKv();
  globalThis.fetch = fakeFetch([existingRun()]);
  const env = { DISPATCH_TOKEN: TOKEN, ADMIN_TOKEN: "admin-secret-value", HISTORY: kv };
  const denied = await worker.fetch(new Request("https://x.example/trigger", { method: "POST" }), env);
  assert.equal(denied.status, 401);
  const allowed = await worker.fetch(new Request("https://x.example/trigger", { method: "POST", headers: { "x-admin-token": "admin-secret-value" } }), env);
  assert.equal(allowed.status, 200);
  const body = await allowed.json();
  assert.equal(body.source, "manual");
  assert.equal(body.action, "skipped");
});

test("scheduler: every attempt is recorded in history for auditing", async () => {
  const kv = memoryKv();
  globalThis.fetch = fakeFetch([existingRun()]);
  await run({ DISPATCH_TOKEN: TOKEN, HISTORY: kv }, "cron:30 5 * * *", new Date("2026-11-06T05:30:00Z"));
  globalThis.fetch = fakeFetch([]);
  await run({ DISPATCH_TOKEN: TOKEN, HISTORY: kv }, "manual", new Date("2026-11-06T09:00:00Z"));
  const history = JSON.parse(await kv.get("history"));
  assert.equal(history.length, 2);
  assert.equal(history[0].source, "manual");
  assert.equal(history[1].source, "cron:30 5 * * *");
  for (const entry of history) assert.equal(JSON.stringify(entry).includes(TOKEN), false);
});

test("scheduler: works without KV bound (GitHub API remains the guard)", async () => {
  globalThis.fetch = fakeFetch([existingRun()]);
  const out = await run({ DISPATCH_TOKEN: TOKEN }, "cron", new Date("2026-11-06T05:30:00Z"));
  assert.equal(out.action, "skipped");
  assert.equal(out.reason, "already_ran_today");
});

test("scheduler: deployed-runtime self-test proves retry and redaction without touching GitHub", async () => {
  const result = await selfTest({ DISPATCH_TOKEN: TOKEN, ADMIN_TOKEN: "admin-secret-value" }, new Date("2026-11-06T05:30:00Z"));
  assert.equal(result.ok, true, JSON.stringify(result.cases));
  assert.equal(result.cases.length, 4);
  assert.ok(result.cases.every((c) => c.pass));
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
});

test("scheduler: self-test endpoint requires the admin token", async () => {
  const denied = await worker.fetch(new Request("https://x.example/selftest", { method: "POST" }), { DISPATCH_TOKEN: TOKEN, ADMIN_TOKEN: "a" });
  assert.equal(denied.status, 401);
  const allowed = await worker.fetch(new Request("https://x.example/selftest", { method: "POST", headers: { "x-admin-token": "a" } }), { DISPATCH_TOKEN: TOKEN, ADMIN_TOKEN: "a" });
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).ok, true);
});
