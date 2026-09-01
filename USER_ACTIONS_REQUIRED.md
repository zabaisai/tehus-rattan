# Acciones humanas requeridas — Endurecimiento de seguridad TAKTO

Estas son las únicas cosas que este trabajo NO pudo hacer de forma segura en
local. Ordenadas por prioridad. Nada de lo de abajo se ejecutó.

---

## P0 — Rotar TODAS las credenciales locales que se mostraron en salida

Durante la primera fase, el contenido de `apps/backend/.env` (archivo **local**,
no versionado, no en el historial Git) se imprimió en la salida. Aunque no está
en el repositorio (gitleaks sobre `--all` lo confirma: *no leaks found*), sus
valores deben **tratarse como potencialmente comprometidos** y rotarse. Se
identifican **solo por nombre de variable**; los valores NO se reproducen aquí y
los secretos locales NO se han modificado ni borrado en esta fase.

Variables a rotar / regenerar (todas en `apps/backend/.env`, entorno local):

| Variable | Tipo | Acción |
|----------|------|--------|
| `WHATSAPP_TOKEN` | Token de acceso de Meta (legacy, estaba comentado) | Revocar/rotar en Meta App Dashboard |
| `WHATSAPP_VERIFY_TOKEN` | Verify token del webhook de Meta | Regenerar y actualizar en la config del webhook de Meta |
| `WHATSAPP_TOKEN_ENCRYPTION_KEY` | Clave AES-256-GCM de tokens de WhatsApp | Rotar con la ventana de doble clave (ver control 5 / `docs/ROTACION-CLAVE-WHATSAPP.md`) |
| `JWT_SECRET` | Secreto de firma de JWT | Regenerar (`openssl rand -base64 48`); invalida todas las sesiones activas |
| `DATABASE_URL` | Cadena de conexión (incluye la contraseña de Postgres) | Cambiar la contraseña del rol de Postgres y actualizar la URL |

Identificadores que también aparecieron pero NO son secretos (no requieren
rotación, se listan por transparencia): `WHATSAPP_BUSINESS_ACCOUNT_ID`,
`WHATSAPP_PHONE_NUMBER_ID`.

> Nota: la rotación de `WHATSAPP_TOKEN` (Meta legacy) sigue siendo la más urgente;
> el resto son claves/valores locales de desarrollo, pero se rotan por haberse
> mostrado en salida. No es necesario reescribir el historial Git: ninguno de
> estos valores está en Git.

## P0 — Rotar el token de acceso de Meta (WhatsApp) legacy

- **Qué:** en `apps/backend/.env` (archivo LOCAL, **no** versionado y **no** en
  el historial Git) vivía comentado un token de acceso de Meta de la integración
  monoempresa antigua. Se eliminó del archivo durante este trabajo.
- **Por qué es P0:** aunque nunca estuvo en Git, es una credencial real que pudo
  quedar en copias locales, backups de disco o historiales de shell.
- **Acción:** en Meta App Dashboard, **revocar/rotar** ese token de acceso. No es
  necesario reescribir el historial Git (el token no está ahí; gitleaks sobre
  `--all` lo confirma). No despliegues ni lleves esta integración a producción
  hasta rotarlo si consideras que sigue vigente.
- **Identificación (sin valor):** tipo = User/System access token de Meta;
  archivo = `apps/backend/.env` (local); estaba en una línea comentada
  `# WHATSAPP_TOKEN=EAAW...` que ya no existe.

## P1 — Separar el rol de PostgreSQL y activar Row-Level Security (control 4)

- **Qué:** hoy `DATABASE_URL` usa un único rol que es a la vez propietario de
  tablas, usuario de migración y usuario runtime. Un propietario **omite** RLS,
  así que activar políticas sin separar roles sería teatro.
- **Acción (en tu infraestructura, no en esta sesión):**
  1. Crear un rol `takto_app` para el runtime: `NOSUPERUSER`, sin `BYPASSRLS`,
     sin propiedad de tablas, con solo `SELECT/INSERT/UPDATE/DELETE`.
  2. Mantener un rol separado (propietario) para `prisma migrate deploy`.
  3. Apuntar el `DATABASE_URL` del backend/worker a `takto_app`.
  4. Adoptar `runInTenantContext`/`runWithTenant` servicio por servicio en el
     backend, worker, jobs, WebSocket, analytics, tareas programadas y
     exportaciones. No activar RLS mientras existan consultas runtime con
     `this.prisma` directo fuera del contexto transaccional.
  5. Ejecutar pruebas por caminos reales (REST, jobs, worker y realtime) con el
     rol runtime demostrando que empresa A no lee/escribe datos de B, que sin
     contexto se deniega por defecto y que el contexto no se filtra entre
     conexiones del pool.
  6. Solo cuando toda la adopción anterior esté verde, activar de forma aditiva
     `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` y las políticas
     basadas en `current_setting('app.company_id', true)`.
- Los filtros de aplicación por `companyId` NO se retiran: RLS es una segunda
  barrera.

## P2 — Antibot: conectar las claves reales (control 12)

- **Ya implementado:** el adaptador antibot está completo y probado
  (`common/captcha`): `FakeCaptchaProvider` para local/tests, `TurnstileCaptchaProvider`
  con verificación server-side fail-closed, guard opt-in en login, validación de
  entorno fail-closed en producción.
- **Acción humana restante:** crear la cuenta de **Cloudflare Turnstile** y sus
  claves — site key pública para el frontend (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`),
  secret solo en el backend (`TURNSTILE_SECRET_KEY`) — y poner
  `CAPTCHA_ENABLED=true` + `CAPTCHA_PROVIDER=turnstile`. Guárdalas como variables
  de entorno, nunca en el repositorio. (El widget del frontend que envía el token
  en `x-captcha-token`/`captchaToken` se conecta al activar el control.)

## Rate limiting distribuido con Redis (control 11) — HECHO

Ya no requiere acción: implementado en la fase 2 (`RedisThrottlerStorage`,
seleccionado fuera de pruebas con la cola habilitada, fail-safe mediante
fallback local en memoria). Solo asegúrate
de que `REDIS_HOST`/`REDIS_PORT` (y `REDIS_PASSWORD` si expones Redis) están
configurados en producción.

---

## Deudas menores documentadas (no bloquean; mejoras futuras)

- Detección de reutilización de refresh token (control 9).
- Revalidación periódica del socket WebSocket ya conectado tras revocar la sesión
  (hoy se cierra el canal nuevo; el existente vive hasta expirar el token, 15 min).
- Servido autenticado de archivos PRIVADOS por empresa cuando existan (hoy solo
  hay logos, que son públicos por diseño — control 16).
- Altas de dependencias del CLI de Prisma / exceljs — se resuelven vía Dependabot
  cuando haya versión compatible (control 20).

Resueltas en fases 2–3 (ya NO son deuda): guard global deny-by-default (6), KDF
scrypt versionado (5), rate limiting distribuido fail-safe + límite por cuenta
(11), antibot frontend+backend (12), mecanismo RLS probado de forma aislada (4; su adopción real sigue siendo P1), coste bcrypt 12
+ rehash progresivo (10), validación de inputs con DTOs (14), firma/estructura ZIP
del import + servido restringido a branding (16), tope máximo en listados (17),
TLS de Postgres preparado y probado (19), frontend a 0 vulnerabilidades (20).
