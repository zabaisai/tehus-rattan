# TAKTO — Endurecimiento de seguridad: los 20 controles

Trabajo realizado sobre la rama `fix/security-hardening-20-controls`, tomada de
`origin/main` (el producto real; `develop` está ~269 commits por detrás). Nada
desplegado, ninguna migración aplicada a una base real, ningún secreto nuevo.

**Estados:** `VERIFICADO` (ya correcto, comprobado) · `CORREGIDO` (defecto
arreglado con prueba) · `PARCIAL` (parte hecha, resto documentado) · `BLOQUEADO`
(requiere acción humana o infraestructura) · `NO APLICA, ADAPTADO`.

## Matriz resumen

| # | Control | Estado |
|---|---------|--------|
| 1 | Ocultar API keys y secretos | CORREGIDO |
| 2 | Escaneo y purga de secretos en el historial Git | VERIFICADO |
| 3 | “Key pública de base de datos” (adaptación PostgreSQL) | NO APLICA, ADAPTADO |
| 4 | Row-Level Security de PostgreSQL | PARCIAL (preparado y probado en local; falta separar rol de BD en infra) |
| 5 | Cifrado | CORREGIDO (KDF); PARCIAL (TLS a Postgres, ver 19) |
| 6 | Autenticación obligatoria por defecto | CORREGIDO |
| 7 | IDOR / acceso entre empresas | CORREGIDO |
| 8 | Mass assignment | VERIFICADO |
| 9 | Cookies y sesiones / CSRF | CORREGIDO |
| 10 | Hash de contraseñas | VERIFICADO |
| 11 | Rate limiting del login | CORREGIDO |
| 12 | Antibot | CORREGIDO (adaptador completo; solo falta conectar claves reales) |
| 13 | Parametrización de consultas | VERIFICADO |
| 14 | Validación y normalización de inputs | VERIFICADO / PARCIAL |
| 15 | Escape y saneo de contenido | CORREGIDO |
| 16 | Subida de archivos | PARCIAL |
| 17 | Recorte de respuestas de API | CORREGIDO (campos); PARCIAL (paginación por defecto) |
| 18 | Headers de seguridad | VERIFICADO |
| 19 | Forzar HTTPS | VERIFICADO / PARCIAL (TLS a Postgres documentado) |
| 20 | Escaneo de dependencias y cadena de suministro | CORREGIDO |

> **Fase 2 (cierre):** se implementaron y probaron en local, además de lo
> anterior: derivación de clave scrypt versionada con compatibilidad legacy
> (5), guard global de autenticación deny-by-default (6), rate limiting
> distribuido en Redis (11), adaptador antibot desacoplado con Turnstile +
> proveedor falso (12), y RLS ejecutable probado con un rol runtime real (4).

---

## 1. Ocultar API keys y secretos — CORREGIDO

- **Riesgo original:** un token de acceso de Meta (legacy) comentado en
  `apps/backend/.env` (no versionado), y archivos basura versionados
  (`code .gitignore`, `apps/backend/PORT=3001`).
- **Evidencia:** `git ls-files` mostraba solo `*.example` como `.env`; el token
  legacy vivía en el `.env` local ignorado; gitleaks sobre todo el historial:
  0 secretos reales (2 falsos positivos conocidos).
- **Corrección:** eliminado el token legacy del `.env` local (marcada su
  rotación como acción manual P0), borrados los archivos basura, `.gitignore`
  raíz ampliado para ignorar todo `.env*` del árbol y material de claves
  (`*.pem/*.p12/*.pfx`). `.env.example` documenta las variables nuevas
  (longitud mínima de `JWT_SECRET`/clave de cifrado, Redis, worker) con valores
  ficticios.
- **Archivos:** `.gitignore`, `.env.example`, `apps/backend/.env` (local, no
  versionado), `.gitleaks.toml`.
- **Pruebas:** `gitleaks detect --log-opts=--all` → *no leaks found*.
- **Riesgo residual:** el token de Meta legacy debe **rotarse** en el App
  Dashboard (acción humana, ver `USER_ACTIONS_REQUIRED.md`). No estaba en el
  historial Git, así que no requiere reescritura de historia.

## 2. Escaneo y purga de secretos en el historial Git — VERIFICADO

