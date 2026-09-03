#!/usr/bin/env bash
# Post-deploy smoke test. READ-ONLY: never creates, mutates, or deletes data,
# and never calls Meta. Safe to run against staging after every deploy.
#
# Config (env or defaults for a local run):
#   BASE_URL          atajo: fija FRONTEND_URL=$BASE_URL y API_URL=$BASE_URL/api
#   API_URL           default http://localhost:3001/api
#   FRONTEND_URL      default http://localhost:3000
#   ALLOWED_ORIGIN    default = FRONTEND_URL   (expected CORS origin)
#   EXPECTED_RELEASE  optional git SHA to assert /health/version matches
#   CURL_OPTS         optional extra curl flags (e.g. -k for a staging cert)
#
# CONTRA STAGING HAY QUE PASAR EL DOMINIO PUBLICO, no localhost:
#
#   BASE_URL=https://crm-staging.takto.online ./smoke-test.sh
#
# Los puertos 3000/3001 NO estan publicados en el VPS: el unico punto de
# entrada es Caddy en 80/443. Ejecutarlo con los valores por defecto contra
# staging producia quince fallos con codigo 000 —«conexion rechazada»— que
# parecian quince funciones rotas y en realidad eran una URL equivocada. Por
# eso ahora hay una comprobacion previa de alcanzabilidad que se detiene y lo
# explica en vez de dejar correr el resto.
#
# BASE_URL deriva la API al SUBDOMINIO, no a una ruta: Caddy sirve el frontend
# en `crm-staging…` y el backend en `api.crm-staging…`. Derivarla como
# `$BASE_URL/api` —lo obvio— da 404 en todo, porque quien responde ahi es
# Next.js con su propia pagina de «no encontrado»; y como esa pagina llega con
# 404 y no con un error de red, las comprobaciones fallaban acusando al backend
# de estar caido cuando estaba perfectamente vivo en otro dominio.
#
# Exit code is the number of failed checks (0 = all passed).
set -uo pipefail

if [ -n "${BASE_URL:-}" ]; then
  base="${BASE_URL%/}"
  esquema="${base%%://*}"
  host="${base#*://}"
  FRONTEND_URL="${FRONTEND_URL:-$base}"
  API_URL="${API_URL:-$esquema://api.$host/api}"
fi

API_URL="${API_URL:-http://localhost:3001/api}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:3000}"
ALLOWED_ORIGIN="${ALLOWED_ORIGIN:-$FRONTEND_URL}"
EXPECTED_RELEASE="${EXPECTED_RELEASE:-}"
CURL_OPTS="${CURL_OPTS:-}"

pass=0; fail=0
ok()   { printf '  \033[1;32mPASS\033[0m %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[1;31mFAIL\033[0m %s\n' "$1"; fail=$((fail+1)); }

# curl helpers (never follow redirects blindly for status checks)
code()    { curl $CURL_OPTS -s -o /dev/null -w '%{http_code}' "$@"; }
headers() { curl $CURL_OPTS -s -D - -o /dev/null "$@"; }
body()    { curl $CURL_OPTS -s "$@"; }

echo "Smoke test: API=$API_URL FRONTEND=$FRONTEND_URL"

# 0. Alcanzabilidad. Un 000 es «no hubo respuesta HTTP»: DNS, puerto cerrado o
#    TLS. Seguir adelante desde ahi solo genera ruido, asi que se para aqui con
#    el diagnostico concreto en vez de veinte lineas rojas indistinguibles.
inalcanzable=0
for destino in "$FRONTEND_URL/login" "$API_URL/health/live"; do
  if [ "$(code "$destino")" = 000 ]; then
    printf '  \033[1;31mSIN RESPUESTA\033[0m %s\n' "$destino"
    inalcanzable=1
  fi
done
if [ "$inalcanzable" = 1 ]; then
  cat >&2 <<'DIAGNOSTICO'

