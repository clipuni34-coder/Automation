# Primeplug external scheduler (Cloudflare Worker + Cron Triggers)

GitHub's own `schedule:` events for `Primeplug-scheduler` missed both the
**2026-11-06 05:30Z** and **10:00Z** slots (0 scheduled runs, while other
workflows in the same account fired hours late). This Worker is now the
authoritative daily trigger for Primeplug production.

It only ever **dispatches the existing Automation workflow**. It cannot upload,
publish, approve, or delete anything: the dispatch payload sets
`approve_private_upload: "false"`, and uploading still requires the separate
per-video approval (candidate id + output SHA-256) inside the pipeline.

| Property | Value |
|---|---|
| Provider | Cloudflare Workers + Cron Triggers (free plan) |
| Primary cron | `30 5 * * *` (UTC) = **06:30 Africa/Lagos** daily |
| Catch-up cron | `0 * * * *` (UTC, hourly, idempotent — dispatches only if today has no run) |
| Timezone handling | Lagos is UTC+01:00 all year (no DST); the day boundary is computed explicitly, never from the host TZ |
| Target | Automation `daily-operations` workflow id `408122820`, ref `editorial-evidence-hold` |
| Secrets | `DISPATCH_TOKEN` (GitHub PAT), `ADMIN_TOKEN` (manual trigger) — Worker Secrets only, never in code or logs |
| Idempotency | GitHub runs API (authoritative) + KV day marker (fast path) |
| History | KV `history` (last 40 attempts) via `GET /history` |
| Health | `GET /health` |
| Endpoints | `GET /health`, `GET /history`, `POST /trigger`, `POST /selftest` (both POSTs require header `x-admin-token`) |

## Deployed instance (2026-11-07)

| Property | Value |
|---|---|
| Worker | `automation` (upgraded in place from a Hello World stub — no duplicate Worker) |
| URL | https://automation.primeplug71.workers.dev |
| Health / history | `/health`, `/history` |
| Account id | `3cb6ca6e777cb0c3fc7111e6d8edd9d1` |
| KV | `primeplug-scheduler-history` (`e3273329a7144049a9b8d7260e13e2f3`) bound as `HISTORY` |
| Crons | `30 5 * * *`, `0 * * * *` |
| Deployed by | `node deploy-api.mjs --apply` (see script header for the scoped token) |

The dashboard steps below are kept for rebuilds from scratch.

## One-time setup

There are two equivalent paths — pick one.

**Path A (fastest, no copy-paste): wrangler CLI.** From `infra/external-scheduler/`:
```bash
npx wrangler login                        # browser OAuth; no token to copy anywhere
npx wrangler deploy                       # deploys worker + both cron triggers
npx wrangler secret put DISPATCH_TOKEN    # paste the GitHub PAT at the prompt (not echoed)
npx wrangler secret put ADMIN_TOKEN       # random string you keep private
npx wrangler kv namespace create HISTORY  # optional; then uncomment the binding in wrangler.toml
npx wrangler deploy                       # second deploy picks up the KV binding
```
`wrangler.toml` in this folder already declares the Worker name, the two cron
triggers and observability, so nothing needs configuring by hand.

**Path B: Cloudflare dashboard** (below) if you prefer not to install anything.

## Path B — dashboard actions (no token ever goes into chat)

### 1. Create the GitHub token
Open **https://github.com/settings/personal-access-tokens/new**

| Field | Value |
|---|---|
| Token name | `primeplug-external-scheduler` |
| Expiration | 90 days (put a calendar reminder to rotate) |
| Resource owner | `clipuni34-coder` |
| Repository access | *Only select repositories* → **Automation** |
| Repository permissions | **Actions: Read and write** (leave everything else as-is) |

Click **Generate token** and copy it. It is shown once. Do not paste it into any
chat; it goes into Cloudflare in step 3.

