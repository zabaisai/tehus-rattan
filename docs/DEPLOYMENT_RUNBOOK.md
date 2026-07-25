# Deployment runbook — staging

Operational runbook for the private staging deploy of the Tehus Rattan CRM.
Companion to [VPS_DEPLOYMENT.md](./VPS_DEPLOYMENT.md) (host/DNS/first-time setup),
[SECURITY_HEADERS.md](./SECURITY_HEADERS.md), and
[AUTH_SESSION_SECURITY.md](./AUTH_SESSION_SECURITY.md).

> Everything here runs on the VPS from the repo root as the `deploy` user. No
> command in this repo deploys automatically, calls Meta, or touches real data.

## 1. Architecture (staging)

Caddy (TLS edge, 80/443) ── proxy net ──> frontend (Next standalone :3000)
                                        └─> backend (NestJS :3001) ── internal net ──> postgres :5432
- Only Caddy publishes ports. `postgres` and `backend` are never exposed to the
  host/internet (`internal` network; no `ports:`). Uploads persist on the
  `backend_uploads` volume; DB on `postgres_data`.
- Images carry the deployed git SHA (build arg `GIT_SHA` → `RELEASE_SHA` env →
  `GET /api/health/version` + startup log + image label).

## 2. Health, readiness, release

| Endpoint | Meaning |
| --- | --- |
| `GET /api/health/live` | Liveness — process up, **no DB** (a DB blip must not kill a healthy container) |
| `GET /api/health/ready` | Readiness — `SELECT 1` with a 3s timeout → `503` if DB unreachable |
| `GET /api/health` | Readiness alias (kept for existing container/edge probes) |
| `GET /api/health/version` | `{status, release, builtAt}` — git SHA + build time, `"unknown"` when unset. No secrets. |

The public health body stays minimal; the release SHA is also in the startup log.

## 3. Deploy (`deploy/scripts/deploy.sh`)

Refuses any branch but `main`; `git pull --ff-only`; never `down -v`, never
deletes a volume, never prints a secret. Steps:

1. Verify branch is `main`.
2. Record the **previous** commit (code rollback target); fetch + fast-forward;
   export `GIT_SHA` + `BUILD_TIME`.
3. Require `.env.staging` and **enforce** perms `600` (fails otherwise).
4. Build images (with the release SHA).
5. Start postgres; 6. wait for its healthcheck.
7. **Pre-migration backup** (DB + uploads, checksummed) — never skipped.
8. `prisma migrate deploy` (never `migrate dev`/`reset`).
9. `up -d`; 10. `ps`; 11. `health-check.sh` (prints rollback instructions on failure).
12. Report deployed release + rollback target.

After deploy, run the smoke test (below).

## 4. Backups (`deploy/scripts/backup-postgres.sh`)

- `pg_dump --format=plain | gzip` → `tehus-crm-staging-<ts>.sql.gz` (chmod 600) +
  a **SHA-256** sidecar.
- Snapshots the uploads volume → `tehus-crm-staging-uploads-<ts>.tar.gz` + sha256
  (best-effort; warns, does not fail the DB backup, if the volume is absent).
- Retention: deletes only this dir's exact `tehus-crm-staging-*` dumps / tarballs
  / `.sha256` older than `RETENTION_DAYS` (default 7). Never a broad/recursive rm.
- Never prints `POSTGRES_PASSWORD`. Cron example in VPS_DEPLOYMENT.md.

Verify a backup any time (read-only): `deploy/scripts/backup-verify.sh <file>`
(checksum + gzip integrity).

## 5. Restore (`deploy/scripts/restore-postgres.sh`)

- Requires the **exact** filename (never "latest"); **verifies the SHA-256
  sidecar first** and aborts on mismatch; interactive confirm (type the DB name).
- `--target-db NAME` restores into a separate/temporary DB (safe testing) without
  touching the live one. Restoring live stops the backend for the duration and
  restarts it.

Locally demonstrated end-to-end (ephemeral marker → backup → verify →
restore into a new temp DB → drop temp DB → corrupted backup correctly rejected
→ QA DB untouched → uploads tar round-trip).

## 6. Migrations & rollback

