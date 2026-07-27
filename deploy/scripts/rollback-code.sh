#!/usr/bin/env bash
# Rolls the CODE back to a previous commit by rebuilding its images — without
# touching the database, main, or any remote. It builds the old commit in an
# isolated git worktree, verifies the built image reports the expected release
# SHA (build-time label AND, if a DB URL is supplied, the running
# /api/health/version), and prints the exact commands to swap those images into
# the live staging stack.
#
# Usage:
#   ./rollback-code.sh <PREVIOUS_SHA>
#
# Env:
#   ROLLBACK_DB_URL   If set, the script boots the rebuilt backend against it and
#                     asserts GET /api/health/version == PREVIOUS_SHA at runtime.
#                     If unset, only the image label is checked (no boot).
#   NEXT_PUBLIC_API_URL  If set, the frontend image is also rebuilt + labelled.
#
# Guarantees: never `git reset --hard`, never force-push, never changes a branch
# or the remote, never runs a migration, never drops a DB. The main checkout
# stays exactly where it is; the temporary worktree is always removed (trap).
set -euo pipefail

SHA_INPUT="${1:-}"
[ -n "$SHA_INPUT" ] || { echo "Usage: $0 <PREVIOUS_SHA>" >&2; exit 2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# ---- validate the SHA ------------------------------------------------------
SHA="$(git rev-parse --verify --quiet "${SHA_INPUT}^{commit}" || true)"
[ -n "$SHA" ] || { echo "ERROR: '$SHA_INPUT' is not a valid commit in this repository." >&2; exit 1; }
SHORT="$(git rev-parse --short "$SHA")"

# Must be an ANCESTOR of the current HEAD — i.e. a real prior commit we are
# rolling back TO, never an arbitrary/unrelated or future commit.
if ! git merge-base --is-ancestor "$SHA" HEAD; then
  echo "ERROR: $SHORT is not an ancestor of HEAD — refusing (only roll back to a prior commit)." >&2
  exit 1
fi
if [ "$SHA" = "$(git rev-parse HEAD)" ]; then
  echo "ERROR: $SHORT is the current HEAD — nothing to roll back to." >&2
  exit 1
fi

# Working tree must be clean so nothing uncommitted is lost or built by mistake.
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: working tree is not clean. Commit or stash your changes first." >&2
  exit 1
fi

BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
WT="$(mktemp -d "${TMPDIR:-/tmp}/tehus-rollback-XXXXXX")"
BE_IMAGE="tehus-backend:rollback-$SHORT"
FE_IMAGE="tehus-frontend:rollback-$SHORT"
VERIFY_CT="tehus-rollback-verify-$SHORT"

cleanup() {
  local ec=$?
  docker rm -f "$VERIFY_CT" >/dev/null 2>&1 || true
  # Remove the temporary worktree (registered below). Never touches the main checkout.
  git worktree remove --force "$WT" >/dev/null 2>&1 || true
  rmdir "$WT" >/dev/null 2>&1 || true
  exit "$ec"
}
trap cleanup EXIT

# ---- isolated worktree at the old SHA --------------------------------------
echo "Creating isolated worktree at $SHORT ..."
# --detach so we do not move or create any branch; the main checkout is untouched.
git worktree add --detach "$WT" "$SHA" >/dev/null
echo "Main checkout stays on: $(git rev-parse --abbrev-ref HEAD) ($(git rev-parse --short HEAD))"

# ---- build the rolled-back images ------------------------------------------
echo "Building backend image from $SHORT ..."
docker build \
  --build-arg GIT_SHA="$SHA" \
  --build-arg BUILD_TIME="$BUILD_TIME" \
  -t "$BE_IMAGE" "$WT/apps/backend" >/dev/null

label="$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$BE_IMAGE" 2>/dev/null || true)"
[ "$label" = "$SHA" ] || { echo "ERROR: built image revision label '$label' != $SHA." >&2; exit 1; }
echo "Backend image built and labelled with $SHORT."

if [ -n "${NEXT_PUBLIC_API_URL:-}" ]; then
  echo "Building frontend image from $SHORT ..."
  docker build \
    --build-arg GIT_SHA="$SHA" \
    --build-arg NEXT_PUBLIC_API_URL="$NEXT_PUBLIC_API_URL" \
    -t "$FE_IMAGE" "$WT/apps/frontend" >/dev/null
  echo "Frontend image built."
else
  echo "NOTE: NEXT_PUBLIC_API_URL not set — skipping frontend rebuild (set it to rebuild the frontend too)."
fi

# ---- runtime version verification (optional, needs a DB) -------------------
if [ -n "${ROLLBACK_DB_URL:-}" ]; then
  echo "Booting rebuilt backend to verify /api/health/version ..."
  docker run -d --init --name "$VERIFY_CT" -p 0:3001 \
    -e DATABASE_URL="$ROLLBACK_DB_URL" -e JWT_SECRET=rollback-verify -e NODE_ENV=production \
    "$BE_IMAGE" >/dev/null
  port="$(docker port "$VERIFY_CT" 3001/tcp | head -1 | sed 's/.*://')"
  ok=false
  for _ in $(seq 1 30); do
    if curl -s "http://localhost:$port/api/health/live" | grep -q '"status":"ok"'; then ok=true; break; fi
    sleep 1
  done
  [ "$ok" = true ] || { echo "ERROR: rebuilt backend did not become live." >&2; exit 1; }
  version_body="$(curl -s "http://localhost:$port/api/health/version")"
  echo "$version_body" | grep -q "\"release\":\"$SHA\"" \
    || { echo "ERROR: /api/health/version does not report $SHORT: $version_body" >&2; exit 1; }
  echo "Runtime /api/health/version confirms release $SHORT."
  docker rm -f "$VERIFY_CT" >/dev/null 2>&1 || true
else
  echo "NOTE: ROLLBACK_DB_URL not set — verified the image label only (no runtime boot)."
fi

# ---- next steps ------------------------------------------------------------
cat <<EOF

Rolled-back images are ready:
  backend : $BE_IMAGE  (release $SHORT)
$( [ -n "${NEXT_PUBLIC_API_URL:-}" ] && echo "  frontend: $FE_IMAGE" )

To put them live on the staging host (recreates ONLY the app containers; the
postgres and caddy containers and all volumes are left as-is):

  cd "$REPO_ROOT"
  git worktree add --detach ../rollback-$SHORT $SHORT
  cp .env.staging ../rollback-$SHORT/.env.staging
  cd ../rollback-$SHORT
  GIT_SHA=$SHA BUILD_TIME=$BUILD_TIME NEXT_PUBLIC_API_URL=<staging-api-url> \\
    docker compose --env-file .env.staging -f docker-compose.staging.yml up -d --build --no-deps backend frontend
  ./deploy/scripts/smoke-test.sh   # EXPECTED_RELEASE=$SHA
  cd - && git worktree remove --force ../rollback-$SHORT

IMPORTANT: this rolls back CODE only. If the newer release ran a schema
migration that the old code cannot use, you must ALSO restore the matching
pre-migration backup:
  ./deploy/scripts/restore-postgres.sh <pre-migration-db-backup>
  ./deploy/scripts/restore-uploads.sh  <matching-uploads-backup>   # if uploads changed

To return to the CURRENT release later: checkout the branch/main and re-run
./deploy/scripts/deploy.sh (it rebuilds from the current commit).
EOF

echo ""
echo "Code rollback preparation for $SHORT complete."
