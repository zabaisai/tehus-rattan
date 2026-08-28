# TAKTO — Endurecimiento de seguridad: los 20 controles

Trabajo sobre la rama `fix/security-hardening-20-controls` (base `origin/main`, el
producto real). **Nada desplegado, ninguna migración en bases reales, ningún
secreto nuevo, ningún cambio destructivo, ningún servicio real activado.**

## Estados (vocabulario único)

- **CORREGIDO Y VERIFICADO** — arreglado y probado; sin trabajo pendiente.
- **CÓDIGO COMPLETO — PENDIENTE CONFIGURACIÓN** — frontend+backend listos; solo
  falta poner claves/valores reales.
- **PREPARADO Y PROBADO LOCALMENTE — PENDIENTE ACTIVACIÓN** — código y pruebas
  hechos; falta un paso de infraestructura para activarlo en un entorno real.
- **PREPARADO Y PROBADO EN CI — PENDIENTE ACTIVACIÓN REAL** — la configuración
  objetivo pasó una prueba automatizada aislada, pero todavía no está activa en
  la infraestructura real.
- **BLOQUEADO POR ACCIÓN HUMANA** — requiere una decisión/acción humana antes de
  poder hacerse.
- **RIESGO ACEPTADO Y JUSTIFICADO** — se decide no cambiarlo, con motivo.

## Matriz de los 20 controles

