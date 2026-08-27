# TLS de PostgreSQL — estado, activación y rollback

Estado: **HTTPS CORREGIDO — TLS DE BD PREPARADO**. No se afirma que la base real
use TLS: no se ha activado en ningún entorno real en esta sesión.

## Caso actual (aceptado y justificado)

Hoy el backend y el worker hablan con PostgreSQL **dentro de la red Docker
privada `internal`** del mismo VPS, sin puerto publicado
(`docker-compose.staging.yml`). La conexión no sale del host, así que el texto
plano en tránsito es un riesgo aceptado mientras esa topología se mantenga. No
hay `sslmode` en `DATABASE_URL` (ni debe haberlo hasta habilitar TLS en el
servidor, o la conexión fallaría — ver `deploy/env/staging.env.example`).

## Cuándo pasa a ser obligatorio

En el momento en que PostgreSQL salga del host: réplica, proveedor gestionado,
o acceso desde otra máquina. Entonces la conexión cruza una red y **debe** ir
cifrada y con verificación de servidor.

## Configuración objetivo (versionada, sin secretos)

- `DATABASE_URL` con **`sslmode=verify-full`** y una **CA de confianza**:

  ```
  postgresql://<USER>:<PASS>@<HOST>:5432/<DB>?sslmode=verify-full&sslrootcert=/ruta/ca.crt
  ```

  `verify-full` cifra Y verifica que el certificado del servidor lo firma la CA
  y que el hostname coincide. **No** usar `require` (cifra pero no verifica → no
  frena un man-in-the-middle) ni `sslmode=disable`.

- Prisma lee `sslmode`/`sslrootcert` **directamente de la URL** — no hay que
  tocar código de la app.

- Servidor PostgreSQL: `ssl=on`, `ssl_cert_file`, `ssl_key_file`, y `pg_hba.conf`
  con **solo `hostssl`** (más un `host ... reject`) para rechazar cualquier
  conexión sin TLS.

- **Certificados y claves privadas NUNCA en Git.** Se generan/gestionan fuera
  del repositorio (o con un emisor/ACME interno) y se montan como secretos.

## Prueba local (certificados ficticios, fuera del repo)

`deploy/scripts/test-postgres-tls.sh` levanta un PostgreSQL TLS **efímero** con
certificados ficticios generados en un volumen de Docker (no toca ninguna base
real ni deja certificados en Git) y comprueba, con `psql`:

1. `sslmode=verify-full` + la CA correcta **conecta**;
2. `sslmode=disable` es **rechazado** (pg_hba exige `hostssl`);
3. `verify-full` **sin** la CA correcta **falla** la verificación.

Ejecutar en un shell POSIX (Linux/macOS/CI). En Git Bash sobre Windows la
conversión de rutas de MSYS mangla los argumentos `/certs/...` de `docker run`,
por lo que la comprobación debe correrse en Linux/CI (ver la nota en el script).

## Procedimiento de ACTIVACIÓN en staging

1. Generar CA + certificado de servidor (SAN con el host real) fuera del repo.
2. Montar cert/clave en el contenedor de PostgreSQL y activar `ssl=on` +
   `pg_hba` `hostssl`.
3. Montar la CA en backend y worker; actualizar `DATABASE_URL` con
   `?sslmode=verify-full&sslrootcert=<ruta CA>`.
4. Desplegar backend/worker; verificar arranque y una consulta de salud.
5. Correr `deploy/scripts/test-postgres-tls.sh` contra una copia si se desea.

## ROLLBACK

1. Volver `DATABASE_URL` a la forma sin `sslmode` (o `sslmode=disable` si el
   servidor aún exige TLS, retirando también `hostssl`).
2. Revertir `pg_hba.conf` para volver a permitir `host` sin TLS.
3. Redeploy. Como la topología de red interna no cambió, la app sigue igual.

Ningún paso de arriba se ejecutó contra una base real en esta sesión.