- **Riesgo original:** posibles secretos en commits antiguos de cualquier rama.
- **Evidencia:** gitleaks 8.24 sobre `--log-opts=--all` (456 commits, todas las
  ramas): 2 hallazgos, ambos falsos positivos verificados a mano — el token
  placeholder del badge CircleCI del starter de NestJS en
  `apps/backend/README.md` y un JWT ficticio en un test que precisamente
  comprueba que el logger NO escribe tokens (`realtime.auth.spec.ts`), más
  fixtures ficticios del validador de flowbot.
- **Corrección:** `.gitleaks.toml` con allowlist justificada de esos 3
  archivos/patrones; integrado en CI (`.github/workflows/security.yml`).
- **Pruebas:** con la config, gitleaks sobre HEAD y sobre todas las ramas →
  *no leaks found* (exit 0).
- **Riesgo residual:** ninguno para el historial. No se requirió purga.

## 3. “Key pública de base de datos” — NO APLICA, ADAPTADO

TAKTO usa PostgreSQL + Prisma, no Supabase. Comprobado:
- El navegador nunca se conecta a PostgreSQL; no existe `NEXT_PUBLIC_DATABASE_URL`
  (grep en `apps/frontend`: solo `NEXT_PUBLIC_API_URL` y dos ids públicos de Meta).
- `DATABASE_URL` solo lo consumen backend, worker y migraciones.
- `docker-compose.staging.yml` no publica el puerto de Postgres; queda en la red
  `internal`. El dev compose ahora liga el puerto a `127.0.0.1`.
- **Pendiente (ver control 4/5):** el usuario runtime = usuario de migración =
  propietario de tablas; separar roles es precondición para RLS y TLS.

## 4. Row-Level Security de PostgreSQL — PARCIAL (preparado y probado)

- **Riesgo original:** el aislamiento multiempresa es 100% de aplicación; un
  `where` sin `companyId` olvidado es una fuga sin red de seguridad por debajo.
- **Evidencia:** 0 `CREATE POLICY` / `ROW LEVEL SECURITY` en las migraciones;
  `DATABASE_URL` único para migración y runtime (propietario de tablas →
  omitiría RLS aunque se activara).
- **Preparado y PROBADO en local (fase 2):**
  - `apps/backend/prisma/rls/001-enable-rls.sql` — SQL idempotente que activa
    `ENABLE`+`FORCE ROW LEVEL SECURITY` y una política `tenant_isolation` por
    `companyId` en las 37 tablas multiempresa, generado desde el esquema.
  - `apps/backend/prisma/rls/000-create-runtime-role.sql.example` — rol runtime
    separado (sin superuser, sin `BYPASSRLS`, sin propiedad de tablas).
  - `apps/backend/src/prisma/tenant-context.ts` — `runWithTenant()` fija
    `app.company_id` **transaction-scoped** (`set_config(..., true)`), sin fuga
    entre conexiones del pool.
  - `apps/backend/prisma/rls/proof.mjs` — prueba EJECUTABLE contra una base
    temporal propia con un rol runtime REAL sin `BYPASSRLS`: **ejecutada en
    verde** — A ve solo A, B solo B, sin contexto 0 filas, `WITH CHECK` bloquea
    inserciones cross-tenant.
- **Único bloqueo real (P1, humana):** separar el rol de BD (migración/propietario
  vs runtime) en la infraestructura y repuntar `DATABASE_URL` — no puede
  ejecutarse contra bases reales en esta sesión. Con eso hecho + adoptar
  `runWithTenant()`, se aplica el SQL. Ver `prisma/rls/README.md`. No se finge
  RLS activo; los filtros de aplicación por `companyId` permanecen intactos.

## 5. Cifrado — PARCIAL

- **VERIFICADO:** tokens de WhatsApp cifrados con **AES-256-GCM**, IV de 12
  bytes por cifrado, auth tag verificado al descifrar, clave maestra fuera de la
  base y del repo, sin registrar texto plano
  (`whatsapp-token-crypto.service.ts`). Contraseñas y tokens de reset/invitación
  con **hash** (no cifrado reversible). Añadida rotación de clave con clave
  previa (`WHATSAPP_TOKEN_ENCRYPTION_KEY_PREVIOUS`).
- **CORREGIDO:** validación de la clave de cifrado y de `JWT_SECRET` en el
  arranque (requeridas y longitud mínima 32 en producción) —
  `common/config/env.validation.ts` (+ tests).
