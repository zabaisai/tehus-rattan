#!/usr/bin/env bash
# Verifies a backup produced by backup-postgres.sh WITHOUT touching any
# database: checks the SHA-256 sidecar and that the gzip stream is intact
# (decompresses fully). Safe to run any time — read-only.
#
# Usage: ./backup-verify.sh <backup-filename>
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/tehus-crm/backups}"

if [ "${1:-}" = "" ]; then
  echo "Usage: $0 <backup-filename>" >&2
  echo "" >&2
  echo "Available backups in $BACKUP_DIR:" >&2
  ls -1 "$BACKUP_DIR" 2>/dev/null | grep -vE '\.sha256$' >&2 || echo "  (none found)" >&2
  exit 1
fi

BACKUP_NAME="$1"
BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"

if [ ! -f "$BACKUP_PATH" ]; then
  echo "ERROR: backup not found: $BACKUP_PATH" >&2
  exit 1
fi

# 1) checksum
if [ -f "$BACKUP_PATH.sha256" ]; then
  echo "Checking SHA-256..."
  ( cd "$BACKUP_DIR" && sha256sum -c "$BACKUP_NAME.sha256" )
else
  echo "ERROR: no checksum sidecar ($BACKUP_NAME.sha256) — cannot verify integrity." >&2
  exit 1
fi

# 2) gzip integrity (decompress to /dev/null; fails on truncation/corruption)
echo "Checking gzip integrity..."
if gzip -t "$BACKUP_PATH" 2>/dev/null || gunzip -t "$BACKUP_PATH" 2>/dev/null; then
  echo "OK: $BACKUP_NAME passed checksum + gzip integrity checks."
else
  echo "ERROR: $BACKUP_NAME is not a valid gzip stream (corrupted/truncated)." >&2
  exit 1
fi
