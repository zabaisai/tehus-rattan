#!/usr/bin/env bash
#
# Verifica la RUTA DE ACTUALIZACION real: aplicar las migraciones nuevas sobre
# una base que esta en la version exacta de staging, con datos dentro, no
# sobre una base vacia.
#
# POR QUE IMPORTA: el CI aplica las migraciones desde cero, lo que demuestra
# que la secuencia completa es coherente — pero no demuestra que el salto que
# va a ocurrir en el despliegue funcione. Son cosas distintas: una migracion
# que anade una columna NOT NULL sin default pasa desde cero (tabla vacia) y
# falla sobre datos existentes. Justo el fallo que se descubre en produccion.
#
# Crea una base temporal, la deja en el estado de staging, le mete datos y solo
# entonces aplica el resto. Al terminar la borra. No toca desarrollo ni staging.
set -euo pipefail

CONTENEDOR="${CONTENEDOR_POSTGRES:-tehus_postgres}"
BASE="takto_ruta_migracion"
# Ultima migracion aplicada en staging. Se actualiza cuando staging avance.
HASTA="${MIGRACION_STAGING:-20260727225339_add_notifications}"

USUARIO="${PGUSER_LOCAL:-postgres}"
CLAVE="${PGPASSWORD_LOCAL:-postgres}"

psql_en() {
  docker exec -e PGPASSWORD="$CLAVE" "$CONTENEDOR" \
    psql -U "$USUARIO" -d "$1" -v ON_ERROR_STOP=1 "${@:2}"
}

TMP=""
limpiar() {
  [ -n "$TMP" ] && rm -rf "$TMP"
  docker exec -e PGPASSWORD="$CLAVE" "$CONTENEDOR" psql -U "$USUARIO" -d postgres \
    -c "DROP DATABASE IF EXISTS $BASE WITH (FORCE);" >/dev/null 2>&1 || true
}
trap limpiar EXIT

echo "== Base temporal =="
limpiar
psql_en postgres -c "CREATE DATABASE $BASE;" >/dev/null

export DATABASE_URL="postgresql://$USUARIO:$CLAVE@localhost:5432/$BASE"

# Prisma busca las migraciones en <carpeta del schema>/migrations, asi que el
# subconjunto se prepara copiando el schema y solo las carpetas hasta $HASTA.
TMP="$(mktemp -d)"
mkdir -p "$TMP/prisma/migrations"
cp prisma/schema.prisma "$TMP/prisma/"
cp prisma/migrations/migration_lock.toml "$TMP/prisma/migrations/"

copiadas=0
for dir in prisma/migrations/*/; do
  nombre="$(basename "$dir")"
  [ "$nombre" = "migration_lock.toml" ] && continue
  cp -r "$dir" "$TMP/prisma/migrations/"
  copiadas=$((copiadas + 1))
  [ "$nombre" = "$HASTA" ] && break
done

echo "== 1. Llevando la base al estado de STAGING ($copiadas migraciones) =="
npx prisma migrate deploy --schema "$TMP/prisma/schema.prisma" 2>&1 | tail -2

echo "== 2. Insertando datos: las migraciones no deben ver tablas vacias =="
psql_en "$BASE" -c "
  INSERT INTO companies (id, name, \"createdAt\", \"updatedAt\")
    VALUES ('ruta-empresa', 'Empresa ruta migracion', NOW(), NOW());
  INSERT INTO contacts (id, \"companyId\", phone, \"createdAt\", \"updatedAt\")
    VALUES ('ruta-contacto', 'ruta-empresa', '+573001112233', NOW(), NOW());
  INSERT INTO conversations (id, \"companyId\", \"contactId\", \"createdAt\", \"updatedAt\")
    VALUES ('ruta-conv', 'ruta-empresa', 'ruta-contacto', NOW(), NOW());
  INSERT INTO messages (id, \"conversationId\", body, direction, \"createdAt\")
    VALUES ('ruta-msg', 'ruta-conv', 'hola', 'INBOUND', NOW());
" >/dev/null
echo "   4 filas insertadas"

echo "== 3. Aplicando las migraciones PENDIENTES sobre datos existentes =="
npx prisma migrate deploy 2>&1 | tail -3

echo "== 4. Los datos siguen ahi =="
for tabla in companies contacts conversations messages; do
  n="$(psql_en "$BASE" -tAc "SELECT count(*) FROM $tabla;" | tr -d '[:space:]')"
  echo "   $tabla: $n"
  [ "$n" = "0" ] && { echo "FALLO: $tabla quedo vacia"; exit 1; }
done

echo "== 5. Esquema al dia =="
npx prisma migrate status 2>&1 | tail -2

echo ""
echo "RUTA DE ACTUALIZACION VERIFICADA: staging -> HEAD sin perder datos."
