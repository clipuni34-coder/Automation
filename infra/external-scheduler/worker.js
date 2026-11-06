/**
 * Primeplug external scheduler — Cloudflare Worker + Cron Triggers.
 *
 * Purpose: GitHub's own `schedule:` events for the scheduler repository were
 * observed to miss slots entirely (2026-11-06 05:30Z and 10:00Z both dropped
 * while other workflows in the same account fired). This Worker is the
 * authoritative daily trigger. It:
 *
 *   - fires on the cron trigger(s) configured in the dashboard,
 *   - refuses to dispatch twice for the same Africa/Lagos day (idempotent),
 *   - asks GitHub first whether any run already exists since Lagos midnight,
 *   - retries transient failures with backoff and never retries auth errors,
 *   - records every attempt (outcome + HTTP status + resulting run URL),
 *   - exposes /health and /history for monitoring,
 *   - keeps DISPATCH_TOKEN in Worker Secrets and never logs or returns it.
 *
 * Deploy: paste this file into the Cloudflare dashboard editor (no build step).
 * See infra/external-scheduler/README.md for the exact dashboard steps.
 */

const AUTOMATION_REPO = "clipuni34-coder/Automation";
const WORKFLOW_FILE = "daily-operations.yml";
const WORKFLOW_ID = "408122820"; // id of "Daily multi-channel operations"
const TARGET_REF = "editorial-evidence-hold";
const LAGOS_OFFSET_MS = 60 * 60 * 1000; // Africa/Lagos is UTC+01:00 all year, no DST
const MAX_ATTEMPTS = 3;
const HISTORY_LIMIT = 40;
const DAY_MARKER_TTL_SECONDS = 36 * 60 * 60;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