| # | Control | Estado | Evidencia / archivos | Pruebas | Riesgo residual / acción |
|---|---------|--------|----------------------|---------|--------------------------|
| 1 | Ocultar API keys y secretos | CORREGIDO Y VERIFICADO | `.gitignore`, `.env.example`, `.gitleaks.toml`; token legacy fuera del `.env` local | gitleaks limpio; validación de entorno al arranque | Rotar credenciales mostradas (P0, humana) |
| 2 | Purga de secretos del historial Git | CORREGIDO Y VERIFICADO | `.gitleaks.toml`; CI `security.yml` | gitleaks `--all` (todas las ramas): *no leaks* | — |
| 3 | “Key pública de BD” (adaptación PG) | CORREGIDO Y VERIFICADO | sin `NEXT_PUBLIC_DATABASE_URL`; PG no expuesto | grep frontend; topología compose | Separar rol de BD → control 4 |
| 4 | Row-Level Security de PostgreSQL | PREPARADO Y PROBADO DE FORMA AISLADA — ADOPCIÓN EN SERVICIOS PENDIENTE | `prisma/rls/*`, `src/prisma/tenant-context.*`, `deploy/rls/init-runtime-role.sql.example` | `proof.mjs` + `rls-integration.e2e` (mecanismo OK) **y** `rls-real-path.e2e` (evidencia: los servicios con `this.prisma` directo NO quedan protegidos) | **Los 67 servicios usan `this.prisma` directo, sin `runWithTenant`.** Adoptar el contexto en servicios/jobs/worker/WS + separar rol de BD (P1) |
| 5 | Cifrado | CORREGIDO Y VERIFICADO | `whatsapp-token-crypto.service.ts` (AES-256-GCM + KDF scrypt versionado `v2:`) | `whatsapp-token-crypto.compat.spec.ts` (16) | TLS a Postgres → control 19 |
| 6 | Autenticación obligatoria por defecto | CORREGIDO Y VERIFICADO | guard global `GlobalJwtAuthGuard` + `@Public()`; realtime valida sesión en el handshake | `deny-by-default.e2e`, `realtime.*`, `jwt.strategy` | Revalidación de socket vivo (deuda menor) |
| 7 | IDOR / acceso entre empresas | CORREGIDO Y VERIFICADO | `analytics.service.ts`, `task-suggestions.service.ts` | `analytics.service.spec`, `test/task-suggestions.e2e`, `multitenant-ownership.spec` | RLS como 2ª barrera → control 4 |
| 8 | Mass assignment | CORREGIDO Y VERIFICADO | `ValidationPipe` global; DTOs con whitelist | `dto-tenant-whitelist.spec`, `dto-inline-converted.spec` | — |
| 9 | Cookies y sesiones / CSRF | CORREGIDO Y VERIFICADO | `CookieOriginGuard` (incl. onboarding); CORS exacto + header de invitación | `cookie-origin.guard.spec`, `cors.e2e` | Detección de reutilización de refresh token (deuda) |
| 10 | Hash de contraseñas | CORREGIDO Y VERIFICADO | `PasswordHashService` (coste 12 + rehash progresivo) | `password-hash.service.spec`, `env.validation.spec` | — |
| 11 | Rate limiting del login | CORREGIDO Y VERIFICADO | `RedisThrottlerStorage` (fail-SAFE con fallback local) + `AccountThrottleGuard` (por cuenta) | `redis-throttler.storage.spec`, `account-throttle.guard.spec`, `redis-throttler.e2e` | — |
| 12 | Antibot | CÓDIGO COMPLETO — PENDIENTE CONFIGURACIÓN | backend `common/captcha/*` (Turnstile fail-closed) + frontend `TurnstileWidget` en login | `captcha.spec`, `TurnstileWidget.test`, `turnstile.test`, `csp.test` | Crear claves reales de Turnstile + `CAPTCHA_ENABLED=true` (P2) |
| 13 | Parametrización de consultas | CORREGIDO Y VERIFICADO | 0 raw unsafe; sin SQL concatenado ni orderBy de input | revisión + `restore-postgres` regex | — |
| 14 | Validación y normalización de inputs | CORREGIDO Y VERIFICADO | `ValidationPipe` global; 7 `@Body()` inline → DTOs; webhook `body:any` documentado (HMAC) | `dto-inline-converted.spec` | Webhook Meta sin DTO (justificado) |
| 15 | Escape y saneo de contenido | CORREGIDO Y VERIFICADO | `src/lib/safe-url.ts` en todos los sinks de URL | `safe-url.test` | `img-src https:` (aceptado, doc) |
| 16 | Subida de archivos | CORREGIDO Y VERIFICADO | validación de contenido `validacion-contenido.ts` (firma ZIP, anti-bomba, traversal, CSV); servido SOLO de `uploads/branding` | `validacion-contenido.spec` (firma falsa, bomba×2, traversal, xlsx real, csv binario/HTML) | Logos públicos = RIESGO ACEPTADO Y JUSTIFICADO (categoría pública explícita) |
| 17 | Recorte de respuestas de API | CORREGIDO Y VERIFICADO | `select` explícitos (sin passwordHash); `MAX_LIST_ROWS` en todo listado | specs de servicios + caps | — |
| 18 | Headers de seguridad | CORREGIDO Y VERIFICADO | Helmet + CSP (`csp.ts`) + Caddy | `security-headers.e2e`, `csp.test`, `smoke-test.sh` | `script-src 'unsafe-inline'` (deuda Next, doc) |
| 19 | Forzar HTTPS | CORREGIDO Y VERIFICADO (edge); TLS de BD: PREPARADO Y PROBADO EN CI — PENDIENTE ACTIVACIÓN REAL | Caddy TLS/HSTS; `docs/POSTGRES_TLS.md`, `deploy/scripts/test-postgres-tls.sh`, job `postgres-tls` | `security-headers.e2e`, `csp.test`, `smoke-test.sh`; CI Linux: verify-full+CA conecta, no-TLS rechazado y verify-full sin CA falla | La BD real sigue sin TLS mientras PostgreSQL permanezca en la red Docker privada del mismo host; activarlo al salir del host (P2) |
| 20 | Escaneo de dependencias y cadena de suministro | CORREGIDO Y VERIFICADO | `security.yml` (gitleaks/npm-audit/CodeQL) + `dependabot.yml`; **frontend 0 vulns** (next 16.3.3) | `npm audit` back/front; `validacion-contenido.spec` (gate previo a exceljs) | Backend: altas del **CLI de Prisma** (devDependency, no runtime) + moderada de **exceljs→uuid** NO alcanzable por archivo del usuario → RIESGO ACEPTADO Y JUSTIFICADO (ver tabla de vulnerabilidades) |

## Detalle por control

### 1. Ocultar API keys y secretos — CORREGIDO Y VERIFICADO
Sin secretos en código fuente ni con prefijo `NEXT_PUBLIC_*`. `.gitignore` ignora
todo `.env*` (solo `*.example` versionados) y material de claves. `.env.example`
documenta variables con placeholders. Validación de variables obligatorias al
arranque (`env.validation.ts`), fail-closed en producción, sin imprimir valores.
El token de Meta legacy se retiró del `.env` local; su rotación es acción humana.