- **CORREGIDO (fase 2) — derivación de clave:** el cifrado pasa a un formato
  versionado `v2:` que deriva la clave con **scrypt + sal única por ciphertext**
  (`whatsapp-token-crypto.service.ts`). Es **retrocompatible**: descifra los
  ciphertexts legacy (`sha256`, sin sal) sin migración; cifra siempre en v2. El
  prefijo `v2` es el versionado de clave. La rotación (clave actual/anterior)
  funciona en ambos formatos. Cubierto por `whatsapp-token-crypto.compat.spec.ts`
  (16 tests: formato v2, no-determinismo, descifrado legacy, rotación en ambos
  formatos, rechazo por manipulación GCM).
- **Riesgo residual (documentado):** TLS para PostgreSQL — ver control 19
  (documentado, pendiente de infraestructura).

## 6. Autenticación obligatoria por defecto — CORREGIDO / PARCIAL

- **VERIFICADO:** revocación de sesión por petición REST (`JwtStrategy` consulta
  `UserSession` en cada request; un token sin `sid` se rechaza). Inventario de
  rutas públicas acotado (health, login/refresh/logout, forgot/reset, onboarding,
  webhook GET/POST). Rutas de plataforma tras `PlatformGuard`; soporte
  cross-company temporal y auditado.
- **CORREGIDO (NEW-1, el hallazgo más importante de auth):** el handshake de
  WebSocket ahora **valida la sesión (`sid`) contra la base** igual que REST, de
  modo que una sesión revocada/cerrada/caducada ya no abre canal nuevo (antes
  solo lo cerraba la expiración del access token, 15 min). Allowlist explícito
  de algoritmo (HS256) en verificación y firma del JWT (REST y WS).
  `realtime.auth.ts`, `jwt.strategy.ts`, `auth.module.ts` (+ tests unit y e2e,
  incl. caso de sesión revocada).
- **CORREGIDO (fase 2) — deny-by-default:** se añadió un guard GLOBAL de
  autenticación (`GlobalJwtAuthGuard` como `APP_GUARD`) que exige JWT en TODA
  ruta HTTP salvo las marcadas `@Public()` (health/raíz, login/refresh/logout,
  recuperación, onboarding, webhook de Meta). Un controlador nuevo nace
  protegido. Los guards por controlador se mantienen como capa primaria. Cubierto
  por `deny-by-default.e2e-spec.ts` (arranca el AppModule real: públicas 200,
  privadas 401 sin token).
- **Riesgo residual (documentado):** un socket ya conectado sigue vivo hasta
  expirar el token (15 min) tras una revocación: cierra el canal nuevo, no el
  existente. Revalidación periódica del socket queda como mejora.

## 7. IDOR / acceso entre empresas — CORREGIDO

- **Riesgo original:** dos fugas reales sobre `main`:
  1. `analytics.getLeadsByStage` usaba un `pipelineId` del cliente sin comprobar
     que el embudo fuera de la empresa → filtraba ids/nombres/orden de las
     etapas de otra empresa.
  2. `task-suggestions.aprobar` creaba una tarea con un `assignedTo` del cliente
     sin validar la empresa → **escritura cross-tenant** (tarea asignada a un
     usuario de otra empresa).
- **Corrección:** `getLeadsByStage` filtra por `pipeline: { companyId }`;
  `aprobar` valida el `assignedTo` contra `{ companyId, isActive }` antes de
  crear. El resto de operaciones ya derivan `companyId` de la sesión.
- **Archivos:** `analytics.service.ts`, `tasks/task-suggestions.service.ts`.
- **Pruebas:** unit negativa de aislamiento en `analytics.service.spec.ts`; e2e
  A→B en `test/task-suggestions.e2e-spec.ts` (asignar a usuario de otra empresa
  → rechazo, sin crear tarea, propuesta sigue PENDING).
- **Riesgo residual:** sin RLS por debajo (control 4). Varios listados siguen
  sin `take` por defecto (disponibilidad, no aislamiento) — ver control 17.

## 8. Mass assignment — VERIFICADO

`ValidationPipe` global con `whitelist + forbidNonWhitelisted + transform`
(`main.ts`): cualquier campo desconocido es 400. `companyId` no está en ningún
DTO y se añade siempre DESPUÉS del spread; `role` acotado a `['ADMIN','AGENT']`
(SUPER_ADMIN no acuñable desde la API de empresa); totales de cotización siempre
recalculados en servidor. Cubierto por `dto-tenant-whitelist.spec.ts`.
Deuda menor documentada: 7 `@Body()` con tipo inline (no-DTO) que hoy no escriben
en Prisma pero saltan el pipe — promoverlos a DTO queda pendiente.

