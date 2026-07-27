#!/usr/bin/env bash
# Restores a database backup produced by backup-postgres.sh.
#
# Usage:
#   ./restore-postgres.sh <backup-filename>                          # restore the LIVE staging DB
#   ./restore-postgres.sh <backup-filename> --target-db NAME         # restore into a separate DB
#   ./restore-postgres.sh <backup-filename> --target-db NAME --replace-target
#
# Safety properties:
#   - The .sha256 sidecar is MANDATORY; a missing/mismatched checksum aborts
#     before anything is touched. The gzip stream is also integrity-checked.
#   - Restores into a CLEAN database (drop + recreate) so a dump never merges
#     with pre-existing tables/rows.
#   - psql runs with ON_ERROR_STOP=1, so a single SQL error fails the restore
#     with a non-zero exit — never a false success.
#   - For a LIVE restore the backend is stopped and ALWAYS restarted (trap),
#     even on failure; readiness must pass before success is declared.
#   - --target-db never overwrites an existing DB unless --replace-target.
#   - Never prints POSTGRES_PASSWORD or DATABASE_URL.
#
# Never invoked automatically by deploy.sh — only ever run by a human.
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.staging.yml}"
ENV_FILE="${ENV_FILE:-.env.staging}"
BACKUP_DIR="${BACKUP_DIR:-/opt/tehus-crm/backups}"
# Test/CI escape hatch for environments with no real backend service (the
# --target-db path never needs app checks anyway; only a LIVE restore does).
RESTORE_SKIP_APP_CHECKS="${RESTORE_SKIP_APP_CHECKS:-0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# ---- args ------------------------------------------------------------------
BACKUP_NAME=""
TARGET_DB_OVERRIDE=""
REPLACE_TARGET=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --target-db) TARGET_DB_OVERRIDE="${2:?--target-db requires a database name}"; shift 2 ;;
    --replace-target) REPLACE_TARGET=true; shift ;;
    -*) echo "ERROR: unknown option: $1" >&2; exit 2 ;;
    *) if [ -z "$BACKUP_NAME" ]; then BACKUP_NAME="$1"; shift; else echo "ERROR: unexpected argument: $1" >&2; exit 2; fi ;;
  esac
done

if [ -z "$BACKUP_NAME" ]; then
  echo "Usage: $0 <backup-filename> [--target-db <db-name>] [--replace-target]" >&2
  echo "" >&2
  echo "Available backups in $BACKUP_DIR:" >&2
  ls -1 "$BACKUP_DIR" 2>/dev/null | grep -vE '\.sha256$|\.partial$' >&2 || echo "  (none found)" >&2
  exit 1
fi

BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"
[ -f "$BACKUP_PATH" ] || { echo "ERROR: backup not found: $BACKUP_PATH" >&2; exit 1; }

# ---- MANDATORY integrity gate (before touching any database) ---------------
if [ ! -f "$BACKUP_PATH.sha256" ]; then
  echo "ERROR: required checksum sidecar '$BACKUP_NAME.sha256' is missing — refusing to restore." >&2
  exit 1
fi
echo "Verifying SHA-256..."
( cd "$BACKUP_DIR" && sha256sum -c "$BACKUP_NAME.sha256" ) \
  || { echo "ERROR: checksum verification FAILED for $BACKUP_NAME — aborting restore." >&2; exit 1; }
echo "Verifying gzip integrity..."
gzip -t "$BACKUP_PATH" \
  || { echo "ERROR: $BACKUP_NAME is not a valid gzip stream — aborting restore." >&2; exit 1; }

# ---- env / target ----------------------------------------------------------
[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE not found" >&2; exit 1; }
POSTGRES_USER="$(grep -m1 '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2-)"
POSTGRES_DB="$(grep -m1 '^POSTGRES_DB=' "$ENV_FILE" | cut -d= -f2-)"
POSTGRES_PASSWORD="$(grep -m1 '^POSTGRES_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
: "${POSTGRES_USER:?POSTGRES_USER missing from $ENV_FILE}"
: "${POSTGRES_DB:?POSTGRES_DB missing from $ENV_FILE}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD missing from $ENV_FILE}"

TARGET_DB="${TARGET_DB_OVERRIDE:-$POSTGRES_DB}"
# Strict identifier: letters/digits/underscore, must start with a letter or _.
# Blocks spaces, quotes, semicolons, dots — no SQL-injection via the DB name.
if ! printf '%s' "$TARGET_DB" | grep -qE '^[A-Za-z_][A-Za-z0-9_]*$'; then
  echo "ERROR: invalid target database name '$TARGET_DB' (allowed: letters, digits, underscore; must start with a letter/underscore)." >&2
  exit 1
fi
restoring_live=false
[ "$TARGET_DB" = "$POSTGRES_DB" ] && restoring_live=true

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }
pexec()   { compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres "$@"; }
psql_admin() { pexec psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 "$@"; }

