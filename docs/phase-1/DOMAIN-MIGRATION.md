# Fase 1 — Migración de dominios de staging

## Matriz oficial

| Entorno | Frontend | API |
|---|---|---|
| Producción | `crm.takto.online` | `api.crm.takto.online` |
| Staging | `crm-staging.takto.online` | `api.crm-staging.takto.online` |
| Staging antiguo (compatibilidad temporal) | `crm-staging.tehusrattan.com` | `api.crm-staging.tehusrattan.com` |

Dominio raíz administrado por el propietario: `takto.online`. Producción no
se toca en esta fase: ni DNS, ni certificados, ni despliegue, ni se apunta a
staging.

## Estado del DNS (verificado el 2026-09-03; registros creados por el propietario)

| Nombre | Resuelve a | Estado |
|---|---|---|
| `takto.online` | IPv4 del VPS de staging (sitio comercial `takto-web`) | existe |
| `crm-staging.tehusrattan.com` | IPv4 del VPS de staging | existe (dominio antiguo) |
| `api.crm-staging.tehusrattan.com` | IPv4 del VPS de staging | existe (dominio antiguo) |
| `crm-staging.takto.online` | IPv4 del VPS de staging (A, TTL 300) | **existe** — igual desde el VPS, `dig` directo, 1.1.1.1, 8.8.8.8 y el autoritativo de Hostinger; sin AAAA ni CNAME |
| `api.crm-staging.takto.online` | IPv4 del VPS de staging (A, TTL 300) | **existe** — misma verificación |

Servidores de nombres de `takto.online`: `aster.dns-parking.com` y
`helios.dns-parking.com` (zona gestionada en el panel DNS de Hostinger).

No hay credenciales del proveedor DNS en la máquina de trabajo ni en el VPS.
Los dos registros los creó el propietario (2026-09-03) con los valores de la
tabla siguiente; `crm.takto.online` y `api.crm.takto.online` (producción) no
existen y no se han creado.

### Registros DNS a crear en `takto.online` (acción del propietario)

| Tipo | Nombre | Destino | TTL recomendado | Proxy |
|---|---|---|---|---|
| A | `crm-staging` | la IPv4 pública del VPS de staging (la misma a la que ya apunta `takto.online`; comprobarla con `dig +short takto.online` o en el panel del VPS) | 300 s durante la migración; subir a 3600 s cuando esté estable | Sin proxy (Hostinger DNS no proxya; Caddy obtiene el certificado directamente) |
| A | `api.crm-staging` | la misma IPv4 | 300 s → 3600 s | Sin proxy |

Notas:

- Solo esos dos registros. No tocar `@`, `www` ni ningún otro registro de la
  zona. No crear `crm` ni `api.crm` (producción).
- Si el VPS también tiene IPv6 pública y se desea, añadir registros AAAA con
  los mismos nombres; opcional. Caddy sirve por ambas familias.
- Rollback del DNS: eliminar los dos registros. Nada más depende de ellos.

Comprobación esperada tras crearlos (propagación de minutos con TTL 300):

```bash
dig +short crm-staging.takto.online
dig +short api.crm-staging.takto.online
# ambos deben devolver la misma IPv4 que:
dig +short takto.online
```

## Caddy / TLS (`deploy/Caddyfile`, ya en la rama)

- `crm-staging.takto.online` → `frontend:3000` (HSTS sin preload, `-Server`,
  cuerpo máx. 2 MB).
- `api.crm-staging.takto.online, api.crm-staging.tehusrattan.com` → un solo
  bloque hacia `backend:3001`: la API antigua es un **alias** del mismo
  backend, sin redirecciones (no rompe preflights, callbacks de Meta ni
  clientes antiguos).
- `crm-staging.tehusrattan.com` → redirección **temporal (302)** a
  `https://crm-staging.takto.online{uri}`. Se pasa a `permanent` solo después
  de verificar el login en el dominio nuevo y decidir el retiro del antiguo.
- Certificados: emitidos por Let's Encrypt el 2026-09-03 para los dos
  nombres nuevos (SAN individual, válidos hasta el 2026-12-02) en ~10 s tras
  recrear el contenedor de Caddy; sin errores ACME.
- **Recarga del Caddyfile.** El archivo se monta como bind mount de un solo
  archivo; cuando `git pull` lo reemplaza, el contenedor sigue leyendo el
  inodo antiguo y `caddy reload` responde «config is unchanged». En el
  despliegue de esta fase hubo que recrear el contenedor:
  `docker compose --env-file .env.staging -f docker-compose.staging.yml up -d --force-recreate --no-deps caddy`
  (corte de segundos; los certificados existentes se conservan en
  `caddy_data`). `deploy.sh` no lo hace por sí solo: tras cualquier cambio del
  Caddyfile hay que recrear `caddy` explícitamente. Deuda: montar el
  directorio `deploy/` en lugar del archivo.
- `takto.online` / `www.takto.online` (sitio comercial) no cambian.
- Contacto ACME: sigue `admin@tehusrattan.com` hasta que el propietario
  indique un buzón monitorizado bajo `takto.online` (interno, no visible).

Ejemplo de producción: `deploy/Caddyfile.production.example` (no se despliega).

## Variables de entorno en el VPS (`/opt/tehus-crm/.env.staging`, en el despliegue)

Cambios a aplicar con copia previa `600` en `.secrets/` (ver `ROLLBACK.md`):