### 2. Purga de secretos del historial — CORREGIDO Y VERIFICADO
gitleaks 8.24 sobre `--all` (todas las ramas) → *no leaks found*. Dos falsos
positivos verificados (placeholder del starter de NestJS y fixtures de tests)
allowlistados en `.gitleaks.toml`. Integrado en CI.

### 3. “Key pública de BD” — CORREGIDO Y VERIFICADO (adaptación)
PostgreSQL + Prisma, no Supabase. El navegador nunca se conecta a PG; no existe
`NEXT_PUBLIC_DATABASE_URL`; `DATABASE_URL` solo en backend/worker/migraciones;
PG sin puerto publicado (red `internal`). La separación de roles se cubre en 4.

### 4. RLS — PREPARADO Y PROBADO DE FORMA AISLADA — ADOPCIÓN EN SERVICIOS PENDIENTE
El **mecanismo** está y probado: SQL idempotente para las 37 tablas multiempresa
(`001-enable-rls.sql`), rol runtime separado, contexto transaccional
(`runWithTenant`/`runInTenantContext` + `TenantContext` con AsyncLocalStorage) e
interceptor por petición. `rls-integration.e2e-spec.ts` lo prueba con el cliente
Prisma real y un rol runtime sin BYPASSRLS: A ve solo A, deny-by-default sin
contexto, escrituras cross-tenant bloqueadas, 40 contextos concurrentes sin fuga.

**PERO NO está adoptado en los servicios.** Los 67 servicios (más jobs, worker,
WebSocket, analytics y tareas programadas) consultan con **`this.prisma` DIRECTO,
sin `runWithTenant`**, así que la consulta no corre dentro de la transacción con
`set_config`. Con RLS activo eso devuelve 0 filas. `rls-real-path.e2e-spec.ts` lo
demuestra por el **camino REST real** (AppModule + controller + service + Prisma,
rol runtime, RLS activo): con contactos sembrados para A, `GET /api/contacts`
devuelve **vacío** — el service omite el contexto y RLS lo bloquea.

**Por qué no se adoptó de forma global ahora:** requeriría reescribir el acceso a
datos de todos los servicios o un `$extends` de Prisma que envuelva cada
operación en una transacción, lo que choca con las transacciones explícitas
(`$transaction`) ya existentes y no puede garantizarse seguro sin revisión
servicio a servicio. Hacerlo mal dejaría la app entera sin datos o permitiría
consultas que omiten las políticas. **Acción pendiente (P1):** separar el rol de
BD y adoptar `runInTenantContext` en el acceso a datos, servicio por servicio.

### 5. Cifrado — CORREGIDO Y VERIFICADO
AES-256-GCM con IV único; derivación de clave **scrypt + sal por ciphertext** en
formato versionado `v2:`, retrocompatible con los ciphertexts legacy (sha256).
Rotación con clave previa en ambos formatos. Clave fuera del repo/BD; sin texto
plano en logs. Contraseñas/tokens con hash. TLS a Postgres: control 19.

### 6. Autenticación obligatoria por defecto — CORREGIDO Y VERIFICADO
`GlobalJwtAuthGuard` (APP_GUARD) exige JWT en toda ruta salvo `@Public()`
(inventario mínimo: health, login/refresh/logout, recuperación, onboarding,
webhook). Un controlador nuevo nace protegido. El handshake de WebSocket valida
la sesión (`sid`) contra la base: una sesión revocada no abre canal nuevo.

### 7. IDOR / entre empresas — CORREGIDO Y VERIFICADO
`analytics.getLeadsByStage` filtra por `pipeline.companyId`;
`task-suggestions.aprobar` valida el `assignedTo` contra la empresa. Todas las
operaciones derivan `companyId` de la sesión. Pruebas negativas A→B.

### 8. Mass assignment — CORREGIDO Y VERIFICADO
`ValidationPipe` global (whitelist + forbidNonWhitelisted + transform).
`companyId`/roles nunca en DTOs; se fijan en servidor. Los 7 `@Body()` inline se
convirtieron a DTOs (control 14).

### 9. Cookies y sesiones / CSRF — CORREGIDO Y VERIFICADO
Refresh cookie httpOnly/secure(prod)/SameSite=Lax/path acotado; rotación CAS;
revocación por petición. `CookieOriginGuard` en login/refresh/logout/recuperación
y ahora en onboarding; CORS exacto con `X-Onboarding-Invite-Code`.

