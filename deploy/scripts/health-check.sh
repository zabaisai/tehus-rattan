#!/usr/bin/env bash
# Validates the staging stack is actually serving traffic. Never prints
# secrets (no env file is read here). Safe to run repeatedly and outside of
# deploy.sh (e.g. from cron or manually after a restart).
set -uo pipefail

COMPOSE_FILE="docker-compose.staging.yml"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

FRONTEND_DOMAIN="${FRONTEND_DOMAIN:-crm-staging.tehusrattan.com}"
API_DOMAIN="${API_DOMAIN:-api.crm-staging.tehusrattan.com}"

failures=0
warn() { printf '\033[1;33mWARN: %s\033[0m\n' "$1"; }
ok()   { printf '\033[1;32mOK:   %s\033[0m\n' "$1"; }
bad()  { printf '\033[1;31mFAIL: %s\033[0m\n' "$1"; failures=$((failures + 1)); }

echo "== Container status =="
docker compose -f "$COMPOSE_FILE" ps

for svc in postgres backend frontend caddy; do
  state="$(docker compose -f "$COMPOSE_FILE" ps -q "$svc" | xargs -r docker inspect -f '{{.State.Status}}' 2>/dev/null)"
  if [ "$state" = "running" ]; then
    ok "$svc container is running"
  else
    bad "$svc container is not running (state: ${state:-not found})"
  fi
done

echo ""
echo "== Backend health (internal, container-to-container) =="
if docker compose -f "$COMPOSE_FILE" exec -T backend wget -qO- http://127.0.0.1:3001/api/health | grep -q '"status":"ok"'; then
  ok "backend /api/health responds ok (internal)"
else
  bad "backend /api/health did not respond as expected (internal)"
fi

echo ""
echo "== Frontend responds (internal) =="
if docker compose -f "$COMPOSE_FILE" exec -T frontend wget -qO- -S http://127.0.0.1:3000/ >/dev/null 2>&1; then
  ok "frontend responds (internal)"
else
  bad "frontend did not respond (internal)"
fi

echo ""
echo "== Public HTTPS (requires DNS pointing at this VPS) =="
if getent hosts "$API_DOMAIN" >/dev/null 2>&1 || nslookup "$API_DOMAIN" >/dev/null 2>&1; then
  if curl -fsS -o /dev/null "https://$API_DOMAIN/api/health"; then
    ok "https://$API_DOMAIN/api/health reachable with a valid certificate"
  else
    bad "https://$API_DOMAIN/api/health did not respond (DNS resolves, but HTTPS/Caddy/backend check failed)"
  fi

  if curl -fsS -o /dev/null "https://$FRONTEND_DOMAIN/login"; then
    ok "https://$FRONTEND_DOMAIN/login reachable with a valid certificate"
  else
    bad "https://$FRONTEND_DOMAIN/login did not respond"
  fi
else
  warn "$API_DOMAIN / $FRONTEND_DOMAIN do not resolve yet — skipping HTTPS checks (expected before DNS is configured)"
fi

echo ""
if [ "$failures" -eq 0 ]; then
  echo "All checks passed."
  exit 0
else
  echo "$failures check(s) failed."
  exit 1
fi
