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

backup_require_secure_file() {
  local file="$1"
  local label="$2"
  local mode

  [ -f "$file" ] || backup_die "$label does not exist"
  [ -r "$file" ] || backup_die "$label is not readable by the backup user"

  mode="$(stat -c '%a' "$file")"
  case "$mode" in
    400|600) ;;
    *) backup_die "$label must have mode 400 or 600 (current: $mode)" ;;
  esac
}

backup_validate_restic_environment() {
  backup_require_command restic
  backup_require_value RESTIC_REPOSITORY
  backup_require_value RESTIC_PASSWORD_FILE
  backup_require_secure_file "$RESTIC_PASSWORD_FILE" "RESTIC_PASSWORD_FILE"

  # Backend-specific credentials are mutually exclusive. S3 needs AWS keys;
  # rclone needs only its own protected config/OAuth token.
  case "$RESTIC_REPOSITORY" in
    s3:*)
      backup_require_value AWS_ACCESS_KEY_ID
      backup_require_value AWS_SECRET_ACCESS_KEY
      ;;
    rclone:*)
      backup_require_command rclone
      backup_require_value RCLONE_CONFIG
      backup_require_secure_file "$RCLONE_CONFIG" "RCLONE_CONFIG"
      ;;
    *)
      backup_die "unsupported RESTIC_REPOSITORY backend; expected s3: or rclone:"
      ;;
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

# Validate an uploads tarball as hostile input before any extraction. GNU tar
# normalizes unsafe hard-link targets while listing them and emits a warning;
# failing closed on every tar warning preserves the original unsafe condition.
backup_validate_tar_archive() {
  local archive="$1"
  local names listing member target

  [ -f "$archive" ] || backup_die "uploads archive does not exist: $archive"

  if ! names="$(tar --force-local --quoting-style=escape -tzf "$archive" 2>&1)"; then
    backup_die "uploads archive is not a valid tar.gz"
  fi
  if printf '%s\n' "$names" | grep -q '^tar:'; then
    backup_die "uploads archive contains unsafe member or hard-link metadata"
  fi

  while IFS= read -r member; do
    [ -n "$member" ] || continue
    case "$member" in
      /*) backup_die "uploads archive contains an absolute path" ;;
    esac
    if printf '%s\n' "$member" | grep -qE '(^|/)\.\.($|/)'; then
      backup_die "uploads archive contains '..' path traversal"
    fi
  done <<<"$names"

  if ! listing="$(tar --force-local --quoting-style=escape -tzvf "$archive" 2>&1)"; then
    backup_die "uploads archive cannot be listed safely"
  fi
  if printf '%s\n' "$listing" | grep -q '^tar:'; then
    backup_die "uploads archive contains unsafe link metadata"
  fi

  while IFS= read -r member; do
    case "$member" in
      l*" -> "*)
        target="${member##* -> }"
        case "$target" in
          /*) backup_die "uploads archive contains an absolute symlink target" ;;
        esac
        if printf '%s\n' "$target" | grep -qE '(^|/)\.\.($|/)'; then
          backup_die "uploads archive contains a symlink escaping the restore root"
        fi
        ;;
    esac
  done <<<"$listing"
}
