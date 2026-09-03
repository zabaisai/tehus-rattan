# Deployment runbook — staging

Operational runbook for the private staging deploy of the TAKTO CRM.
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

- **Atomic + verified publish:** each artifact is written to a `*.partial` temp,
  validated (non-empty + `gzip -t` / `tar -tzf`), checksummed, and only then
  published under its final name via an atomic rename. A trap removes temps on any
  failure (`rm -f`, never a broad or recursive `rm`). **A failed pg_dump/gzip/tar
  can never leave an incomplete file that looks valid** — and restore requires the
  checksum, so it fails closed.
- Produces `tehus-crm-staging-<ts>.sql.gz` + `.sha256` (chmod 600), and snapshots
  the uploads volume → `tehus-crm-staging-uploads-<ts>.tar.gz` + `.sha256`. The
  uploads snapshot is **non-fatal**: a uploads problem never aborts the run once
  the DB dump is published.
- Retention deletes only this dir's exact `tehus-crm-staging-*` dumps / tarballs /
  `.sha256` older than `RETENTION_DAYS` (default 7). Never prints `POSTGRES_PASSWORD`.

Verify any backup read-only: `deploy/scripts/backup-verify.sh <file>` (checksum +
gzip). **If a script fails:** it exits non-zero and publishes nothing — re-run it;
the previous good backup is untouched.

## 5. Restore

### Database — `deploy/scripts/restore-postgres.sh <file> [--target-db NAME] [--replace-target]`

- The **`.sha256` sidecar is mandatory** (missing/mismatched → abort) and gzip
  integrity is checked — all before any DB is touched.
- Restores into a **clean** database (terminate connections → drop → recreate) so
  a dump never merges with existing tables. `psql` runs with **`ON_ERROR_STOP=1`**,
  so any SQL error fails non-zero — never a false success.
- The target DB name is validated against a strict identifier (no SQL injection).
- **LIVE restore** (no `--target-db`): stops the backend and **always restarts it**
  (trap), verifies the schema, reports `prisma migrate status`, and requires
  **readiness** (`/api/health/ready`) before declaring success.
- **`--target-db NAME`**: restores into a separate DB for safe testing; refuses to
  overwrite an existing DB unless **`--replace-target`** is given.

### Uploads — `deploy/scripts/restore-uploads.sh <file> [--volume NAME]`

- Mandatory checksum + tar integrity; the archive is **rejected before extraction**
  if any member is an absolute path, a `..` traversal, or a symlink/hardlink
  pointing outside the volume.
- Snapshots the current volume (checksummed) **before** replacing it, stops the
  backend and always restarts it (trap), and extracts inside a container that
  mounts **only** the uploads volume — never `postgres_data` / `caddy_data`.

Both restores were demonstrated locally end-to-end (clean restore, `--replace-target`
gating, and missing/wrong-checksum, corrupt-gzip, SQL-error, traversal, absolute
path and malicious symlink all aborting with the source data untouched).

## 6. Migrations & rollback

Migrations are the **one irreversible** step — that is why deploy.sh takes a
checksummed backup immediately before `migrate deploy`. Chain verified: applies
cleanly to an empty DB from zero; contains the fiscal-identity migration; does
**not** contain the Message-Templates migration (`20260723180000`).

Rollback distinguishes four things — do them **in this order** when a migration was
involved (code first only makes the old code run; the DB/uploads must match it):

| Roll back | How |
| --- | --- |
| **Code / containers** | `./deploy/scripts/rollback-code.sh <PREVIOUS_SHA>` (the SHA is printed by deploy.sh). It builds the old commit in an isolated worktree, verifies the image reports that SHA, and prints the in-place image-swap command. It does **not** touch the DB, main, or any remote. Confirm afterward with `GET /api/health/version` (== the SHA) and the smoke test (readiness). |
| **Database** | Restore the pre-migration backup: `restore-postgres.sh <pre-migration-file>` — the only way back through a schema change (Prisma has **no** universal auto-downgrade). |
| **Uploads** | `restore-uploads.sh <matching-uploads-tarball>` if uploads changed. |
| **Irreversible migration** (dropped column/table) | Data is only recoverable from the backup — restore, do not "un-migrate". |

**Order when a release with a migration failed:** (1) restore the pre-migration DB
backup, (2) restore the matching uploads snapshot if needed, (3) roll the code back
with `rollback-code.sh <PREVIOUS_SHA>`, (4) run the smoke test with
`EXPECTED_RELEASE=<PREVIOUS_SHA>`. **To return to the current release** afterward:
checkout the branch/main and re-run `deploy.sh`.

