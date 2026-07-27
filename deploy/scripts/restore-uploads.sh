#!/usr/bin/env bash
# Restores an uploads tarball produced by backup-postgres.sh into the uploads
# volume. Only ever touches that ONE volume — never postgres_data, caddy_data,
# or anything else.
#
# Usage:
#   ./restore-uploads.sh <uploads-tar-filename> [--volume NAME]
#
# Safety properties:
#   - The .sha256 sidecar is MANDATORY; missing/mismatched checksum aborts.
#   - The gzip/tar stream is integrity-checked (tar -tzf).
#   - The archive is REJECTED before extraction if any member is an absolute
#     path, a `..` traversal, or a symlink/hardlink pointing outside the volume.
#   - The CURRENT volume contents are snapshotted (checksummed) before replacing.
#   - The backend is stopped during the swap and ALWAYS restarted (trap).
#   - Extraction is confined to the target volume (mounted alone at /data).
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.staging.yml}"
BACKUP_DIR="${BACKUP_DIR:-/opt/tehus-crm/backups}"
# Default uploads volume: compose project `name:` + _backend_uploads.
DEFAULT_VOLUME="tehus-crm-staging_backend_uploads"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# ---- args ------------------------------------------------------------------
TAR_NAME=""
VOLUME="$DEFAULT_VOLUME"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --volume) VOLUME="${2:?--volume requires a name}"; shift 2 ;;
    -*) echo "ERROR: unknown option: $1" >&2; exit 2 ;;
    *) if [ -z "$TAR_NAME" ]; then TAR_NAME="$1"; shift; else echo "ERROR: unexpected argument: $1" >&2; exit 2; fi ;;
  esac
done

if [ -z "$TAR_NAME" ]; then
  echo "Usage: $0 <uploads-tar-filename> [--volume NAME]   (default volume: $DEFAULT_VOLUME)" >&2
  echo "Available uploads backups in $BACKUP_DIR:" >&2
  ls -1 "$BACKUP_DIR" 2>/dev/null | grep -E 'uploads-.*\.tar\.gz$' | grep -vE '\.sha256$|\.partial$' >&2 || echo "  (none found)" >&2
  exit 1
fi

# Docker volume names are restricted; validate to avoid injecting into commands.
printf '%s' "$VOLUME" | grep -qE '^[A-Za-z0-9][A-Za-z0-9_.-]+$' \
  || { echo "ERROR: invalid volume name '$VOLUME'." >&2; exit 1; }

TAR_PATH="$BACKUP_DIR/$TAR_NAME"
[ -f "$TAR_PATH" ] || { echo "ERROR: uploads backup not found: $TAR_PATH" >&2; exit 1; }

# ---- MANDATORY integrity gate ----------------------------------------------
[ -f "$TAR_PATH.sha256" ] || { echo "ERROR: required checksum '$TAR_NAME.sha256' is missing — refusing." >&2; exit 1; }
echo "Verifying SHA-256..."
( cd "$BACKUP_DIR" && sha256sum -c "$TAR_NAME.sha256" ) \
  || { echo "ERROR: checksum verification FAILED — aborting." >&2; exit 1; }
echo "Verifying tar integrity..."
tar --force-local -tzf "$TAR_PATH" >/dev/null \
  || { echo "ERROR: $TAR_NAME is not a valid tar.gz — aborting." >&2; exit 1; }

# ---- reject dangerous members BEFORE extraction ----------------------------
# Absolute paths, `..` traversal, and symlinks/hardlinks pointing outside are
# all rejected — the archive is treated as hostile until proven safe.
echo "Scanning archive for unsafe paths / links..."
listing="$(tar --force-local -tzvf "$TAR_PATH")"
# Names (for absolute/`..` checks)
if printf '%s\n' "$listing" | awk '{print $NF}' | grep -qE '(^/|(^|/)\.\.($|/))'; then
  echo "ERROR: archive contains an absolute path or '..' traversal — refusing to extract." >&2
  exit 1
fi
# Link targets (tar -tv prints `... path -> target` for sym/hard links)
if printf '%s\n' "$listing" | grep -E ' -> ' | awk -F' -> ' '{print $2}' | grep -qE '(^/|(^|/)\.\.($|/))'; then
  echo "ERROR: archive contains a link pointing outside the volume — refusing to extract." >&2
  exit 1
fi
echo "Archive paths are safe."

docker volume inspect "$VOLUME" >/dev/null 2>&1 \
  || { echo "ERROR: target volume '$VOLUME' does not exist." >&2; exit 1; }

# ---- confirmation ----------------------------------------------------------
echo "About to REPLACE the contents of volume: $VOLUME"
read -r -p "Type the volume name exactly to confirm: " confirm_vol
[ "$confirm_vol" = "$VOLUME" ] || { echo "Confirmation did not match. Aborting — nothing changed." >&2; exit 1; }

# ---- safety snapshot of the CURRENT volume ---------------------------------
mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
ts="$(date +%Y%m%d-%H%M%S)"
pre="$BACKUP_DIR/tehus-crm-staging-uploads-pre-restore-${ts}.tar.gz"
pre_tmp="$pre.partial"
cleanup() {
  local ec=$?
  [ -e "$pre_tmp" ] && rm -f -- "$pre_tmp" 2>/dev/null || true
  if [ "${backend_stopped:-false}" = true ]; then
    echo "Ensuring backend is running again..."
    docker compose -f "$COMPOSE_FILE" start backend >/dev/null 2>&1 || true
  fi
  exit "$ec"
}
trap cleanup EXIT

echo "Snapshotting current volume contents to $pre ..."
docker run --rm -v "$VOLUME":/data:ro -v "$BACKUP_DIR":/backup alpine \
  tar czf "/backup/$(basename "$pre_tmp")" -C /data .
tar --force-local -tzf "$pre_tmp" >/dev/null || { echo "ERROR: pre-restore snapshot failed integrity." >&2; exit 1; }
sha256sum "$pre_tmp" | awk -v f="$(basename "$pre")" '{print $1"  "f}' > "$pre.sha256"
chmod 600 "$pre.sha256"
mv -f "$pre_tmp" "$pre"
echo "Pre-restore snapshot saved (roll back to it if needed)."

# ---- stop backend, wipe ONLY the target volume, extract --------------------
echo "Stopping backend..."
docker compose -f "$COMPOSE_FILE" stop backend
backend_stopped=true

echo "Restoring into volume '$VOLUME' (clean)..."
# Everything below runs in a container that mounts ONLY the target volume at
# /data (+ the backup dir read-only). It cannot reach any other volume or the
# host. `find -mindepth 1 -delete` clears contents but keeps the volume root
# (and its ownership); extraction then repopulates and ownership is normalized
# to the volume root's uid:gid (the backend user).
docker run --rm -v "$VOLUME":/data -v "$BACKUP_DIR":/backup:ro alpine sh -c '
  set -e
  find /data -mindepth 1 -delete
  tar xzf "/backup/$1" -C /data
  owner="$(stat -c "%u:%g" /data)"
  chown -R "$owner" /data
' _ "$TAR_NAME"

# ---- verify + restart ------------------------------------------------------
count="$(docker run --rm -v "$VOLUME":/data:ro alpine sh -c 'find /data -type f | wc -l')"
echo "Restored files in volume: $count"

echo "Restarting backend..."
docker compose -f "$COMPOSE_FILE" start backend
backend_stopped=false

echo "Uploads restore finished from $TAR_NAME into volume '$VOLUME'."
echo "Pre-restore snapshot: $pre"