No hay servicio HTTP en esas direcciones. Antes de buscar el fallo en el
producto, comprueba la URL:

  · Contra STAGING pasa el dominio publico. Los puertos 3000 y 3001 no estan
    publicados en el VPS; la unica entrada es Caddy.

      BASE_URL=https://crm-staging.takto.online ./deploy/scripts/smoke-test.sh

  · En LOCAL, levanta antes el entorno y usa los puertos que expongas.

Este script no ha comprobado nada todavia: los fallos que verias serian de la
conexion, no de la aplicacion.
DIAGNOSTICO
  exit 1
fi

# 1. Frontend responds
c=$(code "$FRONTEND_URL/login"); [ "$c" = 200 ] && ok "frontend /login → $c" || bad "frontend /login → $c (want 200)"

# 2. API liveness
c=$(code "$API_URL/health/live"); [ "$c" = 200 ] && ok "API liveness → $c" || bad "API liveness → $c (want 200)"
b=$(body "$API_URL/health/live"); echo "$b" | grep -q '"status":"ok"' && ok "liveness body ok" || bad "liveness body: $b"

# 3. API readiness (DB reachable)
c=$(code "$API_URL/health/ready"); [ "$c" = 200 ] && ok "API readiness → $c" || bad "API readiness → $c (want 200)"

# 4. Security headers (API)
h=$(headers "$API_URL/health/live")
echo "$h" | grep -iq '^x-content-type-options: nosniff' && ok "API X-Content-Type-Options" || bad "API missing nosniff"
echo "$h" | grep -iq '^x-frame-options: DENY' && ok "API X-Frame-Options DENY" || bad "API missing X-Frame-Options DENY"
echo "$h" | grep -iq '^x-powered-by' && bad "API leaks X-Powered-By" || ok "API hides X-Powered-By"
echo "$h" | grep -iq '^x-request-id' && ok "API correlation id header" || bad "API missing X-Request-Id"

# 5. Security headers (frontend: CSP)
hf=$(headers "$FRONTEND_URL/login")
echo "$hf" | grep -iq '^content-security-policy' && ok "frontend CSP header" || bad "frontend missing CSP"
echo "$hf" | grep -iq '^x-content-type-options: nosniff' && ok "frontend nosniff" || bad "frontend missing nosniff"

# 6. CORS: allowed origin reflected, foreign origin not
acao_ok=$(headers -H "Origin: $ALLOWED_ORIGIN" "$API_URL/health/live" | grep -i '^access-control-allow-origin' | tr -d '\r')
echo "$acao_ok" | grep -qi "$ALLOWED_ORIGIN" && ok "CORS reflects allowed origin" || bad "CORS did not reflect allowed origin ($acao_ok)"
acao_bad=$(headers -H "Origin: https://evil.example.com" "$API_URL/health/live" | grep -ci '^access-control-allow-origin')
[ "$acao_bad" = 0 ] && ok "CORS rejects a foreign origin" || bad "CORS reflected a foreign origin"

# 6b. Preflight del onboarding. El navegador manda el codigo de invitacion en
#     el encabezado X-Onboarding-Invite-Code (el guard corre antes de que
#     Multer procese el multipart, no puede ir en el body), asi que el OPTIONS
#     debe permitir ese encabezado explicitamente. Cuando no estaba en
#     allowedHeaders, la creacion de empresa moria en el navegador con "CORS
#     error / 0.0 kB" sin llegar nunca a la API (bug 2026-09-01). Es solo un
#     OPTIONS: no crea empresas, no consume invitaciones, no usa codigo alguno.
pf=$(headers -X OPTIONS "$API_URL/onboarding/company" \
  -H "Origin: $ALLOWED_ORIGIN" \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,x-onboarding-invite-code')
pfc=$(printf '%s' "$pf" | head -1 | grep -oE ' [0-9]{3}' | head -1 | tr -d ' ')
case "$pfc" in
  2*) ok "onboarding preflight → $pfc" ;;
  *)  bad "onboarding preflight → ${pfc:-000} (want 2xx)" ;;