### 10. Hash de contraseñas — CORREGIDO Y VERIFICADO
`PasswordHashService`: coste objetivo (12 por defecto, ≥12 en producción, valida
env), **rehash progresivo** tras login válido de los hashes coste 10, sin cierres
masivos. Nuevas contraseñas/recuperación/invitaciones con el coste nuevo.

### 11. Rate limiting del login — CORREGIDO Y VERIFICADO
Store Redis compartido con **fallback LOCAL en memoria fail-SAFE** (una caída de
Redis NUNCA deja el límite en ilimitado; degradación/recuperación logueadas una
vez). Límite adicional **por cuenta normalizada** en login/recuperación
(complementa el de IP; frena ataque distribuido; 429 genérico anti-enumeración).

### 12. Antibot — CÓDIGO COMPLETO — PENDIENTE CONFIGURACIÓN
Backend Turnstile server-side fail-closed + proveedor falso vetado en producción;
frontend `TurnstileWidget` accesible en login, fail-closed en UI, reset tras
error/expiración, CSP relajada solo con site key. Falta crear las claves reales
de Turnstile y `CAPTCHA_ENABLED=true`.

### 13. Parametrización de consultas — CORREGIDO Y VERIFICADO
0 `$queryRawUnsafe`/`$executeRawUnsafe`, 0 SQL concatenado, sin `orderBy` de
input. Los `$queryRaw` usan parámetros ligados.

### 14. Validación de inputs — CORREGIDO Y VERIFICADO
`ValidationPipe` global; DTOs completos. Los 7 `@Body()` con tipo inline se
convirtieron a DTOs (rechazan campos desconocidos, tipos y longitudes). El
webhook de Meta mantiene `body:any` a propósito (payload de Meta, ya autenticado
por HMAC sobre el cuerpo crudo).

### 15. Escape y saneo de contenido — CORREGIDO Y VERIFICADO
`safe-url.ts` centraliza la validación de URLs de origen externo (open-redirect
`volverA`, `actionUrl`, `imageUrl`, `window.open`). 0 `dangerouslySetInnerHTML`.

### 16. Subida de archivos — CORREGIDO Y VERIFICADO
Import de productos con validación de **contenido**: firma ZIP + estructura OOXML
(anti zip-bomb por ratio y total, anti path-traversal en entradas, requiere
`[Content_Types].xml`), y CSV rechaza binario/HTML. Logos por magic bytes con
nombre generado por servidor. El servido estático se restringió a **solo**
`uploads/branding` (categoría pública explícita, imágenes, sin datos sensibles,
nombre no adivinable) — ningún otro subdirectorio se expone. La publicidad de los
logos es un **RIESGO ACEPTADO Y JUSTIFICADO**.

### 17. Recorte de respuestas de API — CORREGIDO Y VERIFICADO
`POST /users` ya no devuelve el hash (select explícito). Ningún hash/token/secreto
ni dato de otra empresa en respuestas. **`MAX_LIST_ROWS` (1000)** acota todo
listado multiempresa (guardia anti-runaway; los mensajes devuelven los más
recientes).

### 18. Headers de seguridad — CORREGIDO Y VERIFICADO
Helmet (CSP deny-by-default, nosniff, frame-ancestors, Referrer/Permissions
policy, sin X-Powered-By), CSP del frontend (sin unsafe-eval en prod; wss y
Meta/Turnstile solo cuando aplican), HSTS en Caddy. `'unsafe-inline'` en script-src
es deuda de Next documentada.

### 19. Forzar HTTPS — CORREGIDO Y VERIFICADO (edge); TLS DE BD PREPARADO Y PROBADO EN CI — PENDIENTE ACTIVACIÓN REAL
Caddy termina TLS con HSTS, cookies `secure` en producción, `X-Forwarded-Proto`
con trust proxy 1 y WebSockets `wss` (verificado). Para PostgreSQL,
`deploy/scripts/test-postgres-tls.sh` se ejecuta en GitHub Actions sobre
`ubuntu-latest` y pasó con certificados ficticios efímeros: `verify-full` con la
CA correcta conecta, `sslmode=disable` es rechazado y `verify-full` sin la CA
correcta falla. Ninguna alerta se silenció y no se usaron secretos reales.

