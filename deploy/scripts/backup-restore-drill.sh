#!/usr/bin/env bash
# Monthly disaster-recovery drill. Restores the latest encrypted snapshot into
# an isolated PostgreSQL database and extracts uploads into a temporary folder.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=deploy/scripts/backup-lib.sh
source "$SCRIPT_DIR/backup-lib.sh"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.staging.yml}"
ENV_FILE="${ENV_FILE:-.env.staging}"
BACKUP_DIR="${BACKUP_DIR:-/opt/tehus-crm/backups}"
BACKUP_RESTIC_TAG="${BACKUP_RESTIC_TAG:-takto-staging}"
RESTIC_HOST="${RESTIC_HOST:-tehus-crm-staging}"
RESTORE_DRILL_DB="${RESTORE_DRILL_DB:-tehus_restore_drill}"
RESTORE_LOCK_FILE="${RESTORE_LOCK_FILE:-$BACKUP_DIR/.tehus-restore-drill.lock}"
# Reuse the shared heartbeat implementation with the drill-specific monitor.
backup_require_value BACKUP_DRILL_HEARTBEAT_URL
BACKUP_HEARTBEAT_URL="$BACKUP_DRILL_HEARTBEAT_URL"

printf '%s' "$RESTORE_DRILL_DB" \
  | grep -qE '^tehus_restore_drill(_[A-Za-z0-9_]+)?$' \
  || backup_die "RESTORE_DRILL_DB must use the reserved tehus_restore_drill name"

backup_require_command docker
backup_require_command flock
backup_require_command gzip
backup_require_command sha256sum
backup_require_command tar
backup_validate_restic_environment
backup_enable_heartbeat_trap

cd "$REPO_ROOT"
[ -f "$ENV_FILE" ] || backup_die "$ENV_FILE does not exist"
mkdir -p "$BACKUP_DIR"

exec 9>"$RESTORE_LOCK_FILE"
flock -n 9 || backup_die "another restore drill is already running"

restore_root="$(mktemp -d)"
database_created=false

env_value() {
  grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2- || true
}

POSTGRES_USER="$(env_value POSTGRES_USER)"
POSTGRES_PASSWORD="$(env_value POSTGRES_PASSWORD)"
: "${POSTGRES_USER:?POSTGRES_USER missing from $ENV_FILE}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD missing from $ENV_FILE}"

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

drop_drill_database() {
  [ "$database_created" = true ] || return 0
  compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
    psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
      -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$RESTORE_DRILL_DB' AND pid <> pg_backend_pid();" \
      >/dev/null 2>&1 || true
  compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
    dropdb -U "$POSTGRES_USER" --if-exists "$RESTORE_DRILL_DB" \
      >/dev/null 2>&1 || true
}

cleanup_drill() {
  local exit_code=$?
  trap - EXIT
  drop_drill_database
  rm -rf "$restore_root"

  if [ "$exit_code" -eq 0 ]; then
    backup_mark_succeeded
    backup_heartbeat ""
  else
    backup_heartbeat "/fail"
  fi
  exit "$exit_code"
}
trap cleanup_drill EXIT

backup_log "reading every repository pack before the restore drill"
restic check --read-data

backup_log "restoring the latest encrypted snapshot into temporary storage"
restic restore latest \
  --host "$RESTIC_HOST" \
  --tag "$BACKUP_RESTIC_TAG" \
  --target "$restore_root"

mapfile -t database_backups < <(
  find "$restore_root" -type f -name 'tehus-crm-staging-*.sql.gz' \
    ! -name '*.partial' | sort
)
[ "${#database_backups[@]}" -eq 1 ] \
  || backup_die "latest snapshot must contain exactly one database backup"

database_backup="${database_backups[0]}"
stamp="$(basename "$database_backup")"
stamp="${stamp#tehus-crm-staging-}"
stamp="${stamp%.sql.gz}"
uploads_backup="$(find "$restore_root" -type f \
  -name "tehus-crm-staging-uploads-$stamp.tar.gz" -print -quit)"
[ -n "$uploads_backup" ] || backup_die "latest snapshot has no matching uploads archive"

backup_verify_sidecar "$database_backup"
backup_verify_sidecar "$uploads_backup"
gzip -t "$database_backup"
tar -tzf "$uploads_backup" >/dev/null
mkdir -p "$restore_root/uploads-extracted"
tar -xzf "$uploads_backup" -C "$restore_root/uploads-extracted"

backup_log "restoring PostgreSQL into isolated database $RESTORE_DRILL_DB"
# A prior interrupted drill may have left only this reserved, disposable DB.
# Remove it before marking the DB as created by the current run, so cleanup
# never targets an arbitrary or user-selected database.
database_created=true
drop_drill_database
database_created=false
database_created=true
printf '%s\n' "$RESTORE_DRILL_DB" | \
  BACKUP_DIR="$(dirname "$database_backup")" \
  COMPOSE_FILE="$COMPOSE_FILE" \
  ENV_FILE="$ENV_FILE" \
  RESTORE_SKIP_APP_CHECKS=1 \
  "$SCRIPT_DIR/restore-postgres.sh" \
    "$(basename "$database_backup")" \
    --target-db "$RESTORE_DRILL_DB" \
    --replace-target

schema_ok="$(compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  psql -U "$POSTGRES_USER" -d "$RESTORE_DRILL_DB" -tAc \
    "SELECT to_regclass('public.users') IS NOT NULL AND to_regclass('public._prisma_migrations') IS NOT NULL;" \
  | tr -d '[:space:]')"
[ "$schema_ok" = t ] || backup_die "restored drill database is missing expected schema"

backup_log "restore drill completed; isolated database will now be removed"