/** YYYY-MM-DD in Africa/Lagos. */
export function lagosDate(now = new Date()) {
  return new Date(now.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

/** UTC instant of the most recent Lagos midnight (ISO 8601, for the GitHub API). */
export function lagosMidnightUtcIso(now = new Date()) {
  const lagos = new Date(now.getTime() + LAGOS_OFFSET_MS);
  const midnightLagos = Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate());
  return new Date(midnightLagos - LAGOS_OFFSET_MS).toISOString().replace(".000Z", "Z");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Never let a token reach a log line, an error message or an HTTP response. */
function redact(value, env) {
  let text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  for (const secretName of ["DISPATCH_TOKEN", "ADMIN_TOKEN"]) {
    const secret = env?.[secretName];
    if (secret && typeof secret === "string" && secret.length >= 6 && text.includes(secret)) {
      text = text.split(secret).join("[redacted]");
    }
  }
  return text.replace(/\b(gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[redacted]");
}

async function kvGet(env, key) {
  try {
    if (!env.HISTORY) return null;
    const raw = await env.HISTORY.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function kvPut(env, key, value, ttlSeconds) {
  try {
    if (!env.HISTORY) return;
    await env.HISTORY.put(key, JSON.stringify(value), ttlSeconds ? { expirationTtl: ttlSeconds } : undefined);
  } catch {
    /* KV is a convenience store; the GitHub API remains the source of truth. */
  }
}

async function appendHistory(env, entry) {
  try {
    if (!env.HISTORY) return;
    const list = (await kvGet(env, "history")) ?? [];
    list.unshift(entry);
    await kvPut(env, "history", list.slice(0, HISTORY_LIMIT));
  } catch {
    /* ignore */
  }
}

async function githubRunsSince(env, sinceIso, transport = fetch) {
  const url = `https://api.github.com/repos/${AUTOMATION_REPO}/actions/workflows/${WORKFLOW_ID}/runs`
    + `?created=%3E%3D${encodeURIComponent(sinceIso)}&per_page=20`;
  const res = await transport(url, {
    headers: {
      authorization: `Bearer ${env.DISPATCH_TOKEN}`,
      accept: "application/vnd.github+json",
      "user-agent": "primeplug-external-scheduler/1.0",
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error("github_auth_failed"), { httpStatus: res.status, fatal: true });
  }
  if (!res.ok) throw Object.assign(new Error(`github_query_http_${res.status}`), { httpStatus: res.status });
  const body = await res.json();
  return { totalCount: body.total_count ?? 0, runs: (body.workflow_runs ?? []).slice(0, 5) };
}

async function dispatchWorkflow(env, transport = fetch) {
  const url = `https://api.github.com/repos/${AUTOMATION_REPO}/actions/workflows/${WORKFLOW_ID}/dispatches`;
  return transport(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.DISPATCH_TOKEN}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "primeplug-external-scheduler/1.0",
    },
    body: JSON.stringify({
      ref: TARGET_REF,
      inputs: {
        production_enabled: "true",
        // Uploading ALWAYS needs the separate per-video approval (candidate id
        // + SHA-256), so the scheduler can never publish anything.
        approve_private_upload: "false",
      },
    }),
  });
}

/** Find the run this dispatch created, so the history links straight to it. */
async function locateNewRun(env, sinceIso, previousId, transport = fetch) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await sleep(attempt === 0 ? 1500 : 3000);
    try {
      const { runs } = await githubRunsSince(env, sinceIso, transport);
      const fresh = runs.find((r) => r.id !== previousId);
      if (fresh) return { id: fresh.id, url: fresh.html_url, status: fresh.status, conclusion: fresh.conclusion };
    } catch {
      /* not fatal: the dispatch already happened */
    }
  }
  return null;
}

/**
 * One scheduled or manual tick.
 * @returns {object} a JSON-safe summary of what happened.
 */
export async function run(env, source = "cron", now = new Date(), transport = fetch) {
  const day = lagosDate(now);
  const since = lagosMidnightUtcIso(now);
  const startedAt = new Date(now).toISOString();
  const record = { at: startedAt, source, lagosDay: day };

  if (!env?.DISPATCH_TOKEN) {
    const out = { ...record, action: "error", ok: false, message: "DISPATCH_TOKEN secret is not configured" };
    await appendHistory(env, out);
    return out;
  }

  // Fast idempotency check (KV); the GitHub query below is authoritative.
  const marker = await kvGet(env, `day:${day}`);
  if (marker?.status === "dispatched") {
    const out = { ...record, action: "skipped", ok: true, reason: "already_dispatched_today_kv", run: marker.run ?? null };
    await appendHistory(env, out);
    return out;
  }

  let existing = null;
  try {
    existing = await githubRunsSince(env, since, transport);
  } catch (error) {
    const fatal = Boolean(error?.fatal);
    const out = {
      ...record,
      action: "error",
      ok: false,
      message: redact(String(error?.message ?? error), env),
      httpStatus: error?.httpStatus ?? null,
      fatal,
    };
    await appendHistory(env, out);
    return out;
  }
  if (existing.totalCount > 0) {
    const first = existing.runs[0] ?? null;
    const out = {
      ...record,
      action: "skipped",
      ok: true,
      reason: "already_ran_today",
      existingRuns: existing.totalCount,
      run: first ? { id: first.id, url: first.html_url, status: first.status, conclusion: first.conclusion, event: first.event } : null,
    };
    await kvPut(env, `day:${day}`, { status: "dispatched", run: out.run }, DAY_MARKER_TTL_SECONDS);
    await appendHistory(env, out);
    return out;
  }

  const previousId = null;
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await dispatchWorkflow(env, transport);
      if (res.status === 204) {
        const runInfo = await locateNewRun(env, since, previousId, transport);
        const out = {
          ...record,
          action: "dispatched",
          ok: true,
          attempts: attempt,
          httpStatus: 204,
          run: runInfo,
        };
        await kvPut(env, `day:${day}`, { status: "dispatched", run: runInfo, at: startedAt }, DAY_MARKER_TTL_SECONDS);
        await appendHistory(env, out);
        return out;
      }
      const body = await res.text().catch(() => "");
      lastError = { httpStatus: res.status, message: redact(body, env).slice(0, 300) };
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable) break;
    } catch (error) {
      lastError = { httpStatus: null, message: redact(String(error?.message ?? error), env).slice(0, 300) };
    }
    if (attempt < MAX_ATTEMPTS) await sleep(attempt === 1 ? 2000 : 6000);
  }

  const out = { ...record, action: "error", ok: false, attempts: MAX_ATTEMPTS, lastError };
  await appendHistory(env, out);
  return out;
}

async function health(env, now = new Date()) {
  const day = lagosDate(now);
  const marker = await kvGet(env, `day:${day}`);
  const history = (await kvGet(env, "history")) ?? [];
  const last = history[0] ?? null;
  const record = await kvGet(env, "lastRun");
  let lastRun = record;
  try {
    const { runs } = await githubRunsSince(env, new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString());
    lastRun = runs[0] ? { id: runs[0].id, url: runs[0].html_url, status: runs[0].status, conclusion: runs[0].conclusion, createdAt: runs[0].created_at, event: runs[0].event } : null;
  } catch (error) {
    lastRun = { error: redact(String(error?.message ?? error), env) };
  }
  return {
    ok: true,
    service: "primeplug-external-scheduler",
    schedule: { cron: ["30 5 * * *", "0 * * * *"], timezone: "Africa/Lagos (UTC+01:00)", daily: "06:30 Africa/Lagos" },
    lagosDay: day,
    lagosMidnightUtc: lagosMidnightUtcIso(now),
    tokenConfigured: Boolean(env.DISPATCH_TOKEN),
    adminTokenConfigured: Boolean(env.ADMIN_TOKEN),
    kvBound: Boolean(env.HISTORY),
    todayDispatched: marker?.status === "dispatched",
    todayMarker: marker ?? null,
    lastAttempt: last,
    lastAutomationRun: lastRun,
  };
}

/**
 * Deployed-runtime self-test of the retry and redaction paths. It never talks
 * to GitHub: a mock transport is injected, so running it cannot dispatch
 * anything. Used to prove on the live Worker that transient failures are
 * retried and that credentials cannot leak into results.
 */
