#!/usr/bin/env bash
# Post-deploy smoke test. READ-ONLY: never creates, mutates, or deletes data,
# and never calls Meta. Safe to run against staging after every deploy.
#
# Config (env or defaults for a local run):
#   API_URL           default http://localhost:3001/api
#   FRONTEND_URL      default http://localhost:3000
#   ALLOWED_ORIGIN    default = FRONTEND_URL   (expected CORS origin)
#   EXPECTED_RELEASE  optional git SHA to assert /health/version matches
#   CURL_OPTS         optional extra curl flags (e.g. -k for a staging cert)
#
# Exit code is the number of failed checks (0 = all passed).
set -uo pipefail

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

echo ""
echo "Smoke test: $pass passed, $fail failed."
exit "$fail"
