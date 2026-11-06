#!/usr/bin/env node
/**
 * Live verification of the deployed external scheduler.
 *
 * Usage (your machine, token from your shell environment — never paste it to a chatbot):
 *   ADMIN_TOKEN=... node infra/external-scheduler/verify-live.mjs https://primeplug-scheduler.<subdomain>.workers.dev
 *
 * Checks: health, dispatch, duplicate suppression on an immediate second tick,
 * retry/redaction self-test inside the deployed runtime, and history recording.
 * Prints a PASS/FAIL table and nothing secret.
 */
const base = (process.argv[2] ?? "").replace(/\/$/, "");
const admin = process.env.ADMIN_TOKEN ?? "";
if (!base) {
  console.error("usage: ADMIN_TOKEN=... node verify-live.mjs https://<worker>.<subdomain>.workers.dev");
  process.exit(2);
}

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const get = async (path) => {
  const res = await fetch(`${base}${path}`);
  const text = await res.text();
  return { status: res.status, body: text };
};
const post = async (path) => {
  const res = await fetch(`${base}${path}`, { method: "POST", headers: { "x-admin-token": admin } });
  const text = await res.text();
  return { status: res.status, body: text };
};
const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };

const secrets = [admin].filter(Boolean);
const leaks = (text) => secrets.some((s) => s && text.includes(s));

// 1. health
const health = await get("/health");
const h = parse(health.body);
record("health endpoint responds", health.status === 200 && h?.ok === true, `HTTP ${health.status}`);
record("DISPATCH_TOKEN is configured in the Worker", h?.tokenConfigured === true);
record("schedule advertises 06:30 Africa/Lagos", /06:30 Africa\/Lagos/.test(JSON.stringify(h?.schedule ?? {})));
record("Lagos boundary reported as UTC+01:00", /T23:00:00Z$/.test(h?.lagosMidnightUtc ?? ""), h?.lagosMidnightUtc);
record("health exposes no credentials", !leaks(health.body));

// 2. deployed-runtime retry + redaction self-test (never dispatches)
const selftest = await post("/selftest");
const st = parse(selftest.body);
record("retry/redaction self-test passes in the deployed runtime", selftest.status === 200 && st?.ok === true,
  (st?.cases ?? []).map((c) => `${c.case}:${c.pass ? "ok" : "FAIL"}`).join(", "));
record("self-test response leaks no credentials", !leaks(selftest.body));

// 3. manual tick, twice
const first = await post("/trigger");
const f = parse(first.body);
record("first trigger accepted", first.status === 200 && Boolean(f?.action), `HTTP ${first.status}, action=${f?.action}`);
if (f?.action === "dispatched") {
  record("dispatch created an Automation run", Boolean(f?.run?.url), f?.run?.url ?? "(run not located yet)");
} else {
  record("first trigger skipped because today already ran", f?.reason === "already_ran_today" || f?.reason === "already_dispatched_today_kv", f?.reason);
}
record("trigger response leaks no credentials", !leaks(first.body));

const second = await post("/trigger");
const s = parse(second.body);
record("second trigger does NOT dispatch again", s?.action === "skipped",
  `action=${s?.action}, reason=${s?.reason ?? "-"}`);

// 4. history
const history = await get("/history");
const hist = parse(history.body);
record("history records every attempt", (hist?.count ?? 0) >= 2, `${hist?.count ?? 0} entries`);
record("history leaks no credentials", !leaks(history.body));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (f?.run?.url) console.log(`Automation run: ${f.run.url}`);
process.exit(failed.length ? 1 : 0);
