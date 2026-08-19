#!/usr/bin/env bash
# Shared, deliberately small helpers for encrypted off-site backups.
set -euo pipefail

backup_log() {
  printf '[backup] %s\n' "$*"
}

backup_warn() {
  printf '[backup] WARNING: %s\n' "$*" >&2
}

backup_die() {
  printf '[backup] ERROR: %s\n' "$*" >&2
  exit 1
}

backup_require_command() {
  command -v "$1" >/dev/null 2>&1 || backup_die "required command not found: $1"
}

backup_require_value() {
  local name="$1"
  [ -n "${!name:-}" ] || backup_die "$name is required"
}

backup_validate_restic_environment() {
  backup_require_command restic
  backup_require_value RESTIC_REPOSITORY
  backup_require_value RESTIC_PASSWORD_FILE
  backup_require_value AWS_ACCESS_KEY_ID
  backup_require_value AWS_SECRET_ACCESS_KEY

  [ -f "$RESTIC_PASSWORD_FILE" ] \
    || backup_die "RESTIC_PASSWORD_FILE does not exist"
  [ -r "$RESTIC_PASSWORD_FILE" ] \
    || backup_die "RESTIC_PASSWORD_FILE is not readable by the backup user"

  local mode
  mode="$(stat -c '%a' "$RESTIC_PASSWORD_FILE")"
  case "$mode" in
    400|600) ;;
    *) backup_die "RESTIC_PASSWORD_FILE must have mode 400 or 600 (current: $mode)" ;;
  esac
}

backup_heartbeat() {
  local suffix="${1:-}"
  [ -n "${BACKUP_HEARTBEAT_URL:-}" ] || return 0

  if ! curl --fail --silent --show-error --max-time 15 \
      --retry 2 --output /dev/null \
      "${BACKUP_HEARTBEAT_URL%/}${suffix}"; then
    backup_warn "the external heartbeat could not be delivered"
  fi
}

backup_enable_heartbeat_trap() {
  BACKUP_OPERATION_SUCCEEDED=false
  backup_require_command curl
  backup_heartbeat "/start"
  trap 'backup_finish_with_heartbeat' EXIT
}

backup_mark_succeeded() {
  BACKUP_OPERATION_SUCCEEDED=true
}

backup_finish_with_heartbeat() {
  local exit_code="${1:-$?}"
  trap - EXIT

  if [ "$exit_code" -eq 0 ] && [ "${BACKUP_OPERATION_SUCCEEDED:-false}" = true ]; then
    backup_heartbeat ""
  else
    backup_heartbeat "/fail"
  fi

  exit "$exit_code"
}

backup_verify_sidecar() {
  local file="$1"
  local directory
  directory="$(dirname "$file")"

  [ -f "$file" ] || backup_die "backup artifact is missing: $file"
  [ -f "$file.sha256" ] || backup_die "checksum sidecar is missing: $file.sha256"
  (cd "$directory" && sha256sum -c "$(basename "$file").sha256")
}
