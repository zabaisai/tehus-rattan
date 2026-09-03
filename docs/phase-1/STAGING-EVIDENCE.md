# Fase 1 — Evidencia

Evidencia sanitizada de la Fase 1. Sin identificadores internos, códigos
completos, tokens ni datos de empresas reales. Fecha: 2026-09-03.

## Contexto

| Dato | Valor |
|---|---|
| Base | `origin/main` `7b7aae8` (merge del PR #17, cierre de Fase 0) |
| Rama | `feature/phase-1-takto-platform-independence` (worktree aislado) |
| Worktree principal | intacto: rama `chore/wa-signup-ops-script`, cambio ajeno `deploy/scripts/send-demo-template.mjs` y stash preexistente sin tocar |
| Staging al inicio | VPS `srv1829292`, `/opt/tehus-crm` en `main` `a95da7e`, `/api/health/version` = `a95da7e…`, `/api/health/status` ok (database, queue, worker, outbox, realtime, flowbot `up`), 6 contenedores healthy, último backup automático `tehus-backup.service` `Result=success` 2026-09-03 03:01 |
| Producción | no existe como entorno separado; no se ejecutó nada fuera de staging ni se creó DNS/certificado de producción |
| Participantes | solo el propietario y esta sesión; Asahel y Cristian no participaron |

## Pruebas (local, worktree de la fase)

| Suite | Resultado |
|---|---|
| Backend unitarias (`jest --runInBand`) | 140 suites, 2252 pruebas, 0 fallos (tras la revisión correctiva) (incluye política de acceso de controladores con el endpoint público justificado) |
| Backend typecheck (`tsc --noEmit`) | OK |
| Backend lint (`eslint --no-fix`) | 0 errores |
| Backend e2e | requieren PostgreSQL + Redis; no hay Docker Desktop ni PostgreSQL local en la máquina de trabajo, así que se ejecutan en CI (`Backend (validate / test / build / e2e)`). Nueva suite `test/onboarding-plantillas.e2e-spec.ts` (10 casos, base real) |
| Frontend `vitest` | 95 archivos, 1018 pruebas, 0 fallos (tras la revisión correctiva) |
| Frontend typecheck | OK |
| Frontend lint | 0 errores (2 avisos preexistentes) |
| Frontend `next build` | OK (`NEXT_PUBLIC_API_URL` de prueba) |

Casos mínimos del encargo cubiertos:

| # | Caso | Dónde |
|---|---|---|
| 1 | Empresa genérica | `onboarding.service.spec` (genérico de servicios sin catálogo), `onboarding-plantillas.e2e-spec` (base real), `page.test.tsx` (asistente) |
| 2 | Empresa de muebles | `onboarding.service.spec`, e2e, `page.test.tsx` |
| 3 | Veterinaria / pet | `onboarding.service.spec` (grooming), e2e, `page.test.tsx`; prueba de ausencia de términos médicos en la plantilla |
| 4 | Configuración manual («Otro») | `onboarding.service.spec` |
| 5–6 | Settings v1 leídos sin modificar; nuevas empresas en v2 | `company-settings.spec`, e2e (v1 → v2 solo al editar, claves desconocidas conservadas) |
| 7 | Código TAKTO | `invitation-code.util.spec`, `invitation-codes.service.spec`, e2e |
| 8 | Código TEHUS legacy | `onboarding.service.spec`, e2e (activo válido; usado/revocado/vencido/inexistente rechazados) |
| 9 | Doble consumo | e2e (dos peticiones concurrentes → exactamente una empresa, una fila `USED`) |
| 10–11 | Categoría / pipeline de otro tenant | e2e (settings de A no visibles desde B); pipelines y productos ya van por `companyId` del token (guardas existentes) |
| 12–14 | Refresh con cookie nueva / legacy; logout limpia ambas | `auth.controller.spec` (4 casos nuevos), `device-id.middleware.legacy.spec`, `app-throttler.guard.legacy.spec` |
| 15–16 | Origen TAKTO permitido / origen ajeno rechazado | `cors.e2e-spec`, `cookie-origin.e2e-spec` y `cookie-origin.guard.spec` (dominio de ejemplo `crm-staging.takto.online`), `smoke-test.sh` (contra staging tras el despliegue) |
| 17 | Creación sin catálogo | `onboarding.service.spec`, e2e, `page.test.tsx` |
| 18 | Creación con categorías editadas | e2e (normalización), `page.test.tsx` (categoría propia + quitar sugerida) |
| 19 | Etapas OPEN/WON/LOST | `company-settings.spec` (invariantes), `onboarding-templates.spec` (todas las plantillas), `PipelineStep.test.tsx`, `page.test.tsx` |

## QA visual local del asistente

Construcción de producción del frontend servida con `next start` y un stub
local de la API que devuelve `docs/contracts/onboarding-templates.v2.json`
(sin backend real, sin datos). Recorrido automatizado por Chrome DevTools
Protocol en 320, 360, 390, 768, 1024 y 1440 px. Dos recorridos: el inicial
(antes de la revisión correctiva) capturó 108 pasos; el final, sobre el HEAD
corregido, 120 pasos porque añade la opción «Otro / Configurar manualmente»
(sin descripción no avanza y el aviso se muestra junto al paso). Las cifras
de la tabla corresponden al recorrido final.

| Comprobación | Resultado |
|---|---|
| Scroll horizontal (`scrollWidth > innerWidth`) | 0 de 120 pasos |
| Selector de industria visible | sí en los 6 anchos |
| Diálogo «¿Reemplazar tus cambios?» dentro del viewport | sí en los 6 anchos (hoja inferior en móvil) |
| Validaciones junto al paso | «Ingresa el código de invitación», «Debe haber exactamente una etapa de cierre ganado» visibles con `role="alert"` |
| Cambio de industria → tipos; catálogo off → sin paso de categorías; personalización → confirmación; restaurar | verificado (también en `page.test.tsx`) |
| Foco por teclado | anillo visible (`outline solid 2px` + `box-shadow`) al tabular a «Atrás» (768 px); en otros anchos la tecla Tab sintética de CDP no movió el foco desde `body` (limitación del driver, no del producto: el anillo lo aportan `Field`/`Button` en todos los controles) |
| Etiquetas visibles/accesibles | todos los campos con `label` (ocultos con `sr-only` donde la etiqueta visible ya existe), radios en `fieldset/legend` |
| Capturas revisadas manualmente | 320 px diálogo de confirmación, 320 px pipeline, 1440 px confirmación: sin cortes ni saltos |

## Auditoría final de referencias

`git grep` sobre `apps/*/src` excluyendo pruebas y el cliente Prisma
generado:

- **Tehus como plataforma, fallback, remitente, dominio canónico, prefijo de
  códigos nuevos, categoría genérica, branding inicial o nombre técnico
  nuevo: 0 coincidencias.**
- Coincidencias restantes, todas en la allowlist: comentarios y constantes
  `LEGACY_*` de compatibilidad (cookies, canal, prefijo `TEHUS`), comentarios
  que documentan la retirada de datos de Tehus (`document-templates.ts`,
  `DocumentSignatureBlock.tsx`), el comentario de la plantilla de FlowBot que
  prohíbe mencionar Tehus, y el caso de QA `quote-caso-staging.ts` (fixture
  explícito).
- Términos de muebles fuera de la plantilla `furniture_decor`: solo en el
  fixture de pruebas del frontend y en `quote-caso-staging.ts`.
- El color `#A57014` (tenant) dejó de usarse como color fijo de la interfaz
  (botones de impresión/PDF y cabecera de documentos ahora con tokens TAKTO).
- Infraestructura congelada (`/opt/tehus-crm`, `tehus-backup*`,
  `tehus_crm_staging`, `tehus-crm-staging`, `RESTIC_HOST`…) documentada, no
  renombrada.

## Seguridad del diff

- El conteo exacto de archivos y líneas es el que muestra el PR #18 en
  GitHub (cambia con cada corrección; no se fija aquí). Todo el diff está
  en `apps/*/src`, `apps/backend/test`, `deploy/`, `docs/`,
  `docker-compose.staging.yml`, `README.md` y `.env.example` (plantilla,
  solo `SMTP_FROM_NAME`).
- Sin secretos, tokens, claves privadas ni correos reales (los únicos
  «tokens» son placeholders de pruebas); sin archivos `.env`, artefactos de
  build ni datos QA; el archivo ajeno del worktree principal no está en el
  diff.
- CORS y CSRF siguen siendo allowlist exacta; cookies `HttpOnly`, `Secure`
  en producción, `SameSite=Lax`, host-only; rate limiting sin cambios;
  invitación de un solo uso con reclamo atómico y auditoría (probado en base
  real); creación de empresa en una transacción con rollback; validación de
  backend independiente del frontend; sin migraciones.

## Revisión correctiva previa al DNS (2026-09-03, PR #18)

Tres hallazgos de la revisión del PR, corregidos en la misma rama:

| # | Hallazgo | Corrección | Pruebas |
|---|---|---|---|
| 1 | El asistente validaba contraseñas con `length < 8` y mostraba «Mínimo 8 caracteres», mientras el backend exige `IsStrongPassword` (10 caracteres, minúscula, mayúscula, número y símbolo) | Administrador y asesores validan con `PASSWORD_RULES`/`isStrongPassword` de `lib/password-policy.ts` (espejo del backend); `AdminStep` muestra la lista viva `PasswordRequirements`; `AgentsStep` muestra un único resumen de la política; el error de un asesor lo identifica («Asesor 2 (Luis): …»); `minLength` = `PASSWORD_MIN_LENGTH`; sin ninguna mención a «mínimo 8» | `AdminStep.test.tsx`, `AgentsStep.test.tsx`, `page.test.tsx` (8, sin mayúscula, sin minúscula, sin número, sin símbolo, válida, asesor identificado) |
| 2 | `PATCH /companies/me` aceptaba `settings` como objeto completo validado solo con el parser tolerante de lectura: un v2 malformado (`commercial: "x"`) podía persistirse | Sin consumidor legítimo del campo (ni frontend, ni scripts), se eliminó `settings` de `UpdateCompanyDto` y de `CompaniesService.update`; la configuración comercial solo cambia por `PATCH /companies/me/settings` con `UpdateCompanySettingsDto` (tipado + `normalizeCategories` estricto). El validador permisivo `assertParsableSettings` desapareció. Lectura v1/v2 intacta | `update-company.dto.spec` (16 formas malformadas o válidas de `settings` rechazadas con 400 antes del servicio: no objeto, versión desconocida, sin/mal `commercial`, bandera no booleana, sin/mal `catalog`, categorías no array/no string/largas/exceso, `vertical` parcial o con modelo inválido, `pipelineDefaults` parcial), `companies.service.spec` (v1 se lee sin escribir; `updateSettings` migra v1→v2 conservando banderas y claves desconocidas; categorías inválidas → 400 sin Prisma; `update()` no pasa `settings`), e2e existente de aislamiento |
| 3 | El tipo de negocio se pedía dos veces (texto libre en «Datos de empresa» y plantilla en «Industria»); el backend priorizaba el texto libre, con riesgo de `Company.businessType` contradictorio con `settings.vertical`, y «Otro» podía guardar el literal «Otro / Configurar manualmente» | Campo eliminado de `CompanyInfoStep`; con plantilla normal el frontend no envía texto y el backend guarda el nombre canónico de la plantilla (ignora cualquier texto); con «Otro / Configurar manualmente» `IndustryStep` pide «Describe tu tipo de negocio» (obligatorio, recortado, máximo 60 caracteres, límite compartido `BUSINESS_TYPE_LIMITS` expuesto por `/onboarding/templates`) y eso es lo que se guarda; al cambiar de manual a plantilla el texto se descarta; el resumen muestra industria, tipo canónico o descripción manual, y modelo comercial | `onboarding.service.spec` (canónico gana sobre texto del cliente; manual recortado; manual sin descripción → 400 sin tocar la base), `page.test.tsx` (sin campo en «Datos de empresa», manual obligatorio/recortado/enviado, manual→plantilla sin texto, resumen, diálogo de protección) |

## DNS (2026-09-03)

Registros creados por el propietario en `takto.online`: A `crm-staging` y
A `api.crm-staging` → IPv4 del VPS de staging, TTL 300. Verificación:

| Punto | `crm-staging.takto.online` | `api.crm-staging.takto.online` |
|---|---|---|
| VPS (`getent ahostsv4`, `dig`) | solo la IPv4 del VPS (igual a la pública confirmada desde el propio VPS) | ídem |
| `dig @1.1.1.1`, `dig @8.8.8.8`, `nslookup` públicos | misma IPv4 | ídem |
| Autoritativo Hostinger (`aster.dns-parking.com`) | misma IPv4 | ídem |
| AAAA / CNAME | ninguno | ninguno |
| `takto.online`, `www.takto.online` | sin cambios (200 / 301 a la raíz) | — |
| `crm.takto.online`, `api.crm.takto.online` | no existen (producción no creada) | — |

El resolvedor local de la estación de trabajo agotó el tiempo (problema del
router local); no afecta a la verificación.

## Merge del PR #18

| Dato | Valor |
|---|---|
| Último commit de la rama | `d662bd4` (docs: alineación de la evidencia de QA) |
| CI que autorizó el merge | ejecuciones 33806733938 (push) y 33806739676 (PR): backend con e2e y frontend en `SUCCESS` |
| Merge commit | `5cb991f` (padres `7b7aae8` y `d662bd4`), 2026-09-03 21:17:49 UTC, merge commit como en los PR anteriores |
| Alcance reconfirmado | 100 archivos, todos en `apps/*/src`, `apps/backend/test`, `deploy/`, `docs/`, `docker-compose.staging.yml`, `README.md`, `.env.example`; sin migraciones ni archivos ajenos |
| `main` local | fast-forward a `5cb991f` (luego a `d262ce8` con el PR #19) |

## Despliegue en staging

Precondiciones: host `srv1829292`, usuario `deploy`, `/opt/tehus-crm` en
`main` limpio a `a95da7e`, 6 contenedores healthy, release previo
`a95da7e…` (built 2026-09-02T17:24:29Z), salud `ok`, timers de backup y
drill activos, servicios de backup inactivos, sin procesos de deploy/backup,
sin unidades fallidas, 88 GB libres.

| Paso | Evidencia sanitizada |
|---|---|
| Copia de `.env.staging` | `.secrets/.env.staging.bak-20260903T211834Z`, `600 deploy:deploy`, hash SHA-256 idéntico al original |
| Diff de `.env.staging` | exactamente 5 variables: `FRONTEND_URL`, `PASSWORD_RESET_URL`, `NEXT_PUBLIC_API_URL`, `SMTP_FROM_NAME` sustituidas; `CSRF_ALLOWED_ORIGINS` añadida (no existía ninguna asignación); cada una con una sola asignación activa; ninguna otra línea; secretos intactos |
| `git pull --ff-only` | VPS en `5cb991f` |
| `deploy.sh` | pasos 1–10 correctos: build (release `5cb991f`), postgres/redis, backup previo con checksums, `migrate deploy` «58 migrations found, No pending migrations to apply», `up -d` |
| Incidencia 1 | Paso 11 «Health check failed»: `health-check.sh` sin bit de ejecución (rastreado `100644` desde antes de la fase; el checkout lo dejó en `664`). Pila sana. Corrección en `main` por PR #19 (`d262ce8`, solo modo) |
| Incidencia 2 | Caddy seguía sirviendo el Caddyfile antiguo (bind mount de archivo: inodo anterior tras `git pull`; `caddy reload` → «config is unchanged»). Recreado el contenedor (`up -d --force-recreate --no-deps caddy`); certificados de los dos nombres nuevos emitidos en ~10 s |
| Rollback | no fue necesario; el release anterior `a95da7e` y la copia del entorno quedaron disponibles |
| Release nuevo | `/api/health/version` → `5cb991f7b0187bfbdd54620601cfb9bc9706b5ea`, `builtAt` 2026-09-03T21:18:56Z |

## Verificación técnica posterior

| Control | Resultado |
|---|---|
| `health-check.sh` | 12/12 «All checks passed» (ejecutado con `bash`) |
| `/api/health`, `/api/health/status` | `ok`; database, queue, worker, outbox, realtime, flowbot `up` |
| Contenedores | backend, worker, frontend, postgres, redis healthy; caddy running |
| Timers | `tehus-backup.timer` y `tehus-backup-drill.timer` activos (próximo backup 2026-09-04 03:00 Bogotá); `tehus-backup.service` inactivo; 0 unidades fallidas |
| TLS | Let's Encrypt; `crm-staging.takto.online` y `api.crm-staging.takto.online` con SAN propio, válidos 2026-09-03 → 2026-12-02; `ssl_verify_result=0` desde el VPS y desde fuera; sin errores ACME |
| Cabeceras | HSTS `max-age=31536000; includeSubDomains`, `Server` ausente, `X-Frame-Options: DENY`, nosniff, CSP del frontend con `connect-src` https y wss a la API nueva |
| Dominio antiguo (frontend) | `https://crm-staging.tehusrattan.com/ruta?qa=1` → 302 `https://crm-staging.takto.online/ruta?qa=1`; cadena de 1 redirección hasta 200; sin bucles |
| Dominio antiguo (API) | `https://api.crm-staging.tehusrattan.com/api/health/live` → 200 sin redirección (alias) |
| Sitio comercial | `takto.online` 200, `www` 301 a la raíz |
| Smoke test oficial | `BASE_URL=https://crm-staging.takto.online` + `EXPECTED_RELEASE`: **22/22 PASS** (frontend, liveness/readiness, cabeceras, CORS del origen TAKTO permitido, origen ajeno sin cabecera, preflight de onboarding con `X-Onboarding-Invite-Code`, login inválido 401, webhook sin firma rechazado, `/auth/me` sin JWT 401, release correcto, bundle apuntando a `api.crm-staging.takto.online`) |
| CORS externo | `Access-Control-Allow-Origin` reflejado para el origen nuevo y para el legacy (`CSRF_ALLOWED_ORIGINS`); ninguno para `evil.example.com` |
| Plantillas públicas | `GET /api/onboarding/templates`: versión 2, límites (categorías, etapas, tipo de negocio), 7 industrias con `generic` primero y `furniture_decor` como una más, tipos de veterinaria (clinic, pet_shop, grooming, boarding, other), sin secretos ni «tehus», idénticas al contrato publicado |
| Pantalla pública | `<title>TAKTO</title>` |

## QA funcional en staging (datos `QA_PHASE1_`, eliminados)

Tres invitaciones `TAKTO-…` insertadas por SQL (vista previa enmascarada;
el código nunca se imprimió) y tres empresas creadas por la API pública con
`Origin: https://crm-staging.takto.online`:

| Empresa | Plantilla | Resultado |
|---|---|---|
| `QA_PHASE1_generica` | genérico / venta de servicios / sin catálogo | 201; settings v2 con `catalog.categories = []`, vertical generic/services; `businessType` «Venta de servicios» (nombre canónico); colores nulos; etapas OPEN*, OPEN, OPEN, WON, LOST |
| `QA_PHASE1_muebles` | muebles / tienda-showroom | 201; categorías Salas, Comedores, Dormitorios; `businessType` «Tienda / showroom» |
| `QA_PHASE1_pet` | veterinaria / grooming | 201; categorías Grooming, Otros servicios; `businessType` «Grooming»; pipeline «Citas» tipado |

| Control | Resultado |
|---|---|
| Cookies canónicas | `takto_device_id` (`Path=/`, ~2 años) y `takto_refresh_token` (`Path=/api/auth`, 90 días), ambas `HttpOnly; Secure; SameSite=Lax`; ninguna `tehus_*` emitida |
| Refresh | 201 con rotación de `takto_refresh_token` |
| Fallback legacy | enviando solo `tehus_refresh_token`: 201, se emite `takto_refresh_token` y `tehus_refresh_token` se borra (`Expires` 1970) |
| Origen ajeno en refresh | 403 |
| Logout | 201; borra `takto_refresh_token` y `tehus_refresh_token`; refresh posterior 401; el access token de esa sesión queda revocado (401 en `/companies/me/settings`) |
| Aislamiento | `/companies/me/settings` de muebles y de veterinaria devuelven solo sus categorías; la genérica no tiene ninguna (base); ninguna ve las de otra empresa |
| Realtime | handshake Socket.IO con `Origin` → 200 (`upgrades: websocket`); `realtime: up` |
| Base de datos | settings v2 con `vertical` correcto, colores nulos, etapas con tipo e inicial única, invitaciones `USED` enlazadas a su empresa con `usedAt`, 3 auditorías `USE_INVITATION_CODE` |
| Códigos históricos | invitaciones `TEHUS`: 1 ACTIVE, 1 USED, 1 REVOKED antes y después (intactas) |
| Limpieza | transacción con comprobación previa de nombres; eliminadas por ID: 3 auditorías, 3 login_events, 3 sesiones, 14 etapas, 3 pipelines, 3 invitaciones, 3 usuarios, 3 empresas; residuos 0 en todas las tablas; sin temporales |
| Integridad de datos existentes | totales idénticos a la línea base (4 empresas, 9 usuarios, 3 invitaciones, 4 pipelines, 23 etapas, 3 productos, 8 leads, 198 auditorías); huellas md5 de empresas (nombre, slug, logos, colores, tipo, settings, updatedAt), usuarios, pipelines y etapas idénticas antes y después; Tehus no fue leída ni escrita por ningún script |

Nota esperada: al cambiar el host de la API, las cookies host-only del host
antiguo no viajan al nuevo; los usuarios existentes inician sesión una vez en
`crm-staging.takto.online`.

## Cierre

Estado: **FASE 1 CERRADA — PASS** (2026-09-03). Producción no desplegada ni
apuntada a staging. Sin cambios en Meta, WhatsApp, Google Cloud, rclone,
Restic, backups, timers ni cron. Asahel y Cristian no participaron.

## CI y PR

PR #18: HEADs verificados en CI `81ed7bd` → `69e0bb6` (revisión correctiva)
→ `d662bd4` (alineación de evidencia), todos con backend (unitarias, build,
e2e con base real) y frontend en `SUCCESS`; fusionado como `5cb991f`. PR #19
(bit de ejecución de scripts de deploy, solo modo): backend falló una vez en
`flowbot-vertical.e2e-spec` caso 27 (concurrencia, ajeno al cambio), pasó al
relanzar una sola vez; fusionado como `d262ce8`. PR documental de cierre:
ver la descripción del PR.
