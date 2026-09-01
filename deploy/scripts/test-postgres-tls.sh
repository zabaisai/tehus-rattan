#!/usr/bin/env bash
# Prueba LOCAL y TEMPORAL de TLS para PostgreSQL con certificados FICTICIOS.
# No toca ninguna base real ni deja certificados en Git: los genera en un VOLUMEN
# efímero de Docker (dentro de un contenedor, así no depende del openssl del host
# ni de rutas del SO). Comprueba:
#   1) `sslmode=verify-full` + la CA de confianza CONECTA;
#   2) `sslmode=disable` es RECHAZADO (pg_hba exige hostssl);
#   3) `sslmode=verify-full` SIN la CA correcta FALLA.
#
# Requisitos: solo docker. Uso: bash deploy/scripts/test-postgres-tls.sh
#
# EJECUTAR EN UN SHELL POSIX (Linux/macOS/CI). En Git Bash sobre Windows, MSYS
# convierte los argumentos `/certs/...` de `docker run -c ssl_cert_file=...` a
# rutas de Windows y Postgres no encuentra el certificado — es un artefacto del
# host, no del script. En CI (ubuntu-latest) funciona tal cual.
set -euo pipefail

VOL="takto-pg-tls-certs-$$"
CONTAINER="takto-pg-tls-test-$$"
PGHOST=127.0.0.1
PGPORT=55432
PGDB=tlsprueba
PGUSER=tlsuser
PGPASS=tls-solo-local

limpiar() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker volume rm "$VOL" >/dev/null 2>&1 || true
}
trap limpiar EXIT

echo "== Generando CA + certificado de servidor (CN=$PGHOST) en un volumen efímero =="
docker volume create "$VOL" >/dev/null
docker run --rm --entrypoint sh -v "$VOL:/certs" alpine/openssl -c "
  set -e
  openssl req -new -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /certs/ca.key -out /certs/ca.crt -subj '/CN=Takto-Test-CA'
  openssl req -new -nodes -newkey rsa:2048 -keyout /certs/server.key -out /certs/server.csr \
    -subj '/CN=$PGHOST' -addext 'subjectAltName=IP:$PGHOST'
  printf 'subjectAltName=IP:%s' '$PGHOST' > /certs/ext.cnf
  openssl x509 -req -in /certs/server.csr -CA /certs/ca.crt -CAkey /certs/ca.key \
    -CAcreateserial -days 1 -out /certs/server.crt -extfile /certs/ext.cnf
  # pg exige la clave 0600 y del usuario postgres (uid 999).
  chmod 600 /certs/server.key
  chown 999:999 /certs/server.key /certs/server.crt
  cat > /certs/pg_hba.conf <<EOF
local all all trust
hostssl all all 0.0.0.0/0 md5
host    all all 0.0.0.0/0 reject
EOF
" >/dev/null 2>&1

echo "== Arrancando Postgres TLS efímero =="
docker run -d --name "$CONTAINER" \
  -e POSTGRES_USER="$PGUSER" -e POSTGRES_PASSWORD="$PGPASS" -e POSTGRES_DB="$PGDB" \
  -p "$PGPORT:5432" -v "$VOL:/certs:ro" \
  postgres:16 \
  -c ssl=on -c ssl_cert_file=/certs/server.crt -c ssl_key_file=/certs/server.key \
  -c hba_file=/certs/pg_hba.conf >/dev/null

echo "== Esperando a que acepte conexiones =="
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U "$PGUSER" -d "$PGDB" >/dev/null 2>&1; then break; fi
  sleep 1
done

fallos=0
psql_tls() { # $1 = extra params de conexión
  docker run --rm --network host -e PGPASSWORD="$PGPASS" -v "$VOL:/certs:ro" postgres:16 \
    psql "host=$PGHOST port=$PGPORT dbname=$PGDB user=$PGUSER $1" -tAc "select 'tls-ok'"
}

echo "== 1) verify-full con la CA correcta debe CONECTAR =="
if psql_tls "sslmode=verify-full sslrootcert=/certs/ca.crt" 2>/dev/null | grep -q tls-ok; then
  echo "   OK: conecta con verify-full."
else
  echo "   FALLO: no conectó con verify-full."; fallos=$((fallos+1))
fi

echo "== 2) sslmode=disable debe ser RECHAZADO =="
if psql_tls "sslmode=disable" >/dev/null 2>&1; then
  echo "   FALLO: una conexión sin TLS fue aceptada."; fallos=$((fallos+1))
else
  echo "   OK: la conexión sin TLS fue rechazada."
fi

echo "== 3) verify-full sin la CA correcta debe FALLAR =="
if psql_tls "sslmode=verify-full sslrootcert=system" >/dev/null 2>&1; then
  echo "   FALLO: verify-full aceptó una CA no confiable."; fallos=$((fallos+1))
else
  echo "   OK: verify-full rechaza sin la CA correcta."
fi

echo ""
if [ "$fallos" -eq 0 ]; then
  echo "TLS POSTGRES: OK — TLS obligatorio, verify-full con CA, no-TLS rechazado."
else
  echo "TLS POSTGRES: $fallos comprobacion(es) fallida(s)"; exit 1
fi
