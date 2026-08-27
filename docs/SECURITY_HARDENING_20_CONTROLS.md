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
| 4 | Row-Level Security de PostgreSQL | BLOQUEADO (precondición: separar rol de migración/runtime) |
| 5 | Cifrado | PARCIAL |
| 6 | Autenticación obligatoria por defecto | CORREGIDO / PARCIAL |
| 7 | IDOR / acceso entre empresas | CORREGIDO |
| 8 | Mass assignment | VERIFICADO |
| 9 | Cookies y sesiones / CSRF | CORREGIDO |
| 10 | Hash de contraseñas | VERIFICADO |
| 11 | Rate limiting del login | PARCIAL |
| 12 | Antibot | BLOQUEADO (no implementado; requiere decisión y claves) |
| 13 | Parametrización de consultas | VERIFICADO |
| 14 | Validación y normalización de inputs | VERIFICADO / PARCIAL |
| 15 | Escape y saneo de contenido | CORREGIDO |
| 16 | Subida de archivos | PARCIAL |
| 17 | Recorte de respuestas de API | CORREGIDO |
| 18 | Headers de seguridad | VERIFICADO |
| 19 | Forzar HTTPS | VERIFICADO / PARCIAL |
| 20 | Escaneo de dependencias y cadena de suministro | CORREGIDO |

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

## 4. Row-Level Security de PostgreSQL — BLOQUEADO

- **Riesgo original:** el aislamiento multiempresa es 100% de aplicación; un
  `where` sin `companyId` olvidado es una fuga sin red de seguridad por debajo.
- **Evidencia:** 0 `CREATE POLICY` / `ROW LEVEL SECURITY` en 58 migraciones;
  `prisma.service.ts` sin `$extends`/`$use`; `DATABASE_URL` único para migración
  y runtime (propietario de tablas → omitiría RLS aunque se activara).
- **Estado:** BLOQUEADO. Activar RLS de forma honesta exige **primero** separar
  el rol de migración (DDL, propietario) del rol runtime (DML, sujeto a RLS, sin
  `BYPASSRLS`), lo que a su vez requiere cambios de infraestructura y de
  `DATABASE_URL` que no pueden ejecutarse contra bases reales en esta sesión.
- **Acción pendiente (P1, humana):** crear el rol `takto_app` sin `BYPASSRLS` ni
  propiedad de tablas; luego una migración aditiva con `ENABLE ROW LEVEL
  SECURITY` + `FORCE` + políticas por `companyId` usando
  `current_setting('app.company_id', true)` establecido de forma transaccional
  (`set_config(..., true)`), y un guard/`$extends` de Prisma que fije ese
  contexto por petición. Se documenta como plan en `PROCESS_MAP.md`. No se finge
  RLS activo. Los filtros de aplicación por `companyId` permanecen intactos.

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
- **Riesgo residual (documentado):** la derivación de clave es un `sha256(raw)`
  sin sal ni KDF y el blob no versiona la clave. Cambiarlo rompería los
  ciphertexts existentes, así que se mitiga exigiendo longitud/entropía mínima y
  se deja como deuda (migrar a scrypt/HKDF con prefijo de versión en una
  ventana de rotación). TLS para PostgreSQL: ver control 19.

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
- **PARCIAL / documentado:**
  - No hay guard global de autenticación con `@Public()`; la auth es opt-in por
    controlador (hoy los 33 controladores privados lo llevan, pero un
    controlador nuevo nace público). Se documenta como deuda; introducir un
    `APP_GUARD` global con decorador `@Public()` es un cambio transversal
    pendiente de una fase dedicada.
  - Un socket ya conectado sigue vivo hasta expirar el token (15 min) tras una
    revocación: cierra el canal nuevo, no el existente. Revalidación periódica
    del socket queda como mejora.

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

## 11. Rate limiting del login — PARCIAL

- **VERIFICADO:** `@nestjs/throttler` con límites por endpoint (login 10/min por
  IP, refresh 30/min por dispositivo, reset 5/min, etc.), respuesta 429, IP real
  detrás de Caddy (`trust proxy 1`), sin bloqueos permanentes.
- **PARCIAL / documentado:** el store es **en memoria**, por proceso. Con varias
  réplicas cada límite se multiplica. Redis ya está disponible en el stack; migrar
  el throttler a un store Redis compartido queda como acción pendiente (ya
  reconocida en `docs/AUTH_SESSION_SECURITY.md`). `POST /auth/logout` sin throttle
  específico (cae al default 300/min) — deuda menor.

## 12. Antibot — BLOQUEADO

No existe proveedor antibot (Turnstile/reCAPTCHA) en el código. Implementar una
integración desacoplada fail-closed con adaptador falso para local/tests, y
conectar cuentas/claves reales, es una acción con decisión de producto y
credenciales externas: se deja como **acción humana P2** documentada en
`USER_ACTIONS_REQUIRED.md`. Mitigación actual: rate limiting por endpoint y
mensajes anti-enumeración.

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

1. **P0** — Rotar el token de acceso de Meta legacy (estaba en el `.env` local,
   no en Git).
2. **P1** — Separar el rol de PostgreSQL de migración/runtime y activar RLS.
3. **P2** — Decidir e integrar un proveedor antibot (control 12).
4. **P2** — Migrar el rate limiting a un store Redis compartido (control 11).