# ---- confirmation ----------------------------------------------------------
echo "About to restore:"
echo "  Backup file : $BACKUP_PATH"
echo "  Target DB   : $TARGET_DB$( [ "$restoring_live" = true ] && echo '  (LIVE — will be dropped and recreated)')"
read -r -p "Type the target database name exactly to confirm: " confirm_db
[ "$confirm_db" = "$TARGET_DB" ] || { echo "Confirmation did not match '$TARGET_DB'. Aborting — nothing changed." >&2; exit 1; }

# ---- backend stop + restart trap (LIVE only) -------------------------------
backend_stopped=false
cleanup() {
  local ec=$?
  if [ "$backend_stopped" = true ]; then
    echo "Ensuring backend is running again..."
    compose start backend >/dev/null 2>&1 || true
  fi
  exit "$ec"
}
trap cleanup EXIT

if [ "$restoring_live" = true ]; then
  echo "Stopping backend..."
  compose stop backend
  backend_stopped=true
else
  # --target-db: never merge into an existing DB.
  exists="$(psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname = '$TARGET_DB'" | tr -d '[:space:]')"
  if [ "$exists" = "1" ] && [ "$REPLACE_TARGET" != true ]; then
    echo "ERROR: target database '$TARGET_DB' already exists. Re-run with --replace-target to drop and recreate it." >&2
    exit 1
  fi
fi

# ---- clean slate: terminate connections, drop, recreate --------------------
echo "Recreating '$TARGET_DB' from scratch..."
psql_admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$TARGET_DB' AND pid <> pg_backend_pid();" >/dev/null
psql_admin -c "DROP DATABASE IF EXISTS \"$TARGET_DB\";"
psql_admin -c "CREATE DATABASE \"$TARGET_DB\";"

# ---- restore (ON_ERROR_STOP: any SQL error → non-zero) ---------------------
echo "Restoring $BACKUP_NAME into $TARGET_DB ..."
gunzip -c "$BACKUP_PATH" | pexec psql -U "$POSTGRES_USER" -d "$TARGET_DB" -v ON_ERROR_STOP=1 -q >/dev/null

# ---- post-restore verification ---------------------------------------------
echo "Verifying restored schema..."
schema_ok="$(pexec psql -U "$POSTGRES_USER" -d "$TARGET_DB" -tAc "SELECT to_regclass('public.users') IS NOT NULL;" | tr -d '[:space:]')"
[ "$schema_ok" = "t" ] || { echo "ERROR: restored schema is missing expected tables (public.users)." >&2; exit 1; }
echo "Schema OK (public.users present)."

if [ "$restoring_live" = true ]; then
  echo "Restarting backend..."
  compose start backend
  backend_stopped=false

  if [ "$RESTORE_SKIP_APP_CHECKS" != "1" ]; then
    echo "Prisma migrate status (informational — a rollback backup may show pending migrations):"
    compose run --rm backend npx prisma migrate status || true

    echo "Waiting for backend readiness..."
    ready=false
    for _ in $(seq 1 30); do
      if compose exec -T backend wget -qO- http://127.0.0.1:3001/api/health/ready 2>/dev/null | grep -q '"status":"ok"'; then
        ready=true; break
      fi
      sleep 2
    done
    [ "$ready" = true ] || { echo "ERROR: backend did not become ready after restore." >&2; exit 1; }
    echo "Readiness OK."
  fi
  echo "Restore finished. LIVE database restored from $BACKUP_NAME."
else
  echo "Restore finished into database '$TARGET_DB'."
  echo "Drop it when done:  docker compose -f $COMPOSE_FILE exec postgres dropdb -U $POSTGRES_USER $TARGET_DB"
fi