Every script here fails **non-zero** on any problem and leaves the existing data
untouched, so a failed recovery step never makes things worse — fix the cause and
re-run. **Do not `git checkout <SHA> && deploy.sh`** to roll back: deploy.sh
requires `main` and pulls it, which would redeploy the newer release.

## 7. Smoke test (`deploy/scripts/smoke-test.sh`)

Read-only, never mutates data or calls Meta. Checks frontend + API up, liveness,
readiness, security headers (nosniff / X-Frame-Options / no X-Powered-By /
correlation id / frontend CSP), CORS (allowed reflected, foreign rejected),
invalid login → generic 401, unsigned webhook rejected, protected endpoint → 401
without a JWT, and the release/version. Parametric via env:

```
API_URL=https://api.crm-staging.takto.online/api \
FRONTEND_URL=https://crm-staging.takto.online \
EXPECTED_RELEASE=$(git rev-parse HEAD) \
./deploy/scripts/smoke-test.sh
```

Exit code = number of failed checks. For a deep authenticated check, supply QA
credentials via env vars only (never in the repo or on the command line) — not
required for the default run.

## 8. CI (`.github/workflows/ci.yml`)

Runs on pushes to `develop`/`main`/`feature/**` and on PRs — so a feature branch
is verified remotely before it is ever merged (even with no PR yet) — with
**no deploy, no secrets, no Meta**. Frontend: `npm ci` → test → lint → build.
Backend: `npm ci` → prisma generate + validate → unit tests → build →
`migrate deploy` + e2e against an isolated postgres service. Node 22, npm cache,
per-job timeouts, cancel-in-progress. All env values are dummy/fictitious.

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

---

## Redis y worker de cola (desde 2026-07-31)

El stack incorpora dos servicios nuevos. **Un despliegue que solo reconstruya
`backend` y `frontend` ya no es correcto.**

### Qué son

| Servicio | Rol |
|---|---|
| `redis` | Cola durable (BullMQ). Transporta trabajos: automatizaciones diferidas, esperas, reintentos, descarga de medios. |
| `worker` | Consume esa cola. Misma imagen que `backend`, arrancado con `WORKER_ROLE=queue`. |

**Redis no es fuente de verdad.** El estado durable vive en PostgreSQL; Redis
solo transporta trabajos. Perderlo degrada el procesamiento asíncrono, nunca
los datos comerciales. Ningún job es la única copia de un hecho de negocio.

### Orden de arranque

1. `postgres` y `redis` primero. Backend y worker los declaran como
   dependencia sana; levantarlos después haría que arrancasen sin cola y se
   quedasen degradados hasta el siguiente reinicio.
2. Migraciones (`prisma migrate deploy`).
3. `compose up -d` sin argumentos: levanta todo, worker incluido.

### Trampa a evitar

`compose up -d --no-deps backend frontend` **ya no basta**. El worker comparte
imagen con el backend: si no se recrea, se queda ejecutando código de la
versión anterior mientras la API sirve la nueva. Los síntomas son sutiles —
automatizaciones con comportamiento viejo— y difíciles de atribuir.

### Variables

`REDIS_HOST`, `REDIS_PORT` y `REDIS_PASSWORD` (vacía en staging). Ver
`deploy/env/staging.env.example`. Redis vive solo en la red `internal`, sin
puertos publicados, igual que PostgreSQL: por eso no lleva contraseña. Si
alguna vez se expone, pasa a ser obligatoria.

### Marcha atrás sin quitar nada

`QUEUE_ENABLED=false` desactiva encolado y consumo: los efectos vuelven a
ejecutarse en línea dentro del webhook, como antes de la cola. Es la salida
rápida si Redis diera problemas, sin necesidad de revertir código ni imágenes.

### Salud

`GET /api/health/queue` devuelve `state: up | down | disabled`.

**Responde 200 siempre, a propósito**, y `health-check.sh` lo trata como
informativo. Que Redis esté caído no debe marcar el despliegue como fallido ni
hacer fallar `/api/health/ready`: un readiness en 503 por Redis haría que el
orquestador reiniciase un backend sano, convirtiendo una degradación parcial
en una caída total.

### Rollback

Al revertir código hay que revertir **backend y worker a la vez**, porque
comparten imagen. Redis no necesita rollback: los jobs pendientes se procesan
con el código que haya, y los fallidos permanecen en la cola
(`removeOnFail: false`) para reejecutarse.