Esta prueba valida la configuración objetivo; **no significa que la base real ya
use TLS**. Actualmente backend, worker y PostgreSQL permanecen en la red Docker
privada del mismo VPS, sin puerto publicado. TLS deberá activarse con
`verify-full` y una CA válida cuando PostgreSQL salga del host. El procedimiento
y rollback están en `docs/POSTGRES_TLS.md`.

### 20. Dependencias y cadena de suministro — CORREGIDO Y VERIFICADO
`security.yml` (gitleaks + npm audit + CodeQL) con permisos mínimos y acciones
fijadas por SHA; `dependabot.yml` (npm ×2, actions, docker). **Frontend: 0
vulnerabilidades** tras subir Next a 16.3.3 (arreglos compatibles de
next/postcss/sharp/nanoid). CI bloquea ante secreto confirmado y crítica.

**Vulnerabilidades del backend (alcance correcto, evaluadas una a una):**

| Advisory | Paquete | Instalada | Severidad | Cadena | ¿Runtime? | ¿Alcanzable por archivo del usuario? | Fix | Por qué no se aplica |
|----------|---------|-----------|-----------|--------|-----------|--------------------------------------|-----|----------------------|
| DoS por recursión de `deepmerge-ts` | `deepmerge-ts` | <8 | HIGH | `prisma`(CLI)→`@prisma/config`→`deepmerge-ts` | **No** — `prisma` es **devDependency**; el runtime usa `@prisma/client` | No — solo al cargar config en `prisma generate/migrate` | `prisma@6.12.0` (major/downgrade) | Rompe la compat con `@prisma/client 6.19.3`; es tooling de build, no runtime |
| `@prisma/config` (misma cadena) | `@prisma/config` | ≥6.13-dev | HIGH | idem | No (dev) | No | idem | idem |
| `prisma` (CLI) | `prisma` | 6.19.3 | HIGH | devDependency | No (dev) | No | idem | idem |
| GHSA-w5hq-g745-h8pq (bounds-check de `buf` en `uuid` v3/v5/v6) | `uuid` | 8.3.2 | MODERATE | `exceljs`→`uuid` | Sí (exceljs procesa XLSX del usuario) | **No** | `exceljs@3.4.0` (major/downgrade) | Ver abajo |
| `exceljs` (efecto de `uuid`) | `exceljs` | 4.4.0 | MODERATE | directo | Sí | **No** | idem | idem |

**exceljs / uuid — por qué NO es alcanzable por un XLSX del atacante:** el
advisory solo dispara al llamar `uuid.v3/v5/v6` **con un argumento `buf`**.
`exceljs` usa **`uuid.v4()` (sin `buf`)** y únicamente en el camino de
**ESCRITURA** (`cf-rule-ext-xform.js`, generación de `x14Id`). TAKTO solo **LEE**
XLSX subidos (`workbook.xlsx.load`), nunca escribe con datos del atacante, así que
el código vulnerable no se ejecuta. Además, la subida pasa antes por
`validacion-contenido.ts` (firma ZIP + estructura OOXML + anti-bomba + traversal,
`validacion-contenido.spec`), que rechaza el archivo hostil antes de exceljs.
**Riesgo residual real: nulo para este advisory.** No es “tooling” —exceljs sí
procesa archivos de usuario— pero esta vulnerabilidad concreta no es alcanzable.

**prisma-CLI:** genuinamente de desarrollo (`prisma` es devDependency; el
servidor en runtime carga `@prisma/client`, no el CLI). Seguidos por Dependabot.

## Acciones humanas restantes (mínimas, ordenadas)

1. **P0** — Rotar las credenciales mostradas en la fase 1 (nombres en
   `USER_ACTIONS_REQUIRED.md`); ninguna está en Git.
2. **P1** — RLS (control 4): **adoptar** el contexto (`runInTenantContext`) en el
   acceso a datos de los servicios/jobs/worker/WS **y** separar el rol de BD. El
   mecanismo está probado; los servicios aún consultan con `this.prisma` directo.
3. **P2** — Crear las claves reales de Turnstile y `CAPTCHA_ENABLED=true`
   (control 12).
4. **P2** — Habilitar TLS en Postgres al sacarlo del host (control 19).
