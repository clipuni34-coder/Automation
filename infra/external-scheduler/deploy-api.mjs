#!/usr/bin/env node
/**
 * Deploy / inspect the Primeplug external scheduler through the Cloudflare API,
 * so no dashboard clicking is required beyond authorizing a scoped token.
 *
 *   CLOUDFLARE_API_TOKEN=... node deploy-api.mjs --inspect
 *   CLOUDFLARE_API_TOKEN=... GITHUB_DISPATCH_TOKEN=... node deploy-api.mjs --apply
 *
 * Required token permissions (nothing more):
 *   Account -> Workers Scripts : Edit
 *   Account -> Workers KV Storage : Edit
 *   Account -> Account Settings : Read      (only to discover the account id)
 *
 * Behaviour:
 *  - Inspect first: lists existing Workers, their crons, secret NAMES (never values),
 *    and reports whether a Worker with our name already exists. Reuses that Worker
 *    instead of creating a second one, so no duplicate Workers are produced.
 *  - Never prints a secret value; secret values are sent straight to the API.
 *  - Creates KV namespace "primeplug-scheduler-history" only if it is missing.
 *  - Does not touch the Automation repository or the production engine.
 */
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const API = "https://api.cloudflare.com/client/v4";
// Overridable so an existing Worker (e.g. a Hello World stub) can be upgraded in
// place instead of a second Worker being created.
const WORKER_NAME = process.env.WORKER_NAME ?? "primeplug-scheduler";
const KV_TITLE = "primeplug-scheduler-history";
const CRONS = ["30 5 * * *", "0 * * * *"];
const COMPATIBILITY_DATE = "2026-11-01";

const token = process.env.CLOUDFLARE_API_TOKEN ?? "";
const mode = process.argv[2] ?? "--inspect";
if (!token) {
  console.error("CLOUDFLARE_API_TOKEN is required (set it in the environment, not in a file).");
  process.exit(2);
}

const redact = (value) => {
  let out = String(value ?? "");
  for (const secret of [token, process.env.GITHUB_DISPATCH_TOKEN, process.env.ADMIN_TOKEN]) {
    if (secret && secret.length > 6) out = out.split(secret).join("[redacted]");
  }
  return out.replace(/github_pat_[A-Za-z0-9_]+/g, "[redacted]").replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, "[redacted]");
};
const log = (...parts) => console.log(redact(parts.join(" ")));

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok || body?.success === false) {
    const detail = body?.errors?.map((e) => `${e.code} ${e.message}`).join("; ");
    throw new Error(`${init.method ?? "GET"} ${path} -> HTTP ${res.status}: ${redact(detail ?? text).slice(0, 400)}`);
  }
  return body.result;
}

async function resolveAccountId() {
  if (process.env.CLOUDFLARE_ACCOUNT_ID) return process.env.CLOUDFLARE_ACCOUNT_ID;
  const accounts = await api("/accounts");
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("No accounts visible to this token. Add Account Settings: Read, or set CLOUDFLARE_ACCOUNT_ID.");
  }
  if (accounts.length > 1) log("multiple accounts visible, using the first:", accounts.map((a) => a.name).join(", "));
  return accounts[0].id;
}

async function inspect(accountId) {
  log("account:", accountId);
  const scripts = await api(`/accounts/${accountId}/workers/scripts`);
  log(`existing Workers (${scripts.length}): ${scripts.map((s) => s.id).join(", ") || "(none)"}`);
  const existing = scripts.find((s) => s.id === WORKER_NAME);
  if (!existing) {
    log(`no Worker named ${WORKER_NAME} yet — it will be created, not duplicated`);
    return { existing: null };
  }
  log(`existing Worker ${WORKER_NAME}: modified ${existing.modified_on}`);
  const details = {};
  for (const [label, path] of [
    ["settings", `/accounts/${accountId}/workers/scripts/${WORKER_NAME}/settings`],
    ["schedules", `/accounts/${accountId}/workers/scripts/${WORKER_NAME}/schedules`],
    ["secrets (names only)", `/accounts/${accountId}/workers/scripts/${WORKER_NAME}/secrets`],
  ]) {
    try {
      const result = await api(path);
      details[label] = result;
      if (label === "schedules") log("current cron triggers:", JSON.stringify(result?.schedules ?? []));
      else if (label === "secrets (names only)") log("existing secret names:", (result ?? []).map((s) => s.name).join(", ") || "(none)");
      else log("bindings:", JSON.stringify((result?.bindings ?? []).map((b) => `${b.type}:${b.name}`)));
    } catch (error) {
      log(`${label}: unavailable (${redact(error.message).slice(0, 160)})`);
    }
  }
  return { existing, details };
}