### 2. Create the Worker
1. Open **https://dash.cloudflare.com** and sign up / sign in (free plan).
2. **Workers & Pages → Create → Workers → Create Worker**.
3. Name it exactly **`primeplug-scheduler`** → **Deploy**.
4. Click **Edit code**, select everything in the editor, and paste the full
   contents of `infra/external-scheduler/worker.js` from this repository.
5. **Deploy**. Note your URL: `https://primeplug-scheduler.<your-subdomain>.workers.dev`

### 3. Add the two secrets
Worker → **Settings → Variables and Secrets → Add**

| Type | Variable name | Value |
|---|---|---|
| **Secret** | `DISPATCH_TOKEN` | the GitHub fine-grained PAT from step 1 |
| **Secret** | `ADMIN_TOKEN` | a random string you generate, e.g. `openssl rand -hex 24` (keep it private; used for manual tests) |

Use **Secret** (not "Text") for both so the values are encrypted and hidden.

### 4. Add the cron triggers
Worker → **Settings → Triggers → Cron Triggers → Add Cron Trigger**

| Cron expression | Meaning |
|---|---|
| `30 5 * * *` | 06:30 Africa/Lagos daily (the production trigger) |
| `0 * * * *` | hourly idempotent catch-up (covers a dropped slot without double-running) |

Cloudflare evaluates cron expressions in **UTC**; 05:30 UTC = 06:30 in Lagos.

> Cloudflare may show a short delay note for newly added triggers (they can take
> a few minutes to become active). No action needed.

### 5. Add history storage (optional but recommended)
1. **Storage & Databases → KV → Create instance**, name `primeplug-scheduler-history`.
2. Worker → **Settings → Bindings → Add → KV namespace**:
   - Variable name: **`HISTORY`**
   - KV namespace: `primeplug-scheduler-history`

Without KV the scheduler still works — the GitHub runs API remains the
authoritative duplicate guard — but `/history` and the fast-path day marker need it.

### 6. Verify (all read-only except the POSTs you run yourself)
```bash
# a) health — expect "ok": true, "tokenConfigured": true
curl https://primeplug-scheduler.<your-subdomain>.workers.dev/health

# b) retry/redaction self-test inside the deployed runtime (never dispatches)
curl -X POST https://primeplug-scheduler.<your-subdomain>.workers.dev/selftest \
  -H "x-admin-token: <ADMIN_TOKEN>"

# c) manual tick — run it TWICE
curl -X POST https://primeplug-scheduler.<your-subdomain>.workers.dev/trigger \
  -H "x-admin-token: <ADMIN_TOKEN>"
```
- First call: `"action": "dispatched"` with the new Automation run URL
  (unless a run already exists today, in which case `"action": "skipped"`).
- Second call: `"action": "skipped"`, `"reason": "already_dispatched_today_kv"`.

## What the Worker guarantees

- **Never twice in a Lagos day.** It asks GitHub whether any `daily-operations`
  run exists since Lagos midnight; if one does it skips and records that. A KV
  day marker short-circuits repeat ticks with no network call at all.
- **Retries transient failures** (HTTP 429/5xx and network errors) with backoff —
  3 attempts, 2 s then 6 s — and **never retries** auth/config failures
  (401/403/404), which are reported for a human instead of hammering GitHub.
- **Records every attempt** (timestamp, source `cron:*`/`manual`, action,
  HTTP status, resulting run URL) in KV history.
- **Never logs or returns credentials.** Error strings pass through `redact()`,
  which strips `DISPATCH_TOKEN`, `ADMIN_TOKEN` and anything matching GitHub
  token patterns before it reaches a response or a log line.
- **Fails closed.** Missing `DISPATCH_TOKEN` records an error and dispatches nothing.

## Relationship to `Primeplug-scheduler`

`Primeplug-scheduler` is kept as a **manual fallback only** — its cron triggers
were removed so two schedulers can never race each other. Use
*Run workflow* in that repository if Cloudflare is ever unavailable.