esac
printf '%s' "$pf" | grep -i '^access-control-allow-origin' | grep -qi "$ALLOWED_ORIGIN" \
  && ok "onboarding preflight reflects allowed origin" \
  || bad "onboarding preflight did not reflect allowed origin"
printf '%s' "$pf" | grep -i '^access-control-allow-methods' | grep -q 'POST' \
  && ok "onboarding preflight allows POST" \
  || bad "onboarding preflight does not allow POST"
printf '%s' "$pf" | grep -i '^access-control-allow-headers' | grep -qi 'x-onboarding-invite-code' \
  && ok "onboarding preflight allows X-Onboarding-Invite-Code" \
  || bad "onboarding preflight does NOT allow X-Onboarding-Invite-Code"

# 7. Invalid login → generic 401 (never reveals which field, never 500)
c=$(code -X POST -H 'Content-Type: application/json' -H "Origin: $ALLOWED_ORIGIN" \
  --data '{"email":"nobody@example.com","password":"wrong-password"}' "$API_URL/auth/login")
[ "$c" = 401 ] && ok "invalid login → 401" || bad "invalid login → $c (want 401)"

# 8. Webhook without a signature → must be REJECTED, never processed (never 2xx).
#    401/403 = signature rejected (webhook enabled); 503 = webhook disabled
#    (e.g. no app secret configured) — both are safe non-acceptances.
c=$(code -X POST -H 'Content-Type: application/json' --data '{"object":"whatsapp_business_account"}' "$API_URL/webhook")
if [ "$c" -ge 400 ] 2>/dev/null; then ok "unsigned webhook → $c (rejected, not processed)"; else bad "unsigned webhook → $c (accepted! want >=400)"; fi

# 9. Protected endpoint without a JWT → 401
c=$(code "$API_URL/auth/me"); [ "$c" = 401 ] && ok "protected /auth/me without JWT → 401" || bad "protected /auth/me → $c (want 401)"

# 10. Release/version
vb=$(body "$API_URL/health/version")
echo "$vb" | grep -q '"release"' && ok "version endpoint present" || bad "version endpoint: $vb"
if [ -n "$EXPECTED_RELEASE" ]; then
  echo "$vb" | grep -q "\"release\":\"$EXPECTED_RELEASE\"" \
    && ok "deployed release matches $EXPECTED_RELEASE" \
    || bad "deployed release mismatch (expected $EXPECTED_RELEASE): $vb"
fi

# 11. El bundle servido apunta REALMENTE a la API.
#
# EXISTE PORQUE ESTE SMOKE TEST PASO 17/17 CON LA APLICACION INSERVIBLE.
# `NEXT_PUBLIC_API_URL` se incrusta al construir; construido sin
# `--env-file`, quedo vacia y todas las llamadas del navegador salieron
# contra el propio frontend (404 en cada pantalla). Nada de lo que este
# script comprobaba lo notaba: el backend estaba perfecto y el frontend
# servia HTML con normalidad. Lo unico que lo delata es mirar el JavaScript
# que de verdad se entrega al navegador.
api_host=$(printf '%s' "$API_URL" | sed -E 's#^[a-z]+://([^/]+).*#\1#')
html=$(body "$FRONTEND_URL/login")
chunks=$(printf '%s' "$html" | grep -oE '/_next/static/chunks/[A-Za-z0-9_.-]+\.js' | sort -u | head -25)
if [ -z "$chunks" ]; then
  bad "no se pudo listar el JavaScript del frontend para comprobar la URL de la API"
else
  encontrado=0
  for ch in $chunks; do
    if body "$FRONTEND_URL$ch" | grep -q "$api_host"; then encontrado=1; break; fi
  done
  [ "$encontrado" = 1 ] \
    && ok "el bundle del frontend apunta a $api_host" \
    || bad "NINGUN chunk del frontend contiene $api_host — se construyo sin NEXT_PUBLIC_API_URL"
fi

echo ""
echo "Smoke test: $pass passed, $fail failed."
exit "$fail"
