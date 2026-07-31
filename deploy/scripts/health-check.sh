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

for svc in postgres redis backend worker frontend caddy; do
  state="$(docker compose -f "$COMPOSE_FILE" ps -q "$svc" | xargs -r docker inspect -f '{{.State.Status}}' 2>/dev/null)"
  if [ "$state" = "running" ]; then
    ok "$svc container is running"
  else
    bad "$svc container is not running (state: ${state:-not found})"
  fi
done

echo ""
echo "== Durable queue (informational, NEVER fails the deploy) =="
# La cola caida degrada el procesamiento diferido, no el CRM: por eso este
# bloque informa y no marca el despliegue como fallido. El endpoint devuelve
# 200 siempre, con state=up|down|disabled.
queue_json="$(docker compose -f "$COMPOSE_FILE" exec -T backend wget -qO- http://127.0.0.1:3001/api/health/queue 2>/dev/null || true)"
case "$queue_json" in
  *'"state":"up"'*)       ok "queue reachable (state: up)" ;;
  *'"state":"disabled"'*) ok "queue disabled by configuration (QUEUE_ENABLED=false)" ;;
  *'"state":"down"'*)     warn "queue unreachable (state: down) - deferred processing degraded, CRM still serving" ;;
  *)                      warn "could not read queue state" ;;
esac

echo ""
echo "== System health (aggregate: db + queue + worker + outbox + realtime) =="
# Responde una pregunta distinta de /api/health: no es "¿atiende?" sino
# "¿esta el sistema haciendo TODO su trabajo?". Con Redis o el worker caidos
# las conversaciones se guardan y la interfaz responde, asi que las sondas
# clasicas dan verde mientras los efectos de cada mensaje entrante se acumulan
# sin procesar. Aqui eso sale como "degraded".
sys_json="$(docker compose -f "$COMPOSE_FILE" exec -T backend wget -qO- http://127.0.0.1:3001/api/health/status 2>/dev/null || true)"
case "$sys_json" in
  *'"status":"ok"'*)       ok "system fully healthy (status: ok)" ;;
  *'"status":"degraded"'*) warn "system DEGRADED - the CRM serves, but something is not being processed. Detail:" ;;
  *'"status":"down"'*)     bad "system down (status: down)" ;;
  *)                       warn "could not read aggregate system status" ;;
esac
# Con degradacion se imprime el detalle por componente: sin el, "degraded" no
# dice a quien llamar.
case "$sys_json" in
  *'"status":"degraded"'*)
    for comp in queue worker outbox realtime; do
      estado="$(printf '%s' "$sys_json" | sed -n "s/.*\"$comp\":{\"state\":\"\([a-z]*\)\".*/\1/p")"
      [ -n "$estado" ] && echo "     - $comp: $estado"
    done
    ;;
esac

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
