#!/usr/bin/env bash
# Creates a compressed, checksummed pg_dump of the staging database (and a
# snapshot of the uploads volume). Intended to run from cron as the `deploy`
# user (see docs/VPS_DEPLOYMENT.md) or manually. Never prints POSTGRES_PASSWORD
# or any other secret.
#
# Atomicity guarantee: nothing is ever published under its FINAL name until it
# has been fully written AND validated (non-empty + gzip/tar integrity +
# checksum). All work happens in `*.partial` temp files that a trap removes on
# any failure, and the final artifact appears via an atomic rename. A failed
# pg_dump/gzip/tar can therefore never leave an incomplete file that looks valid.
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.staging.yml}"
ENV_FILE="${ENV_FILE:-.env.staging}"
BACKUP_DIR="${BACKUP_DIR:-/opt/tehus-crm/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
# The uploads named volume (compose project `name:` + _backend_uploads).
UPLOADS_VOLUME="${UPLOADS_VOLUME:-tehus-crm-staging_backend_uploads}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# --- temp-file tracking + trap ---------------------------------------------
# Only ever holds the exact *.partial paths this run created; the trap removes
# just those, never a directory or a glob. No rm -rf, ever.
PARTIALS=()
cleanup() {
  local ec=$?  # preserve the real exit code (rm below must not override it)
  local f
  for f in "${PARTIALS[@]:-}"; do
    [ -n "$f" ] && rm -f -- "$f" 2>/dev/null || true  # rm -f ignores missing files
  done
  exit "$ec"
}
trap cleanup EXIT

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found" >&2
  exit 1
fi

# Read only the three keys this script needs via grep/cut (docker compose's
# env_file allows unquoted values with spaces, which break bash `source`).
# Never echoed or written anywhere.
POSTGRES_USER="$(grep -m1 '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2-)"
POSTGRES_DB="$(grep -m1 '^POSTGRES_DB=' "$ENV_FILE" | cut -d= -f2-)"
POSTGRES_PASSWORD="$(grep -m1 '^POSTGRES_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
: "${POSTGRES_USER:?POSTGRES_USER missing from $ENV_FILE}"
: "${POSTGRES_DB:?POSTGRES_DB missing from $ENV_FILE}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD missing from $ENV_FILE}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

timestamp="$(date +%Y%m%d-%H%M%S)"

# Writes "<sha256>  <label>" (two spaces = the format `sha256sum -c` expects).
write_sidecar() { # <file-to-hash> <label-basename> <out-sidecar>
  sha256sum "$1" | awk -v f="$2" '{print $1"  "f}' > "$3"
}

# ---- Database dump ---------------------------------------------------------
db_final="$BACKUP_DIR/tehus-crm-staging-${timestamp}.sql.gz"
db_tmp="$db_final.partial"
db_sum_final="$db_final.sha256"
db_sum_tmp="$db_sum_final.partial"
PARTIALS+=("$db_tmp" "$db_sum_tmp")

# pipefail (from set -o pipefail) makes this fail if pg_dump OR gzip fails.
docker compose -f "$COMPOSE_FILE" exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=plain \
  | gzip > "$db_tmp"

[ -s "$db_tmp" ] || { echo "ERROR: DB dump is empty — aborting (nothing published)." >&2; exit 1; }
gzip -t "$db_tmp" || { echo "ERROR: DB dump failed gzip integrity — aborting." >&2; exit 1; }

write_sidecar "$db_tmp" "$(basename "$db_final")" "$db_sum_tmp"
chmod 600 "$db_tmp" "$db_sum_tmp"

# Publish atomically: validated dump first, then its checksum. Restore REQUIRES
# the sidecar, so even the sub-millisecond gap between these renames fails
# closed rather than accepting an unverified dump.
mv -f "$db_tmp" "$db_final"
mv -f "$db_sum_tmp" "$db_sum_final"
echo "DB backup created:  $db_final ($(du -h "$db_final" | cut -f1))"
echo "DB checksum:        $db_sum_final"

# ---- Uploads snapshot ------------------------------------------------------
# Best-effort and NON-FATAL: the DB dump above is the artifact a pre-migration
# rollback needs, so a uploads-snapshot problem (absent volume, tar error) must
# never abort the run once the DB backup is published. Still atomic/validated:
# a failed tar leaves no final file (the trap removes its .partial).
# `--force-local` keeps `tar -tzf` from treating a Windows `C:` path as a remote
# host (no-op on the Linux VPS, where paths have no colon).
snapshot_uploads() {
  local up_final="$BACKUP_DIR/tehus-crm-staging-uploads-${timestamp}.tar.gz"
  local up_tmp="$up_final.partial"
  local up_sum_final="$up_final.sha256"
  local up_sum_tmp="$up_sum_final.partial"

  if ! docker volume inspect "$UPLOADS_VOLUME" >/dev/null 2>&1; then
    echo "WARN: uploads volume '$UPLOADS_VOLUME' not found — skipped uploads backup" >&2
    return 0
  fi

  PARTIALS+=("$up_tmp" "$up_sum_tmp")
  # The container must stay root to read every file in the uploads volume
  # (they belong to the backend's unprivileged user), so the tarball is born
  # root-owned. Hand it to the invoking host user INSIDE the container, where
  # root may chown; a host-side chmod on a root-owned file is not permitted and
  # used to leave the archive 644 root:root (world-readable).
  local owner_expected
  owner_expected="$(id -u):$(id -g)"
  docker run --rm -v "$UPLOADS_VOLUME":/data:ro -v "$BACKUP_DIR":/backup alpine \
    sh -c 'umask 077 && tar czf "/backup/$1" -C /data . && chown "$2" "/backup/$1" && chmod 600 "/backup/$1"' \
    sh "$(basename "$up_tmp")" "$owner_expected" || return 1
  [ -s "$up_tmp" ] || return 1
  # Fail closed on ownership: a snapshot the backup user does not own cannot be
  # protected, verified, shipped by Restic or cleaned up by this user later.
  local owner_actual
  owner_actual="$(stat -c '%u:%g' "$up_tmp")"
  if [ "$owner_actual" != "$owner_expected" ]; then
    echo "ERROR: uploads snapshot is owned by $owner_actual, expected $owner_expected — not published." >&2
    return 1
  fi
  tar --force-local -tzf "$up_tmp" >/dev/null 2>&1 || return 1
  write_sidecar "$up_tmp" "$(basename "$up_final")" "$up_sum_tmp"
  chmod 600 "$up_tmp" "$up_sum_tmp" || return 1
  mv -f "$up_tmp" "$up_final"
  mv -f "$up_sum_tmp" "$up_sum_final"
  echo "Uploads backup:     $up_final ($(du -h "$up_final" | cut -f1))"
  return 0
}
if ! snapshot_uploads; then
  echo "WARN: uploads snapshot failed — DB backup is still valid; no partial uploads file left." >&2
fi

# ---- Retention -------------------------------------------------------------
# Scoped to THIS dir + the exact tehus-crm-staging-* names (dumps, uploads
# tarballs, .sha256 sidecars). Never a broad rm, never recursive, never
# .partial (those are the trap's job).
deleted="$(find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'tehus-crm-staging-*.sql.gz' -o -name 'tehus-crm-staging-*.sql.gz.sha256' \
     -o -name 'tehus-crm-staging-uploads-*.tar.gz' -o -name 'tehus-crm-staging-uploads-*.tar.gz.sha256' \) \
  -mtime "+$RETENTION_DAYS" -print -delete)"
if [ -n "$deleted" ]; then
  echo "Deleted backups older than $RETENTION_DAYS days:"
  echo "$deleted"
fi

exit 0
