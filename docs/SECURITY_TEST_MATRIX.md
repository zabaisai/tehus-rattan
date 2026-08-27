# TAKTO — Matriz de pruebas de seguridad

Estado de las pruebas mínimas exigidas, contra el código real de `main`.
`✅` = cubierto (test verde) · `➕` = test añadido en este trabajo · `📄` =
verificado por configuración/escaneo, no por test unit/e2e · `⬜` = no cubierto
(deuda documentada).

| Escenario de prueba | Estado | Dónde |
|---------------------|--------|-------|
| Acceso empresa A → datos empresa B | ✅ | `src/modules/multitenant-ownership.spec.ts` (Notes/Messages/Conversations/Leads/LeadProducts/Quotes/Tasks/Contacts); `test/search-tenant-isolation.e2e-spec.ts`; `whatsapp-tenant-isolation.spec.ts` |
| IDOR por identificadores directos | ✅ | `test/business-tenant-guard.e2e-spec.ts`, `multitenant-ownership.spec.ts` |
| IDOR analytics (pipelineId ajeno) | ➕ | `src/modules/analytics/analytics.service.spec.ts` (getLeadsByStage — pertenencia por `pipeline.companyId`) |
| Escritura cross-tenant (assignedTo ajeno) | ➕ | `test/task-suggestions.e2e-spec.ts` (aprobar con usuario de otra empresa → rechazo, sin crear tarea) |
| Mass assignment (campos prohibidos) | ✅ | `src/modules/dto-tenant-whitelist.spec.ts` (12 DTOs, `companyId`/`role`/`status` rechazados) |
| Rutas privadas sin token | ✅ | `test/auth-guard.e2e-spec.ts` |
| Rutas administrativas con rol incorrecto | ✅ | `test/roles-guard.e2e-spec.ts`, `test/permissions.e2e-spec.ts`, `platform.guard.spec.ts` |
| Sesión revocada (REST) | ✅ | `test/session-revocation.e2e-spec.ts`, `jwt.strategy.spec.ts` |
| Sesión revocada (WebSocket) | ➕ | `test/realtime.e2e-spec.ts` (token de sesión revocada NO abre canal); `src/common/realtime/realtime.auth.spec.ts` |
| Reutilización de refresh token | 📄 | Rotación CAS cubierta (`sessions.service`); detección de reutilización = deuda documentada (control 9) |
| Cookies y CSRF | ✅ | `test/cors.e2e-spec.ts`, `cookie-origin.guard.spec.ts`; onboarding ahora con `CookieOriginGuard` |
| Rate limiting | ✅ | throttler por endpoint (specs de auth/webhook); FlowBot rate/circuit e2e con Redis real |
| Enumeración de usuarios (login/recuperación) | ✅ | mensajes genéricos (`auth.service`, `password-recovery`) |
| Enumeración de usuarios (onboarding) | ➕ | `src/modules/onboarding/onboarding.service.spec.ts` (código validado antes de emails; mensaje genérico; sin listar direcciones) |
| SQL injection | 📄/✅ | 0 raw unsafe (control 13); `restore-postgres.sh` regex de identificador cubierto por `backup-safety.test.sh` |
| XSS y URLs peligrosas | ➕ | `apps/frontend/src/lib/safe-url.test.ts` (`//host`, `javascript:`, `data:`, `blob:`) |
| CSV/fórmula injection (import) | ✅ | neutralización en ingesta (`lector-streaming` `sanearCelda`); cubierto en specs de import |
| Archivos con extensión falsa (logo) | ✅ | verificación por magic bytes en `company-branding.service` (+ specs) |
| Archivos sobredimensionados | ✅ | límites Multer + filtro de tamaño (specs de import/branding) |
| Path traversal (uploads) | ✅ | nombre generado por servidor, ruta por `companyId` de sesión; `/uploads` con `dotfiles:deny`/`index:false` |
| Ausencia de campos sensibles en respuestas | ➕/✅ | `POST /users` ya no devuelve el hash (`users.service`); selects explícitos; `analytics` sin metadata sensible |
| Headers de seguridad | ✅ | `test/security-headers.e2e-spec.ts`, `apps/frontend/src/lib/csp.test.ts`, `smoke-test.sh` |
| Webhook GET verify fail-closed / no reflexión | ➕ | `test/webhook-verify.e2e-spec.ts` (sin token → 403; challenge como `text/plain`) |
| Validación de variables de entorno | ➕ | `src/common/config/env.validation.spec.ts` (JWT/DATABASE_URL/clave cifrado/Turnstile, gating por producción) |
| Escaneo de secretos | ➕ | `.github/workflows/security.yml` (gitleaks) + `.gitleaks.toml`; escaneo local limpio |
| Deny-by-default (ruta privada sin token) | ➕ | `test/deny-by-default.e2e-spec.ts` (AppModule real: públicas 200, privadas 401) |
| Cifrado: KDF versionado + compatibilidad legacy + rotación | ➕ | `src/modules/whatsapp-token-crypto.compat.spec.ts` |
| Rate limiting distribuido (Redis, atómico, fail-open) | ➕ | `test/redis-throttler.e2e-spec.ts` (Redis real) |
| Antibot: fail-closed y verificación server-side | ➕ | `src/common/captcha/captcha.spec.ts` |
| RLS con el usuario runtime real (aislamiento + WITH CHECK) | ➕ | `prisma/rls/proof.mjs` + `test/rls-integration.e2e-spec.ts` (cliente Prisma real, rol sin BYPASSRLS) — verde |
| Contexto de empresa sin fugas entre conexiones | ➕ | `test/rls-integration.e2e-spec.ts` (40 contextos A/B concurrentes, transaction-scoped) |
| Rate limiting fail-safe ante caída de Redis (nunca ilimitado) | ➕ | `redis-throttler.storage.spec.ts` (degradación→local→recuperación) |
| Límite por cuenta normalizada (login/recuperación) | ➕ | `account-throttle.guard.spec.ts` |
| Antibot frontend (widget, verify, expiración) | ➕ | `TurnstileWidget.test.tsx`, `turnstile.test.ts`, `csp.test.ts` |
| Rehash progresivo de contraseñas (coste 10→12) | ➕ | `password-hash.service.spec.ts` |
| DTOs de inputs (campos desconocidos, tipos, longitudes) | ➕ | `dto-inline-converted.spec.ts` |
| Uploads: firma ZIP, zip-bomb, traversal, MIME/extensión falsa | ➕ | `validacion-contenido.spec.ts` (incl. xlsx real y CSV binario/HTML) |
| Tope máximo por listado (anti-runaway) | ➕ | `contacts.service.spec` + `automations.service.spec` |
| TLS de Postgres (verify-full conecta, no-TLS rechazado) | ➕ | `deploy/scripts/test-postgres-tls.sh` (Linux/CI; certificados ficticios) |