## 9. Cookies y sesiones / CSRF — CORREGIDO

- **VERIFICADO:** refresh cookie `httpOnly`, `secure` en producción,
  `SameSite=Lax`, `path=/api/auth`, sin `Domain` (host-only), rotación atómica
  (CAS), revocación efectiva. Access token en memoria en el frontend, nunca en
  `localStorage`. `CookieOriginGuard` (allowlist de Origin) en login/refresh/
  logout/forgot/reset; CORS con orígenes exactos y credenciales, sin comodines.
- **CORREGIDO:** `POST /onboarding/company` acuña la cookie de sesión del ADMIN
  y **antes no tenía `CookieOriginGuard`**; ahora sí. Añadido el header
  `X-Onboarding-Invite-Code` al allowlist de CORS (lo exige el flujo multipart).
- **Archivos:** `onboarding.controller.ts`, `onboarding.module.ts`,
  `security/cors.options.ts`.
- **Riesgo residual:** sin detección de reutilización de refresh token (deuda ya
  documentada en `docs/AUTH_SESSION_SECURITY.md`); `__Host-` es incompatible con
  el `path=/api/auth` actual (aceptado).

## 10. Hash de contraseñas — VERIFICADO

bcrypt (bcryptjs) coste 10, sal automática por contraseña, comparación segura,
`passwordHash` nunca devuelto en respuestas de lectura, sin registro de
contraseñas, mensajes de login/recuperación genéricos (sin enumeración). Tokens
de invitación/reset/refresh almacenados como hash. Deuda documentada: coste 10
es algo bajo para 2026 (12 recomendado) y está fijo en código; subirlo con
rehash progresivo queda como mejora.

## 11. Rate limiting del login — CORREGIDO

- **VERIFICADO:** `@nestjs/throttler` con límites por endpoint (login 10/min por
  IP, refresh 30/min por dispositivo, reset 5/min, etc.), respuesta 429, IP real
  detrás de Caddy (`trust proxy 1`), sin bloqueos permanentes.
- **CORREGIDO (fase 2):** store **compartido en Redis** (`RedisThrottlerStorage`,
  incremento atómico por Lua que también gestiona la ventana de bloqueo), así N
  réplicas comparten el cupo (antes cada límite se multiplicaba por proceso). Se
  selecciona solo fuera de pruebas y con la cola habilitada; en pruebas/cola-off
  cae al store en memoria determinista. **Fail-open** ante corte de Redis
  (mejor que 500 a todos), acotado por `commandTimeout`. Cubierto por
  `redis-throttler.e2e-spec.ts` contra un Redis real (conteo de ventana,
  bloqueo, aislamiento por throttler, fail-open).
- **Deuda menor documentada:** `POST /auth/logout` sin throttle específico (cae
  al default 300/min).

## 12. Antibot — CORREGIDO (adaptador completo)

- **CORREGIDO (fase 2):** integración antibot **desacoplada** (`common/captcha`):
  - `CaptchaService` + `CaptchaGuard` detrás de una interfaz de proveedor.
  - `FakeCaptchaProvider` (tokens deterministas) para local/tests.
  - `TurnstileCaptchaProvider`: verificación **server-side** de Cloudflare
    Turnstile con timeout, **fail-closed** ante red/timeout/fallo, validación de
    action/hostname; el secret vive solo en backend; nunca registra el token.
  - Selección de proveedor por entorno; el falso queda **vetado en producción**.
  - `CaptchaGuard` es no-op salvo `CAPTCHA_ENABLED=true`; entonces fail-closed
    (403 sin token verificado). Conectado a `POST /auth/login`.
  - `env.validation`: con el control activo y Turnstile, `TURNSTILE_SECRET_KEY`
    es obligatorio al arranque; en producción el proveedor debe ser Turnstile.
  - Cubierto por `captcha.spec.ts` y `env.validation.spec.ts`.
- **Única acción pendiente (P2, humana):** crear la cuenta/claves reales de
  Turnstile (site key pública en frontend, secret en backend) y poner
  `CAPTCHA_ENABLED=true`. No se conectan claves reales aquí.

## 13. Parametrización de consultas — VERIFICADO

