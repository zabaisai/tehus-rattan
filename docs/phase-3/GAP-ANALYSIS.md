# Fase 3 — Análisis de brechas

Base: `origin/main` `7630b61` (2026-09-04; contiene los merges de los PR #22 y
#23). Rama `feat/phase-3-guided-onboarding` en worktree aislado
`../Tehus_Rattan-phase-3`. Antes de escribir código se auditó el onboarding
real (backend `apps/backend/src/modules/onboarding/**`, guardia
`common/guards/onboarding-invite.guard.ts`, plantillas
`templates/onboarding-templates.ts`, frontend `apps/frontend/src/app/onboarding/**`
y `components/onboarding/**`) frente a cada requisito de la Fase 3.

Nota sobre el contrato de plantillas: el enunciado nombra
`docs/contracts/onboarding-templates.v1.json`, pero en el repositorio ese
archivo es el **inventario de Fase 0** (`status: INVENTORY_ONLY`) y el contrato
implementado y validado por pruebas es `onboarding-templates.v2.json`
(`ONBOARDING_TEMPLATES_VERSION = 2`). La Fase 3 evoluciona ese contrato real a
la versión 3 (mismo mecanismo: código canónico + JSON regenerado + prueba de
igualdad), sin crear un segundo catálogo manual.

Leyenda: **HECHO** (ya cubierto por Fase 1/2, se reutiliza), **PARCIAL**,
**FALTANTE**, **FUERA DE FASE**.

| # | Requisito | Estado | Evidencia actual (`main` `7630b61`) | Brecha | Acción propuesta | Prueba que lo demuestra |
|---|---|---|---|---|---|---|
| 1 | Invitación como puerta de entrada; códigos TAKTO y TEHUS activos | HECHO | `OnboardingInviteGuard` exige el header/body; `createCompany` busca por hash (`hashInvitationCode`), distingue inválido/revocado/usado/vencido y hace *claim* atómico (`updateMany … status ACTIVE`) dentro de la transacción; prefijo no participa en la validación | Ninguna funcional | Conservar | e2e: TAKTO, TEHUS temporal, inválido, vencido, revocado, usado |
| 2 | Validar el código al inicio sin consumirlo | FALTANTE | Solo existe `POST /onboarding/company`; el asistente descubre un código inválido al final, tras rellenar 9 pasos | Sin comprobación previa | `POST /onboarding/invitation/check` (header `X-Onboarding-Invite-Code`, throttle de onboarding, solo lectura, no consume) + uso en el paso 1 del asistente | unit + e2e: ACTIVE → 200 sin cambiar estado; revocado/usado/vencido/inválido → 400 con mensaje |
| 3 | Header `X-Onboarding-Invite-Code` y CORS | HECHO | PR #14 (Fase 1) permite el header en CORS; el frontend lo envía en `createCompanyOnboarding` | Ninguna | Conservar; reutilizar en el endpoint de comprobación | e2e CORS existente + comprobación en staging |
| 4 | Código nunca en URL, `localStorage`, logs, auditoría | HECHO | Solo header; logs con `invitationId`; auditoría con `codePreview` parcial | Ninguna | Conservar; no persistir borradores del código | revisión del diff + grep |
| 5 | Información empresarial: nombre, industria, **país, moneda, zona horaria, idioma** válidos y propuestos por país | PARCIAL | `CompanyInfoStep` pide nombre, ciudad, país (texto libre), teléfono, email, web; `OnboardingCompanyInfoDto` no acepta `timezone/currency/locale`; la empresa nace con los defaults de columna (`America/Bogota`, `COP`, `es-CO`) aunque sea de Costa Rica | Sin región en el asistente ni en el DTO | Paso «Región» en el asistente con países sugeridos (país → zona/moneda/idioma propuestos, editables, con estado *touched*); DTO acepta `timezone/currency/locale` opcionales validados con los normalizadores de Fase 2 (`normalizeTimezone/Currency/Locale/Country`) y los persiste en las columnas canónicas | unit DTO/servicio; e2e: región persistida y visible en `TenantConfigurationV1`; inválidos → 400 |
| 6 | Forma de vender comprensible | PARCIAL | Radio «Modelo comercial» dentro de `IndustryStep` con etiquetas «Vendo productos/servicios/ambos» | Mezclado con industria; no se explica ni se muestra la recomendación de la plantilla | Paso propio «¿Qué vendes?» con la recomendación de la plantilla marcada y explicada; alimenta `flagsForModel` (Fase 2) | tests frontend |
| 7 | Recomendación por industria explicada (plantilla, módulos, categorías, pipeline, motivo) con opciones usar/cambiar/personalizar | PARCIAL | `IndustryStep` elige tipo por radio; no hay vista de recomendación ni motivo | Sin paso de recomendación | Paso «Recomendación» que muestra la plantilla recomendada (o elegida), sus módulos, categorías y etapas y un motivo, con acciones «Usar recomendación», «Elegir otra plantilla», «Configurar manualmente» | tests frontend: recomendación cambia con industria/modelo |
| 8 | Módulos reales, recomendados, editables | HECHO | `ModulesStep` con centrales fijos y opcionales (`catalog/quotes/tasks`), textos naturales, estado Sugerido/Editado | Ninguna | Conservar | tests existentes + e2e persistencia |
| 9 | Categorías: agregar, quitar, **renombrar**, sin duplicados, límites; sin muebles fuera de muebles | PARCIAL | `CategoriesStep` marca/desmarca sugeridas, añade propias, dedupe sin mayúsculas, límites; falta renombrar; plantillas de veterinaria/software/otro sin términos de muebles (prueba `FURNITURE_TERMS`) | Sin renombrar | Renombrar en línea (chip → campo) conservando el orden | test frontend; prueba de plantillas existente |
| 10 | Pipeline inicial editable con invariantes | HECHO | `PipelineStep`: nombre, agregar/quitar/renombrar/reordenar/tipo; `validatePipeline` (front) y `validateTypedStages` (back) con ≥1 OPEN, 1 WON, 1 LOST, sin duplicados | Ninguna | Conservar; mostrar tipos en español (ya) | e2e: pipeline persistido; inválidos → 400 |
| 11 | Branding opcional, validado, sin huérfanos | HECHO | `BrandingStep`; `assertValidLogoFile` antes de la BD; subida tras la transacción con `cleanupFailedCompany` (borra empresa, pipeline, usuarios, reactiva la invitación y elimina `uploads/branding/<id>`) | Ninguna | Conservar | unit existente (`onboarding.service.spec`) |
| 12 | Administrador y asesores | HECHO | `AdminStep`/`AgentsStep`; `IsStrongPassword`; duplicados en la petición → 409; existentes → 409; rol forzado `AGENT`; `role` solo admite `AGENT` | Ninguna | Conservar | e2e: email duplicado, rol privilegiado → 400 |
| 13 | Confirmación exacta con edición por bloque = payload | PARCIAL | `ConfirmationStep` muestra empresa, actividad, módulos, categorías, pipeline, branding, admin, asesores; sin región, sin acciones «Editar», y el payload se construye aparte en `handleSubmit` | Resumen y payload pueden divergir; sin volver a un bloque | `buildOnboardingPayload(estado)` puro y único; el resumen se renderiza **desde ese payload** y cada bloque tiene «Editar» que salta al paso | test: resumen ≡ payload enviado |
| 14 | Creación: sin doble envío, progreso, error conservando datos, redirección solo tras éxito | HECHO/PARCIAL | `submitting` deshabilita el botón; error mapeado y estado conservado; redirección tras `token`; no hay guarda contra reentrada en `handleSubmit` | Guarda de reentrada | Guarda explícita + botón deshabilitado; prueba de doble clic | test frontend: dos clics → una llamada |
| 15 | Procedencia/*touched* y protección de ediciones | PARCIAL | `edited` por sección (módulos, categorías, pipeline); diálogo al cambiar plantilla («Aplicar sugerencias» vs cerrar = conservar); «Restaurar sugerencias» por sección | Falta *touched* para región y modelo; el diálogo no nombra explícitamente «Conservar mis cambios»; falta «Restablecer recomendaciones» global | Extender `edited` a `regional` y `businessModel`; diálogo con dos acciones explícitas; acción global de restablecer | tests frontend: conservar / aplicar / restablecer |
| 16 | Volver atrás sin perder datos; error del backend no reinicia | HECHO | Estado en memoria en `page.tsx`; el error solo fija `submitError` | Ninguna | Conservar (sin `sessionStorage`: decisión documentada) | tests existentes + nuevos |
| 17 | Backend recibe el estado final, valida todo, whitelist estricta | HECHO | `parsePayload` con `whitelist + forbidNonWhitelisted`; `resolveVertical`, `resolveStages`, `normalizeCategories`, `buildCompanySettingsV2`; `companyId`/`role` no aceptados | Falta validar región | Añadir región al DTO y al servicio (Fase 2 reutilizada) | unit + e2e negativos |
| 18 | Creación atómica, doble consumo, huérfanos | HECHO | Una transacción: claim atómico, empresa, admin, sesión, asesores, pipeline, etapas, invitación, auditoría; logos compensados | Ninguna | Conservar; e2e de concurrencia HTTP | e2e: dos peticiones simultáneas → una empresa; fallo → cero huérfanos |
| 19 | Auditoría sanitizada con plantilla elegida | PARCIAL | `USE_INVITATION_CODE` con `invitationId`, `codePreview`, `companyId`, `companyName` | No registra plantilla/versión ni resultado | Añadir `templateVersion`, `industry`, `businessType`, `businessModel`, conteos de etapas/asesores y región; sin valores sensibles | unit: metadata sin contraseña/código; e2e: fila presente |
| 20 | Catálogo canónico de plantillas (A muebles, B veterinaria/pet shop, C software/servicios, D otro) | PARCIAL | v2 con 7 industrias; muebles `showroom` (`products`, sin «Sillas»/«Instalación»); veterinaria sin tipo mixto «pet shop + clínica»; sin tipo «Software»; `other` con el pipeline genérico de 5 abiertas | Difiere de las plantillas mínimas exigidas | Versión 3: `showroom` → mixto con Salas, Comedores, Sillas, Decoración, Instalación; nuevo `vet_petshop` mixto (Consultas, Vacunas, Peluquería, Alimentos, Medicamentos) primero en veterinaria; nuevo `software` en servicios profesionales (Implementación, Consultoría, Soporte, Licencias); `other` con Nuevo lead, Contactado, Propuesta, Seguimiento, ganado, perdido. JSON `onboarding-templates.v3.json` regenerado y prueba de igualdad | `onboarding-templates.spec.ts` (v3), prueba de términos de muebles y médicos |
| 21 | Stepper accesible y responsive, `aria-current`, foco al error, reduced motion | PARCIAL | `OnboardingProgress` con lista (desktop) y barra (móvil); errores con `role=alert`; sin `aria-current`, sin foco al error, `transition-all` sin `motion-reduce` | Accesibilidad incompleta | `aria-current="step"`, foco al alerta al fallar, `motion-reduce:transition-none`, botones con nombre | tests + QA visual 320–1440 |
| 22 | Textos en español natural (sin `PRODUCT`, `vertical`…) | HECHO | Etiquetas `BUSINESS_MODEL_LABELS`, `STAGE_TYPE_LABELS`, módulos | Ninguna | Conservar en los pasos nuevos | revisión + tests |
| 23 | Migración | FUERA DE FASE | Columnas regionales y `settings` ya existen; invitación, pipeline y usuarios ya modelados | No hace falta ninguna | **Sin migración** | `prisma migrate diff` sin cambios |
| 24 | Navegación dinámica por módulos, gestión de múltiples pipelines, backfill `itemType` | FUERA DE FASE | — | — | No tocar (Fase 4/5) | — |

## Decisiones

1. **Reutilizar, no reescribir**: se conservan `OnboardingService.createCompany`
   (transacción y compensación), DTOs, plantillas versionadas, pasos de
   módulos/categorías/pipeline/branding/admin/asesores y `TenantConfigurationV1`.
2. **Región por la Fase 2**: los mismos normalizadores (`tenant-configuration.ts`)
   validan país, zona IANA, ISO 4217 y BCP 47 en el onboarding; se persisten en
   las columnas de `Company`, nunca en `settings`.
3. **Un solo constructor de payload** en el frontend; el resumen se pinta desde
   él, así no puede mostrar una cosa y enviar otra.
4. **Sin `sessionStorage`**: el estado vive en memoria (atrás/adelante no pierde
   datos; un error del servidor no reinicia). Recargar la página reinicia el
   asistente a propósito: no se guarda nada del código ni de contraseñas.
5. **Plantillas v3** como evolución del contrato real (v2), regeneradas desde el
   código y comprobadas por prueba. `v1.json` (inventario Fase 0) y `v2.json`
   (Fase 1) se conservan como histórico.
6. **Sin migración**.