Migrations are the **one irreversible** step — that is why deploy.sh backs up
immediately before `migrate deploy`. Chain verified: applies cleanly to an empty
DB from zero; contains the fiscal-identity migration; does **not** contain the
Message-Templates migration (`20260723180000`).

Rollback distinguishes four things:

| Roll back | How |
| --- | --- |
| **Code / containers** | `git checkout <PREVIOUS_SHA>` (printed by deploy.sh) → `./deploy/scripts/deploy.sh`. Fast, always safe. |
| **Database** | Restore the pre-migration backup: `restore-postgres.sh <pre-migration-file>`. The only way back through a schema change — Prisma has **no** universal auto-downgrade. |
| **Uploads** | Restore the matching `…-uploads-<ts>.tar.gz` into the `backend_uploads` volume. |
| **Irreversible migration** (dropped column/table) | Data is only recoverable from the backup — restore, do not "un-migrate". |

## 7. Smoke test (`deploy/scripts/smoke-test.sh`)

Read-only, never mutates data or calls Meta. Checks frontend + API up, liveness,
readiness, security headers (nosniff / X-Frame-Options / no X-Powered-By /
correlation id / frontend CSP), CORS (allowed reflected, foreign rejected),
invalid login → generic 401, unsigned webhook rejected, protected endpoint → 401
without a JWT, and the release/version. Parametric via env:

```
API_URL=https://api.crm-staging.tehusrattan.com/api \
FRONTEND_URL=https://crm-staging.tehusrattan.com \
EXPECTED_RELEASE=$(git rev-parse HEAD) \
./deploy/scripts/smoke-test.sh
```

Exit code = number of failed checks. For a deep authenticated check, supply QA
credentials via env vars only (never in the repo or on the command line) — not
required for the default run.

## 8. CI (`.github/workflows/ci.yml`)

Runs on pushes to `develop`/`main` and on PRs — **no deploy, no secrets, no
Meta**. Frontend: `npm ci` → test → lint → build. Backend: `npm ci` → prisma
generate + validate → unit tests → build → `migrate deploy` + e2e against an
isolated postgres service. Node 22, npm cache, per-job timeouts,
cancel-in-progress. All env values are dummy/fictitious.

## 9. Environment

Template: `deploy/env/staging.env.example` (placeholders only). Key vars:
`POSTGRES_*`, `DATABASE_URL`, `JWT_SECRET`, `NODE_ENV=production` (required for
`Secure` cookies + strict CSP), `FRONTEND_URL`, `CSRF_ALLOWED_ORIGINS`,
`NEXT_PUBLIC_API_URL` (build-time, inlined), `THROTTLE_*`, WhatsApp vars (only if
`WHATSAPP_WEBHOOK_ENABLED=true`). `.env.staging` is gitignored, must be `chmod
600`. Docker/Caddy: `GIT_SHA`/`BUILD_TIME` are set by deploy.sh; the Caddy ACME
`email` must be a monitored address.

## 10. Deploy checklist

- [ ] On `main`, fast-forwarded, working tree clean.
- [ ] `.env.staging` present, filled, `chmod 600`, `NODE_ENV=production`.
- [ ] Caddy `email` set to a monitored address; DNS A records point at the VPS.
- [ ] `./deploy/scripts/deploy.sh` green (pre-migration backup taken).
- [ ] `smoke-test.sh` = 0 failures; `EXPECTED_RELEASE` matches.
- [ ] A backup exists and `backup-verify.sh` passes.

## 11. Before production (does NOT block private staging with fake data)

- Money as **Decimal/integer cents** (currently Float) before real quotes/billing.
- **Immutable snapshot** of a sent quote (line items/prices frozen at send time).
- **Off-site/off-VPS** backup copies + tested restore drill.
- External **observability** (metrics/log shipping/error tracking) — integration
  points are documented; no SaaS wired in.
- Privacy & data-retention policy.
- Real Meta/WhatsApp test with a real number; OAuth / Embedded Signup; Message
  Templates; media messages; delivery/read statuses.
- High-availability / horizontal scale (shared rate-limit store, object storage
  for uploads) if the CRM grows beyond a single instance.