0 `$queryRawUnsafe`/`$executeRawUnsafe`, 0 SQL concatenado. Los ~8 usos de
`$queryRaw`/`$executeRaw` usan template tags con parámetros ligados; los
identificadores dinámicos (p. ej. campo de logo) salen de un ternario cerrado,
nunca de texto libre. Ningún `orderBy` se construye desde input del cliente.
Migraciones sin `CREATE FUNCTION`/`EXECUTE`/`format()`.

## 14. Validación y normalización de inputs — VERIFICADO / PARCIAL

`ValidationPipe` global (whitelist, forbidNonWhitelisted, transform); DTOs con
class-validator (UUID, email, enums, longitudes); webhook Meta validado por HMAC
antes de procesar; body limits 1 MB. PARCIAL: 7 controladores con `@Body()`
inline sin DTO (control 8) — deuda documentada.

## 15. Escape y saneo de contenido — CORREGIDO

- **VERIFICADO:** React escapa por defecto; 0 `dangerouslySetInnerHTML` en el
  frontend; sin librería de markdown/HTML de usuario; mensajes de WhatsApp se
  renderizan como texto.
- **CORREGIDO:** helper central `src/lib/safe-url.ts`
  (`isSafeInternalPath`/`isSafeHttpUrl`) aplicado a **todos** los sinks de URL de
  origen externo:
  - **Open redirect real** vía `?volverA=` (llegaba a `<Link href>` y
    `router.push` sin validar) en la ficha de contacto, el parseo de la bandeja
    (`inbox-url.ts`) y `PerfilComercial`.
  - `actionUrl` de notificaciones: de `startsWith('/')` (aceptaba
    `//host`) a comprobación estricta de ruta interna.
  - `imageUrl` de producto validado a http(s) antes de enviar y antes de
    renderizar en `<img>` (bloquea `javascript:`/`data:`/`blob:`).
  - `window.open` de impresión con `'noopener'`.
- **Archivos:** `src/lib/safe-url.ts` (+ test), `contacts/[id]/page.tsx`,
  `inbox-url.ts`, `PerfilComercial.tsx`, `NotificationBell.tsx`,
  `notifications/page.tsx`, `ProductModal.tsx`, `products/page.tsx`,
  `QuoteDetailModal.tsx`.
- **Pruebas:** `src/lib/safe-url.test.ts` (payloads `//host`, `javascript:`,
  `data:`, etc.). Sin exportaciones CSV/PDF con contenido de usuario sin
  neutralizar del lado del frontend; la inyección de fórmulas se neutraliza en
  la ingesta del backend (control 16).
- **Riesgo residual:** `img-src https:` permite cargar imágenes de terceros
  (fuga de referer/IP) — riesgo aceptado y documentado en `SECURITY_HEADERS.md`.

## 16. Subida de archivos — PARCIAL

- **VERIFICADO:** logos con verificación de **magic bytes** (no confía en
  extensión/MIME), nombre generado por servidor, ruta por `companyId` de la
  sesión (sin traversal), límites de tamaño; import de productos en streaming
  que solo emite texto de celda (sin extracción de imágenes) y neutraliza
  fórmulas (`= + - @`) en la ingesta.
- **CORREGIDO:** el servido estático de `/uploads` ahora usa `index:false`
  (no enumera ids de empresa), `dotfiles:deny`, `nosniff` y `Content-Disposition`
  (`main.ts`).
- **PARCIAL / documentado:**
  - El import valida la extensión por `originalname` sin comprobar la firma ZIP
    del `.xlsx` (mitigado porque el lector lanza con un no-xlsx). La documentación
    interna afirmaba que la firma se comprobaba: **corregido el drift** — no se
    comprueba; queda como deuda añadir la firma ZIP/OOXML.
  - `/uploads` sigue siendo público (los `<img>` del frontend lo cargan sin
    cabecera de auth), así que la **confidencialidad entre empresas de los logos
    depende de la no-adivinabilidad del nombre**, no de autorización. Servir los
    archivos por un controlador con auth por empresa queda como mejora.

## 17. Recorte de respuestas de API — CORREGIDO

- **Riesgo original:** `POST /api/users` devolvía el hash bcrypt del usuario
  recién creado (sin `select`).
- **Corrección:** `select` explícito en `UsersService.create` (sin `password`);
  comentario en `findByEmail` marcando que es el único camino que devuelve el
  hash (login) y jamás debe llegar a una respuesta.