export async function selfTest(env, now = new Date()) {
  // A fresh in-memory KV per case: otherwise case 1's "dispatched" marker would
  // make the later cases short-circuit as already-dispatched.
  const freshEnv = () => {
    const store = new Map();
    return {
      ...env,
      HISTORY: {
        async get(k) { return store.has(k) ? store.get(k) : null; },
        async put(k, v) { store.set(k, v); },
      },
    };
  };
  const results = [];

  const response = (status, body = null) => (status === 204
    ? new Response(null, { status })
    : new Response(JSON.stringify(body ?? {}), { status, headers: { "content-type": "application/json" } }));

  // 1. transient 503 then success -> dispatched on attempt 2
  {
    const script = [
      () => response(200, { total_count: 0, workflow_runs: [] }),
      () => response(503, { message: "Service Unavailable" }),
      () => response(204),
      () => response(200, { total_count: 1, workflow_runs: [{ id: 1, html_url: "https://example.invalid/selftest", status: "queued" }] }),
    ];
    const transport = async () => script.shift()();
    const out = await run(freshEnv(), "selftest", now, transport);
    results.push({ case: "retry_after_503", pass: out.action === "dispatched" && out.attempts === 2, observed: { action: out.action, attempts: out.attempts } });
  }

  // 2. network error then success -> dispatched on attempt 2
  {
    const script = [
      () => response(200, { total_count: 0, workflow_runs: [] }),
      () => { throw new Error("simulated connection reset"); },
      () => response(204),
      () => response(200, { total_count: 1, workflow_runs: [{ id: 2, html_url: "https://example.invalid/selftest", status: "queued" }] }),
    ];
    const transport = async () => script.shift()();
    const out = await run(freshEnv(), "selftest", now, transport);
    results.push({ case: "retry_after_network_error", pass: out.action === "dispatched" && out.attempts === 2, observed: { action: out.action, attempts: out.attempts } });
  }

  // 3. auth failure is NOT retried
  {
    let calls = 0;
    const transport = async () => { calls += 1; return response(401, { message: "Bad credentials" }); };
    const out = await run(freshEnv(), "selftest", now, transport);
    results.push({ case: "no_retry_on_401", pass: out.action === "error" && calls === 1, observed: { action: out.action, calls } });
  }

  // 4. redaction: a token embedded in an error must never be returned
  {
    const secret = env.DISPATCH_TOKEN ?? "ghp_EXAMPLESECRETTOKEN1234567890";
    const transport = async (url, init) => {
      if (!init?.method) return response(200, { total_count: 0, workflow_runs: [] });
      throw new Error(`failed with token ${secret}`);
    };
    const out = await run(freshEnv(), "selftest", now, transport);
    const serialized = JSON.stringify(out);
    results.push({
      case: "no_secret_in_result",
      pass: serialized.includes("[redacted]") && !serialized.includes(secret),
      observed: { redacted: serialized.includes("[redacted]"), leaked: serialized.includes(secret) },
    });
  }

  return { ok: results.every((r) => r.pass), ranAt: new Date(now).toISOString(), cases: results };
}

export default {
  /** Cron Triggers entry point. */
  async scheduled(event, env, ctx) {
    const summary = await run(env, `cron:${event?.cron ?? "unknown"}`);
    // Structured log without credentials: safe to keep in Workers Logs.
    console.log(JSON.stringify({ event: "scheduled_tick", summary: JSON.parse(redact(summary, env)) }));
  },

  /** HTTP surface: /health, /history, POST /trigger (admin token). */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json(await health(env));
    if (url.pathname === "/history") {
      const history = (await kvGet(env, "history")) ?? [];
      return json({ ok: true, count: history.length, history });
    }
    if (url.pathname === "/selftest") {
      if (request.method !== "POST") return json({ ok: false, message: "POST required" }, 405);
      const provided = request.headers.get("x-admin-token") ?? "";
      if (!env.ADMIN_TOKEN || provided !== env.ADMIN_TOKEN) return json({ ok: false, message: "unauthorized" }, 401);
      const result = await selfTest(env);
      return json(result, result.ok ? 200 : 500);
    }
    if (url.pathname === "/trigger") {
      if (request.method !== "POST") return json({ ok: false, message: "POST required" }, 405);
      const provided = request.headers.get("x-admin-token") ?? "";
      if (!env.ADMIN_TOKEN || provided !== env.ADMIN_TOKEN) {
        return json({ ok: false, message: "unauthorized" }, 401);
      }
      const summary = await run(env, "manual");
      return json(summary, summary.ok ? 200 : 500);
    }
    return new Response(
      "primeplug-external-scheduler\n\nGET  /health   service + last attempt + last Automation run\nGET  /history  recorded dispatch attempts\nPOST /trigger  manual tick (header: x-admin-token)\nPOST /selftest retry/redaction self-test, no dispatch (header: x-admin-token)\n",
      { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  },
};
