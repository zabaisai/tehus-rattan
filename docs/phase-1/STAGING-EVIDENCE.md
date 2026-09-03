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
| Backend unitarias (`jest --runInBand`) | 140 suites, 2233 pruebas, 0 fallos (incluye política de acceso de controladores con el endpoint público justificado) |
| Backend typecheck (`tsc --noEmit`) | OK |
| Backend lint (`eslint --no-fix`) | 0 errores |
| Backend e2e | requieren PostgreSQL + Redis; no hay Docker Desktop ni PostgreSQL local en la máquina de trabajo, así que se ejecutan en CI (`Backend (validate / test / build / e2e)`). Nueva suite `test/onboarding-plantillas.e2e-spec.ts` (10 casos, base real) |
| Frontend `vitest` | 93 archivos, 1005 pruebas, 0 fallos |
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
Protocol en 320, 360, 390, 768, 1024 y 1440 px: 108 capturas.

| Comprobación | Resultado |
|---|---|
| Scroll horizontal (`scrollWidth > innerWidth`) | 0 de 108 pasos |
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

- 92 archivos, +7869/−618 líneas; solo `apps/*/src`, `apps/backend/test`,
  `deploy/`, `docs/`, `docker-compose.staging.yml`, `README.md`,
  `.env.example` (plantilla, solo `SMTP_FROM_NAME`).
- Sin secretos, tokens, claves privadas ni correos reales (los únicos
  «tokens» son placeholders de pruebas); sin archivos `.env`, artefactos de
  build ni datos QA; el archivo ajeno del worktree principal no está en el
  diff.
- CORS y CSRF siguen siendo allowlist exacta; cookies `HttpOnly`, `Secure`
  en producción, `SameSite=Lax`, host-only; rate limiting sin cambios;
  invitación de un solo uso con reclamo atómico y auditoría (probado en base
  real); creación de empresa en una transacción con rollback; validación de
  backend independiente del frontend; sin migraciones.

## Staging

**BLOQUEADO — no desplegado.** Los registros DNS
`crm-staging.takto.online` y `api.crm-staging.takto.online` no existen y no
hay credenciales del proveedor DNS disponibles; el encargo exige detenerse
en ese punto y no fusionar sin DNS funcional. Registros exactos, orden de
ejecución y verificaciones en `DOMAIN-MIGRATION.md`. Sin merge, sin deploy,
sin QA en staging, sin datos `QA_PHASE1_` creados en ninguna base.

## CI y PR

Se completa al abrir el PR (ver el informe final de la sesión).