- **Archivos:** `users.service.ts`.
- **VERIFICADO:** tokens/hashes, tokens OAuth cifrados, config SMTP y datos de
  otras empresas no se devuelven; export de compliance excluye secretos;
  flowbot export redacta.
- **Riesgo residual:** varios listados sin `take` por defecto (quotes, users,
  notes, historial de lead, kanban, automations) — disponibilidad, no fuga de
  campos. Añadir un tope por defecto queda como mejora.

## 18. Headers de seguridad — VERIFICADO

Backend (Helmet): CSP `default-src 'none'`, `frame-ancestors 'none'`, `nosniff`,
`Referrer-Policy`, `Permissions-Policy`, `X-Powered-By` retirado, HSTS delegado a
Caddy. Frontend: CSP en `next.config.ts`/`csp.ts` (`connect-src` incluye
`wss://` del API, sin `unsafe-eval` en producción; `unsafe-inline` documentado
como deuda de Next/Turbopack), `X-Frame-Options: DENY`, COOP, `poweredByHeader:
false`. Caddy: HSTS y `-Server`. Cubierto por specs de headers y `smoke-test.sh`.

## 19. Forzar HTTPS — VERIFICADO / PARCIAL

- **VERIFICADO (config versionada):** Caddy termina TLS con redirección
  HTTP→HTTPS implícita, HSTS, cookies `secure` en producción, `X-Forwarded-Proto`
  correcto con `trust proxy 1`, backend/Postgres/Redis no expuestos, WebSockets
  sobre `wss://`. Sin tocar el VPS real.
- **PARCIAL / documentado:** no hay TLS entre backend/worker y PostgreSQL
  (`sslmode` ausente). Aceptable con la topología actual (red Docker `internal`);
  añadir `?sslmode=require` exige habilitar TLS en Postgres primero, por eso NO
  se puso en la plantilla (rompería la conexión). Documentado para el momento en
  que Postgres salga del host. Timeouts de borde en Caddy: mejora pendiente.

## 20. Escaneo de dependencias y cadena de suministro — CORREGIDO

- **Corrección:** nuevo `.github/workflows/security.yml` (solo lectura, push/PR +
  semanal): **gitleaks** (historial completo, con `.gitleaks.toml`),
  **npm audit** de backend y frontend (falla en CRITICAL por política, reporta
  HIGH) y **CodeQL** (javascript-typescript, security-extended). `ci.yml` con
  `permissions: contents: read` y acciones fijadas por SHA (v4.4.0). Nuevo
  `.github/dependabot.yml` (npm ×2, github-actions, docker).
- **Auditoría de dependencias (estado real):** 0 críticas. Altas/moderadas
  aceptadas y documentadas (sin arreglo no-rompedor disponible):
  - Backend: cadena del **CLI de Prisma** (`deepmerge-ts` DoS por recursión al
    cargar config) — no explotable con input de usuario en runtime; `exceljs→uuid`
    (moderada). Arreglo exige downgrade rompedor de exceljs.
  - Frontend: **`sharp`/libvips** (optimizador de imágenes de Next) — arreglo
    exige subir Next fuera del rango declarado.
  - Estos altos se resuelven vía Dependabot cuando haya versión compatible; el
    CI reporta pero no bloquea (política: bloquear solo en críticas).
- **Scripts postinstall revisados:** `prisma`/`@prisma/engines`/`msgpackr-extract`
  /`unrs-resolver` (todos conocidos y legítimos).

---

## Acciones humanas inevitables (resumen; detalle en USER_ACTIONS_REQUIRED.md)

1. **P0** — Rotar las credenciales mostradas en salida en la fase 1 (nombres en
   `USER_ACTIONS_REQUIRED.md`), en especial el token de Meta legacy. Ninguna
   está en Git (gitleaks `--all` limpio).
2. **P1** — Separar el rol de PostgreSQL de migración/runtime para **activar** el
   RLS ya preparado y probado (control 4).
3. **P2** — Conectar las claves reales de Turnstile y poner `CAPTCHA_ENABLED=true`
   (control 12; el adaptador ya está implementado y probado).
4. **P2** — Habilitar TLS en Postgres y añadir `sslmode=require` cuando salga del
   host (control 19; documentado).

El rate limiting distribuido en Redis (antes P2) quedó **implementado** en la
fase 2 (control 11).