| Variable | Valor nuevo | Por qué |
|---|---|---|
| `FRONTEND_URL` | `https://crm-staging.takto.online` | Origen principal para CORS, CSRF y gateway de tiempo real |
| `CSRF_ALLOWED_ORIGINS` | `https://crm-staging.tehusrattan.com` | Origen antiguo durante la convivencia (pestañas con el bundle antiguo). Retirar con el dominio antiguo. Nunca `*` |
| `PASSWORD_RESET_URL` | `https://crm-staging.takto.online/reset-password` | Enlaces de recuperación al frontend nuevo |
| `NEXT_PUBLIC_API_URL` | `https://api.crm-staging.takto.online/api` | Se incrusta en el bundle; también fija `connect-src` (https y wss) de la CSP del frontend |
| `SMTP_FROM_NAME` | `TAKTO` | Remitente general de la plataforma |

Plantilla: `deploy/env/staging.env.example` (ya actualizada). Los secretos
no cambian.

## CORS / CSRF / CSP / WebSocket

- CORS y `CookieOriginGuard` comparten `buildAllowedOrigins`: allowlist
  exacta = `FRONTEND_URL` + `CSRF_ALLOWED_ORIGINS`; `http://localhost:3000`
  solo fuera de producción. Nunca `*` con credenciales (`cors.e2e-spec`,
  `cookie-origin.e2e-spec`).
- El gateway de Socket.IO reutiliza el mismo allowlist.
- CSP del frontend: `connect-src 'self' <API origin> <wss origin>` derivado
  de `NEXT_PUBLIC_API_URL`; `img-src https:`; `frame-ancestors 'none'`.
- Cookies: host-only en el host de la API (`takto_refresh_token`, path
  `/api/auth`; `takto_device_id`, path `/`), `HttpOnly`, `Secure`
  (`NODE_ENV=production`), `SameSite=Lax`. Al cambiar el host de la API, los
  navegadores no envían las cookies del host antiguo al nuevo: **cada usuario
  inicia sesión una vez** en el dominio nuevo; las sesiones del servidor no
  se pierden y se cierran por inactividad (90 días) o al cerrar sesión.
- Callbacks de WhatsApp/Meta: el webhook sigue disponible en la API antigua
  (alias) y en la nueva; no se modifica ninguna configuración en Meta en esta
  fase.

## Ejecución realizada (2026-09-03)

| Paso | Resultado |
|---|---|
| DNS | Verificado desde 4 puntos (VPS, `dig` directo, 1.1.1.1/8.8.8.8, autoritativo Hostinger): solo `179.197.73.188`, sin AAAA/CNAME, producción inexistente, `takto.online`/`www` intactos |
| Merge | PR #18 → `main` `5cb991f` (21:17 UTC) con CI verde en `d662bd4` |
| `.env.staging` | Copia `600 deploy:deploy` en `.secrets/.env.staging.bak-20260903T211834Z` (hash igual); diff limitado a las 5 variables (`CSRF_ALLOWED_ORIGINS` no existía y se añadió); rollback: `cp -p` de la copia |
| `deploy.sh` | Release `5cb991f` (built 21:18:56Z); backup previo; «No pending migrations to apply»; backend/worker/frontend/postgres recreados; el paso 11 falló por el bit de ejecución perdido de `health-check.sh` (PR #19) y porque Caddy aún leía el Caddyfile antiguo; tras recrear `caddy`: `health-check.sh` 12/12 |
| Verificación | `/api/health/version` = `5cb991f…`; `/api/health/status` ok (database, queue, worker, outbox, realtime, flowbot `up`); HSTS, `Server` oculto; smoke 22/22 con `EXPECTED_RELEASE`; 302 `crm-staging.tehusrattan.com/ruta?qa=1` → `crm-staging.takto.online/ruta?qa=1`; API antigua 200 sin redirección; `takto.online` 200, `www` 301 |

## Orden de ejecución (referencia)

1. Propietario crea los dos registros A y confirma con `dig`.
2. Verificar en el VPS: `getent ahosts crm-staging.takto.online` y
   `api.crm-staging.takto.online` → IPv4 del VPS.
3. Merge del PR (CI verde, `MERGEABLE/CLEAN`).
4. Copia `600` de `.env.staging` en `.secrets/`, aplicar las cinco variables.
5. `./deploy/scripts/deploy.sh` (pull ff-only de `main`, build, backup
   previo, `migrate deploy` — no hay migraciones en esta fase —, `up -d`,
   health check). Caddy recarga su archivo montado al recrear el contenedor.
6. Comprobar: `/api/health/version` (release nuevo), `health-check.sh` 12/12,
   `BASE_URL=https://crm-staging.takto.online ./deploy/scripts/smoke-test.sh`
   (17+ controles, incluido CORS del origen nuevo y rechazo de origen ajeno),
   certificados de los dos nombres nuevos en `caddy_data`, redirección 302
   del frontend antiguo, alias de la API antigua (200 en `/api/health/live`),
   login/refresh/logout en el dominio nuevo (cookies `takto_*`), WebSocket
   (`/api/health/status` → `realtime: up` y bandeja en vivo), recuperación de
   contraseña (enlace apunta al dominio nuevo), invitación `TAKTO-…` y
   onboarding completo.
7. Registrar la evidencia en `STAGING-EVIDENCE.md`.

## Producción (pendiente, fuera de esta fase)

`crm.takto.online` y `api.crm.takto.online`: ejemplos en
`deploy/Caddyfile.production.example` y `deploy/env/production.env.example`.
Requiere su propio stack, secretos, remote de respaldo y latidos. No se crea
DNS, no se emiten certificados, no se despliega y no se apunta a staging.
