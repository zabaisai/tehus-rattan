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

## Estado del DNS (verificado el 2026-09-03 desde el VPS)

| Nombre | Resuelve a | Estado |
|---|---|---|
| `takto.online` | IPv4 del VPS de staging (sitio comercial `takto-web`) | existe |
| `crm-staging.tehusrattan.com` | IPv4 del VPS de staging | existe (dominio antiguo) |
| `api.crm-staging.tehusrattan.com` | IPv4 del VPS de staging | existe (dominio antiguo) |
| `crm-staging.takto.online` | — | **no existe** |
| `api.crm-staging.takto.online` | — | **no existe** |

Servidores de nombres de `takto.online`: `aster.dns-parking.com` y
`helios.dns-parking.com` (zona gestionada en el panel DNS de Hostinger).

No hay credenciales del proveedor DNS en la máquina de trabajo ni en el VPS
(sin variables de entorno, sin CLI, sin archivos de configuración). Por eso
esta fase **se detiene antes de crear registros**, tal como exige el
encargo, y entrega los registros exactos para que el propietario los cree.

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
- Certificados: Caddy los emite en cuanto el DNS resuelve y 80/443 son
  alcanzables. Mientras el DNS nuevo no exista, Caddy reintenta la emisión de
  esos dos nombres con retroceso exponencial y sigue sirviendo los demás; aun
  así, **no se despliega el Caddyfile nuevo antes de que existan los registros**
  para no llenar el log de fallos ACME.
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

## Orden de ejecución (cuando exista el DNS)

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