## Comandos de verificación ejecutados (local, sobre `main`)

| Comando | Resultado |
|---------|-----------|
| Backend — unit (`npm test -- --runInBand`) | 136 suites / **2186** ✅ |
| Backend — e2e (`npm run test:e2e`, base temporal) | 67 suites / **966** ✅ |
| Backend — typecheck (`npm run typecheck`) | ✅ |
| Backend — lint (`eslint --no-fix`, como CI) | ✅ |
| Backend — build (`nest build`) | ✅ |
| Frontend — tests (`npm test`, vitest) | 87 archivos / **948** ✅ |
| Frontend — lint / build | ✅ (1 warning preexistente ajeno) |
| `prisma migrate deploy` (base temporal vacía) | 58 migraciones aplicadas ✅ |
| `prisma validate` | ✅ |
| RLS proof (`node prisma/rls/proof.mjs`, base aislada) | ✅ aislamiento con rol runtime real |
| gitleaks (HEAD, `--all`, y commits de la rama) | *no leaks found* ✅ |
| `npm audit --omit=dev --audit-level=critical` (back/front) | 0 críticas (gate PASS); altas documentadas |
| `git diff --check` | sin errores de espacios |

Línea base (sobre `main`, antes de tocar nada): backend 134/2159 unit. Tras las
dos fases: **136/2186 unit + 67/966 e2e + 948 frontend**, sin regresiones.
Ningún fallo ocultado ni test debilitado para pasar (los tests que cambiaron de
aserción lo hicieron porque el comportamiento nuevo es MÁS seguro — mensajes
anti-enumeración genéricos, formato de cifrado v2).
