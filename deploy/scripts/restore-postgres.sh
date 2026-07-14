#!/usr/bin/env bash
# Restores a named backup produced by backup-postgres.sh.
#
# Usage:
#   ./restore-postgres.sh <backup-filename>                  # restores into the live staging DB
#   ./restore-postgres.sh <backup-filename> --target-db NAME # restores into a separate/temporary DB instead
#
# Deliberately requires the exact backup filename — never guesses or picks
# "the latest" one. Restoring into the live database (no --target-db) stops
# the backend container for the duration of the restore and restarts it
# afterwards; the frontend keeps running but API calls will fail until the
# backend is back up. This script is never invoked automatically by
# deploy.sh — it only ever runs when a human runs it deliberately.
set -euo pipefail

COMPOSE_FILE="docker-compose.staging.yml"
ENV_FILE=".env.staging"
BACKUP_DIR="/opt/tehus-crm/backups"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

if [ "${1:-}" = "" ]; then
  echo "Usage: $0 <backup-filename> [--target-db <db-name>]" >&2
  echo "" >&2
  echo "Available backups in $BACKUP_DIR:" >&2
  ls -1 "$BACKUP_DIR" 2>/dev/null >&2 || echo "  (none found)" >&2
  exit 1
fi

BACKUP_NAME="$1"
shift
TARGET_DB_OVERRIDE=""
if [ "${1:-}" = "--target-db" ]; then
  TARGET_DB_OVERRIDE="${2:?--target-db requires a database name}"
fi

BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"
if [ ! -f "$BACKUP_PATH" ]; then
  echo "ERROR: backup not found: $BACKUP_PATH" >&2
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found" >&2
  exit 1
fi

# Read only the three keys this script needs via grep/cut rather than
# `source` — see backup-postgres.sh for why: unquoted values with spaces
# (e.g. SUPER_ADMIN_NAME) are valid for docker compose's env_file format but
# break bash `source`.
POSTGRES_USER="$(grep -m1 '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2-)"
POSTGRES_DB="$(grep -m1 '^POSTGRES_DB=' "$ENV_FILE" | cut -d= -f2-)"
POSTGRES_PASSWORD="$(grep -m1 '^POSTGRES_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
: "${POSTGRES_USER:?POSTGRES_USER missing from $ENV_FILE}"
: "${POSTGRES_DB:?POSTGRES_DB missing from $ENV_FILE}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD missing from $ENV_FILE}"

TARGET_DB="${TARGET_DB_OVERRIDE:-$POSTGRES_DB}"
restoring_live=false
[ "$TARGET_DB" = "$POSTGRES_DB" ] && restoring_live=true

echo "About to restore:"
echo "  Backup file : $BACKUP_PATH"
echo "  Target DB   : $TARGET_DB"
if [ "$restoring_live" = true ]; then
  echo "  This IS the live staging database. The backend container will be"
  echo "  stopped for the duration of the restore and restarted afterwards."
fi
echo ""
read -r -p "Type the target database name exactly to confirm and proceed: " confirm_db
if [ "$confirm_db" != "$TARGET_DB" ]; then
  echo "Confirmation did not match '$TARGET_DB'. Aborting — nothing was changed." >&2
  exit 1
fi

if [ "$restoring_live" = true ]; then
  echo "Stopping backend..."
  docker compose -f "$COMPOSE_FILE" stop backend
else
  exists="$(docker compose -f "$COMPOSE_FILE" exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
    psql -U "$POSTGRES_USER" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '$TARGET_DB'")"
  if [ "$exists" != "1" ]; then
    echo "Creating temporary database: $TARGET_DB"
    docker compose -f "$COMPOSE_FILE" exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
      createdb -U "$POSTGRES_USER" "$TARGET_DB"
  fi
fi

echo "Restoring $BACKUP_NAME into $TARGET_DB ..."
gunzip -c "$BACKUP_PATH" | docker compose -f "$COMPOSE_FILE" exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  psql -U "$POSTGRES_USER" -d "$TARGET_DB"

if [ "$restoring_live" = true ]; then
  echo "Restarting backend..."
  docker compose -f "$COMPOSE_FILE" start backend
  echo "Restore finished. Live staging database restored from $BACKUP_NAME."
else
  echo "Restore finished into temporary database '$TARGET_DB'."
  echo "Remember to drop it once you're done testing:"
  echo "  docker compose -f $COMPOSE_FILE exec -e PGPASSWORD=**** postgres dropdb -U $POSTGRES_USER $TARGET_DB"
fi