async function ensureKv(accountId) {
  const namespaces = await api(`/accounts/${accountId}/storage/kv/namespaces?per_page=100`);
  const found = namespaces.find((n) => n.title === KV_TITLE);
  if (found) {
    log(`KV namespace already exists: ${KV_TITLE} (${found.id})`);
    return found.id;
  }
  const created = await api(`/accounts/${accountId}/storage/kv/namespaces`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: KV_TITLE }),
  });
  log(`created KV namespace: ${KV_TITLE} (${created.id})`);
  return created.id;
}

async function upload(accountId, kvId) {
  const code = await readFile(join(HERE, "worker.js"), "utf8");
  const metadata = {
    main_module: "worker.js",
    compatibility_date: COMPATIBILITY_DATE,
    bindings: [
      { type: "kv_namespace", name: "HISTORY", namespace_id: kvId },
      { type: "plain_text", name: "SCHEDULER_VERSION", text: "external-scheduler/2-health-expiry" },
    ],
  };
  const form = new FormData();
  form.set("metadata", JSON.stringify(metadata));
  form.set("worker.js", new Blob([code], { type: "application/javascript+module" }), "worker.js");
  const res = await fetch(`${API}/accounts/${accountId}/workers/scripts/${WORKER_NAME}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.success === false) {
    throw new Error(`upload failed: HTTP ${res.status} ${redact(JSON.stringify(body?.errors ?? body)).slice(0, 400)}`);
  }
  log(`uploaded ${WORKER_NAME} (${code.split("\n").length} lines, module worker)`);
}

async function putSecrets(accountId) {
  const dispatch = process.env.GITHUB_DISPATCH_TOKEN;
  if (!dispatch) throw new Error("GITHUB_DISPATCH_TOKEN is required to set the DISPATCH_TOKEN secret");
  const admin = process.env.ADMIN_TOKEN ?? randomBytes(18).toString("hex");
  for (const [name, text] of [["DISPATCH_TOKEN", dispatch], ["ADMIN_TOKEN", admin]]) {
    await api(`/accounts/${accountId}/workers/scripts/${WORKER_NAME}/secrets`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, text, type: "secret_text" }),
    });
    log(`secret set: ${name}`);
  }
  // The admin token is only a manual-trigger gate. It is not printed: a credential
  // written to a transcript or a log is a credential leaked.
  log("ADMIN_TOKEN set (value not printed; rotate with `wrangler secret put ADMIN_TOKEN`)");
  return admin;
}

async function putSchedules(accountId) {
  await api(`/accounts/${accountId}/workers/scripts/${WORKER_NAME}/schedules`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(CRONS.map((cron) => ({ cron }))),
  });
  const schedules = await api(`/accounts/${accountId}/workers/scripts/${WORKER_NAME}/schedules`);
  log("cron triggers now:", JSON.stringify((schedules?.schedules ?? []).map((s) => s.cron)));
}

async function workersDevUrl(accountId) {
  try {
    await api(`/accounts/${accountId}/workers/scripts/${WORKER_NAME}/subdomain`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
  } catch (error) {
    log("could not enable workers.dev subdomain (continuing):", redact(error.message).slice(0, 200));
  }
  const sub = await api(`/accounts/${accountId}/workers/subdomain`);
  return `https://${WORKER_NAME}.${sub.subdomain}.workers.dev`;
}

const accountId = await resolveAccountId();
const state = await inspect(accountId);

if (mode === "--inspect") {
  log("inspect only — nothing changed. Re-run with --apply to deploy.");
  process.exit(0);
}

const kvId = await ensureKv(accountId);
await upload(accountId, kvId);
const adminToken = await putSecrets(accountId);
await putSchedules(accountId);
const url = await workersDevUrl(accountId);
log("worker URL:", url);

await new Promise((resolve) => setTimeout(resolve, 5000));
const health = await fetch(`${url}/health`);
const body = await health.text();
log("health HTTP", health.status);
log("health body:", body.slice(0, 1200));

const selftest = await fetch(`${url}/selftest`, { method: "POST", headers: { "x-admin-token": adminToken } });
const selftestBody = await selftest.text();
log("selftest HTTP", selftest.status, "| body:", selftestBody.slice(0, 800));
log(state.existing ? "reused the existing Worker (no duplicate created)" : "created exactly one Worker");
