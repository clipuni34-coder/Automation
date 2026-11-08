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
| Catch-up cron | `0 * * * *` (UTC, hourly; cron dispatches are blocked before 06:30 Lagos and otherwise skipped when today's run is already seen) |
| Timezone handling | Lagos is UTC+01:00 all year (no DST); the day boundary is computed explicitly, never from the host TZ |
| Target | Automation `daily-operations` workflow id `408122820`, ref `editorial-evidence-hold` |
| Secrets | `DISPATCH_TOKEN` (GitHub PAT), `ADMIN_TOKEN` (manual trigger) — Cloudflare Worker secrets; previously exposed setup tokens still require rotation |
| Duplicate guard | GitHub runs API + KV day marker; sequential repeats are proven, but concurrent invocations can race |
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

On 2026-11-08 the hourly cron started production at midnight Lagos; the 06:30 tick
fired but skipped because that day's run already existed. The early-run gate has since
been deployed. A natural 06:30 production dispatch after the fix is still pending. See
`docs/EVIDENCE_REPORT.md` for exact timestamps and evidence.

The most recent deployment generated an admin secret in memory and did not retain its
value. Cron operation does not need it, but the two POST endpoints cannot be used until
the owner sets a new `ADMIN_TOKEN` Worker secret. The token-expiry health enhancement
in the current local source is not yet deployed, and it does not send alerts.

**Do not use the generic `wrangler.toml` or the create-Worker steps below against the
live account:** that template names a different Worker and does not bind the existing
KV namespace. The steps are for a fresh rebuild only. For the live instance use the
API deployer with `WORKER_NAME=automation` after inspecting the existing configuration.
The updated deployer preserves existing encrypted secrets without reading them and
checks the version after uploading; these changes passed mocked API tests but have not
yet been exercised in a live redeployment.

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
| `0 * * * *` | hourly catch-up, with cron runs before 06:30 Lagos blocked and sequential repeats skipped |

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

A manual `/trigger` can start production before 06:30 if there is no run that day;
it is not a read-only test. Do not run it or the manual fallback concurrently with a
scheduled tick. Prefer the two GET endpoints when checking status.

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

## Worker behavior and limits

- **Sequential duplicate guard.** It asks GitHub whether any `daily-operations`
  run exists since Lagos midnight; if one does it skips and records that. A KV
  day marker can short-circuit repeat ticks. These checks are not an atomic lock:
  concurrently running invocations can both dispatch before either observes the
  other's run or KV write. Exactly-once behavior under concurrency is not proven.
- **No cron start before 06:30 Lagos.** The gate applies to scheduled ticks;
  manual admin triggers are intentionally exempt.
- **Retries transient failures** (HTTP 429/5xx and network errors) with backoff —
  3 attempts, 2 s then 6 s — and **never retries** auth/config failures
  (401/403/404), which are reported for a human instead of hammering GitHub.
- **Records every attempt** (timestamp, source `cron:*`/`manual`, action,
  HTTP status, resulting run URL) in KV history.
- **Redaction in the Worker.** Error strings pass through `redact()`, which strips
  the two configured secrets and GitHub token patterns. Scans of `/health` and
  `/history` found no credentials, but the setup conversation/tool command exposed
  the deployment token and GitHub PAT; those tokens must be rotated.
- **Fails closed.** Missing `DISPATCH_TOKEN` records an error and dispatches nothing.

## Relationship to `Primeplug-scheduler`

`Primeplug-scheduler` is kept as a **manual fallback only** — its automatic cron
triggers were removed. A manually launched fallback can still race a Cloudflare tick;
use *Run workflow* only if Cloudflare is unavailable and no other tick is running.
