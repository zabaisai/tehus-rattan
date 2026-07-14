#!/usr/bin/env bash
# Creates a compressed pg_dump of the staging database. Intended to run from
# cron as the `deploy` user (see docs/VPS_DEPLOYMENT.md for the crontab
# entry) or manually. Never prints POSTGRES_PASSWORD or any other secret.
set -euo pipefail

COMPOSE_FILE="docker-compose.staging.yml"
ENV_FILE=".env.staging"
BACKUP_DIR="/opt/tehus-crm/backups"
RETENTION_DAYS=7

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found" >&2
  exit 1
fi

# Read only the three keys this script actually needs, via grep/cut rather
# than `source` — docker compose's env_file format allows unquoted values
# with spaces (e.g. SUPER_ADMIN_NAME=Super Admin Staging), which is valid
# there but breaks bash `source` (it tries to run the extra words as a
# command). Never echoed or written anywhere.
POSTGRES_USER="$(grep -m1 '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2-)"
POSTGRES_DB="$(grep -m1 '^POSTGRES_DB=' "$ENV_FILE" | cut -d= -f2-)"
POSTGRES_PASSWORD="$(grep -m1 '^POSTGRES_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"

: "${POSTGRES_USER:?POSTGRES_USER missing from $ENV_FILE}"
: "${POSTGRES_DB:?POSTGRES_DB missing from $ENV_FILE}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD missing from $ENV_FILE}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

timestamp="$(date +%Y%m%d-%H%M%S)"
out_file="$BACKUP_DIR/tehus-crm-staging-${timestamp}.sql.gz"

docker compose -f "$COMPOSE_FILE" exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=plain \
  | gzip > "$out_file"

chmod 600 "$out_file"

if [ ! -s "$out_file" ]; then
  echo "ERROR: backup file is empty, deleting: $out_file" >&2
  rm -f "$out_file"
  exit 1
fi

echo "Backup created: $out_file ($(du -h "$out_file" | cut -f1))"

# Staging retention policy: keep 7 days locally. Production will additionally
# need an off-VPS copy (S3/other host) — not implemented yet, see
# docs/VPS_DEPLOYMENT.md "checklist antes de producción".
deleted="$(find "$BACKUP_DIR" -name 'tehus-crm-staging-*.sql.gz' -type f -mtime "+$RETENTION_DAYS" -print -delete)"
if [ -n "$deleted" ]; then
  echo "Deleted backups older than $RETENTION_DAYS days:"
  echo "$deleted"
fi

exit 0
