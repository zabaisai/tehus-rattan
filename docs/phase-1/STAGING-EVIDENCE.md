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

## Staging

**BLOQUEADO — no desplegado.** Los registros DNS
`crm-staging.takto.online` y `api.crm-staging.takto.online` no existen y no
hay credenciales del proveedor DNS disponibles; el encargo exige detenerse
en ese punto y no fusionar sin DNS funcional. Registros exactos, orden de
ejecución y verificaciones en `DOMAIN-MIGRATION.md`. Sin merge, sin deploy,
sin QA en staging, sin datos `QA_PHASE1_` creados en ninguna base.

## CI y PR

Se completa al abrir el PR (ver el informe final de la sesión).
