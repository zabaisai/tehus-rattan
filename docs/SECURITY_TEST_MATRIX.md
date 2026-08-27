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
| RLS con el usuario runtime real | ⬜ | BLOQUEADO (control 4 — precondición: separar roles de BD) |
| Contexto de empresa sin fugas entre conexiones | ⬜ | Aplica al implementar RLS transaction-scoped (control 4) |
| Validación de variables de entorno | ➕ | `src/common/config/env.validation.spec.ts` (JWT/DATABASE_URL/clave cifrado, gating por producción) |
| Escaneo de secretos | ➕ | `.github/workflows/security.yml` (gitleaks) + `.gitleaks.toml`; escaneo local limpio |

## Comandos de verificación ejecutados (local, sobre `main`)

| Comando | Resultado |
|---------|-----------|
| Backend — unit (`npm test -- --runInBand`) | 134 suites / **2166** ✅ |
| Backend — e2e (`npm run test:e2e`, base temporal) | 65 suites / **957** ✅ |
| Backend — typecheck (`npm run typecheck`) | ✅ |
| Frontend — tests (`npm test`, vitest) | 87 archivos / **948** ✅ |
| Frontend — build (`npm run build`) | ✅ compila |
| `prisma migrate deploy` (base temporal vacía) | 58 migraciones aplicadas ✅ |
| `prisma validate` | ✅ (en CI) |
| gitleaks (HEAD y `--all`) | *no leaks found* ✅ |
| `npm audit --omit=dev` (backend/frontend) | 0 críticas; altas documentadas (control 20) |
| `git diff --check` | sin errores de espacios |

Línea base (antes de tocar nada, sobre `main`): backend 134/2159 unit,
frontend 25/120 (subset) → tras los cambios 134/2166 unit + 87/948 frontend, sin
regresiones. Ningún fallo ocultado ni test debilitado para pasar.
