#!/usr/bin/env bash
# Staging deploy procedure. Run from the repo root on the VPS (e.g.
# /opt/tehus-crm) as the `deploy` user:
#   ./deploy/scripts/deploy.sh
#
# Never prints secrets. Never runs `down -v` or deletes volumes. Always
# deploys from `main` — refuses to run on any other branch.
set -euo pipefail

COMPOSE_FILE="docker-compose.staging.yml"
ENV_FILE=".env.staging"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$REPO_ROOT"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
fail() { printf '\033[1;31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

log "1/10 Verifying current branch is main"
current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$current_branch" != "main" ]; then
  fail "Refusing to deploy from branch '$current_branch' — checkout main first."
fi

log "2/12 Fetching and fast-forwarding main"
# Record the currently-deployed commit BEFORE moving — this is the exact SHA to
# roll the CODE back to if the deploy fails (see docs/DEPLOYMENT_RUNBOOK.md).
PREVIOUS_SHA="$(git rev-parse HEAD)"
echo "Previous (rollback) commit: $(git log -1 --oneline "$PREVIOUS_SHA")"
git fetch origin
git pull --ff-only origin main
export GIT_SHA="$(git rev-parse HEAD)"
export BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Deploying commit: $(git log -1 --oneline)"

log "3/12 Validating $ENV_FILE exists and is not world/group-readable"
if [ ! -f "$ENV_FILE" ]; then
  fail "$ENV_FILE not found. Copy deploy/env/staging.env.example, fill it in, chmod 600, and retry."
fi
perms="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%A' "$ENV_FILE")"
if [ "$perms" != "600" ]; then
  fail "$ENV_FILE permissions are $perms, expected 600. Run: chmod 600 $ENV_FILE"
fi

log "4/12 Building images (release $GIT_SHA)"
compose build

log "5/12 Starting PostgreSQL"
compose up -d postgres

log "6/12 Waiting for PostgreSQL healthcheck"
attempts=0
max_attempts=30
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q postgres)" 2>/dev/null)" = "healthy" ]; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge "$max_attempts" ]; then
    fail "PostgreSQL did not become healthy in time. Check: docker compose -f $COMPOSE_FILE logs postgres"
  fi
  sleep 2
done
echo "PostgreSQL is healthy."

log "7/12 Pre-migration backup (DB + uploads, checksummed)"
# A migration is the one irreversible step; snapshot BEFORE it so a bad
# migration can be recovered by restore-postgres.sh. Never skip.
"$SCRIPT_DIR/backup-postgres.sh" || fail "Pre-migration backup failed — aborting before touching the schema."

log "8/12 Running Prisma migrations (migrate deploy — never migrate dev/reset)"
compose run --rm backend npx prisma migrate deploy

log "9/12 Starting all services"
compose up -d

log "10/12 Current service status"
compose ps

log "11/12 Running health-check.sh"
"$SCRIPT_DIR/health-check.sh" || fail "Health check failed — inspect logs. To roll back CODE: git checkout $PREVIOUS_SHA && ./deploy/scripts/deploy.sh; to roll back the DATABASE, restore the pre-migration backup with restore-postgres.sh (see docs/DEPLOYMENT_RUNBOOK.md)."

log "12/12 Deployed release $GIT_SHA (rollback target: $PREVIOUS_SHA)"
log "Deploy complete."
