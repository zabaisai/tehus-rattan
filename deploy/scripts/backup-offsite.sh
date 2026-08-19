#!/usr/bin/env bash
# Creates the existing local DB/uploads backup and immediately copies the
# verified artifacts into a client-side encrypted Restic repository.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/scripts/backup-lib.sh
source "$SCRIPT_DIR/backup-lib.sh"

BACKUP_DIR="${BACKUP_DIR:-/opt/tehus-crm/backups}"
BACKUP_SCRIPT="${BACKUP_SCRIPT:-$SCRIPT_DIR/backup-postgres.sh}"
VERIFY_SCRIPT="${VERIFY_SCRIPT:-$SCRIPT_DIR/backup-verify.sh}"
BACKUP_LOCK_FILE="${BACKUP_LOCK_FILE:-/tmp/tehus-offsite-backup.lock}"
BACKUP_RESTIC_TAG="${BACKUP_RESTIC_TAG:-takto-staging}"
RESTIC_HOST="${RESTIC_HOST:-tehus-crm-staging}"

backup_require_command flock
backup_require_command comm
backup_require_command find
backup_require_command gzip
backup_require_command sha256sum
backup_require_command tar
backup_validate_restic_environment
backup_enable_heartbeat_trap

mkdir -p "$BACKUP_DIR"
exec 9>"$BACKUP_LOCK_FILE"
flock -n 9 || backup_die "another off-site backup is already running"

before_list="$(mktemp)"
cleanup_offsite() {
  local exit_code=$?
  rm -f "$before_list"
  backup_finish_with_heartbeat "$exit_code"
}
trap cleanup_offsite EXIT

find "$BACKUP_DIR" -maxdepth 1 -type f \
  -name 'tehus-crm-staging-*.sql.gz' ! -name '*.partial' \
  -print | sort >"$before_list"

backup_log "checking access to the encrypted off-site repository"
restic snapshots --host "$RESTIC_HOST" --tag "$BACKUP_RESTIC_TAG" >/dev/null

backup_log "creating the local atomic backup set"
BACKUP_DIR="$BACKUP_DIR" "$BACKUP_SCRIPT"

mapfile -t database_backups < <(
  comm -13 "$before_list" <(
    find "$BACKUP_DIR" -maxdepth 1 -type f \
      -name 'tehus-crm-staging-*.sql.gz' ! -name '*.partial' \
      -print | sort
  )
)

[ "${#database_backups[@]}" -eq 1 ] \
  || backup_die "expected exactly one new database backup; found ${#database_backups[@]}"

database_backup="${database_backups[0]}"
stamp="$(basename "$database_backup")"
stamp="${stamp#tehus-crm-staging-}"
stamp="${stamp%.sql.gz}"
uploads_backup="$BACKUP_DIR/tehus-crm-staging-uploads-$stamp.tar.gz"

# The legacy local script treats uploads as best effort. Off-site backup does
# not: a scheduled run is only successful when both protected assets exist.
backup_verify_sidecar "$database_backup"
backup_verify_sidecar "$uploads_backup"
gzip -t "$database_backup"
tar -tzf "$uploads_backup" >/dev/null
"$VERIFY_SCRIPT" "$(basename "$database_backup")"

backup_log "uploading the verified set with client-side encryption"
restic backup \
  --host "$RESTIC_HOST" \
  --tag "$BACKUP_RESTIC_TAG" \
  -- "$database_backup" "$database_backup.sha256" \
       "$uploads_backup" "$uploads_backup.sha256"

# Group by host and tag, not paths: artifact filenames change every day.
backup_log "applying off-site retention (7 daily, 4 weekly, 6 monthly)"
restic forget \
  --host "$RESTIC_HOST" \
  --tag "$BACKUP_RESTIC_TAG" \
  --group-by host,tags \
  --keep-daily 7 \
  --keep-weekly 4 \
  --keep-monthly 6 \
  --prune

backup_log "checking repository metadata and pack integrity"
restic check

backup_mark_succeeded
backup_log "encrypted off-site backup completed"
