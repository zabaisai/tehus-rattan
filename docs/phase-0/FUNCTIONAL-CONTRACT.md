# Fase 0 — Contrato funcional actual

Describe cómo se comporta el CRM hoy (commit `d421021`) y qué invariantes la
Fase 1 (separación TAKTO / Tehus) debe conservar. Nada de este documento
autoriza cambios; registra el punto de partida verificado en staging.

## Modelo multiempresa

| Regla | Estado verificado |
|-------|-------------------|
| Cada empresa (`companies`) es un tenant con usuarios, contactos, conversaciones, leads, pipelines, productos, cotizaciones, tareas, notas, flowbots e integraciones WhatsApp propios | 16 comprobaciones cruzadas en staging con 0 filas fuera de su tenant |
| Roles: SUPER_ADMIN (plataforma, sin empresa), ADMIN, MANAGER, AGENT (por empresa) | 1 SUPER_ADMIN sin empresa; ningún usuario de empresa sin empresa |
| Estados de empresa: ACTIVE, SUSPENDED, DELETED; `isDemo` para la empresa de demostración | 4 ACTIVE, 1 demo |
| Alta de empresa por onboarding con código de invitación (un solo uso; encabezado `X-Onboarding-Invite-Code` permitido por CORS desde PR #14) | 1 código USED; el flujo no se ejercitó (prohibido crear empresas) |
| El SUPER_ADMIN administra empresas, códigos, auditoría y solicitudes de borrado en `/dashboard/platform/*` | Rutas presentes; no se ejercitaron |

## Configuración por empresa

| Aspecto | Dónde vive | Observación |
|---------|-----------|-------------|
| Identidad y marca | `companies` (`name`, `slug`, logos, `primaryColor`, `accentColor`, `backgroundColor`, `businessType`, ciudad, país, web, descripción) | 1 empresa sin `slug`; 2 sin `businessType`; 2 sin logo |
| Fiscal / cotizaciones | `legalName`, `taxId`, `address`, `quoteFooter`, `currency` (COP), `locale` (es-CO), `timezone` (America/Bogota), `defaultTaxRate`, `taxIncluded`, `quoteRoundingDecimals` | Defaults del schema para todas las empresas |
| Preferencias comerciales | `Company.settings` Json v1: `sellsProducts`, `sellsServices`, `usesCatalog`, `usesQuotes`, `usesTasks`, `categories[]` | 2 empresas sin `settings`; `categories` se guarda pero no se consume |
| Leads / asignación | `company_lead_settings` (pipeline y etapa por defecto, reutilizar lead abierto, tarea inicial, estrategia de asignación, aprobación de tareas) | 0 filas: todas las empresas usan los defaults del código |
| Campos personalizados | `custom_field_definitions` por entidad | 0 definiciones |
| Retención / cumplimiento | `retentionMonths`, `retentionPurgeEnabled`, `data_requests` | Sin retención configurada |

## Pipeline y leads

- Cada empresa tiene exactamente 1 pipeline, marcado `isDefault`.
- Las etapas tienen `order`, `isInitial`, `type` (OPEN/WON/LOST), `probability`,
  `color`. El onboarding crea las etapas solo con nombre y orden: sin tipo,
  sin etapa inicial. Resultado en staging: solo 1 de 4 empresas tiene etapas
  WON/LOST tipadas; una empresa no tiene etapa inicial.
- `leads.status` (OPEN/WON/LOST) es independiente del tipo de etapa; en
  staging hay 1 lead WON y 7 OPEN.
- Invariante para la Fase 1: la plantilla de pipeline por vertical debe fijar
  `type` e `isInitial` al crear etapas, sin alterar pipelines existentes.

## Catálogo y cotizaciones

- `products.category` es texto libre; el frontend impone la lista fija de
  muebles (`PRODUCT_CATEGORIES`) al filtrar y al crear/editar.
- Con catálogo vacío, la interfaz sigue mostrando esas categorías.
- Cotizaciones con revisiones, impuestos, descuentos y PDF; numeración única
  por empresa (`@@unique([companyId, number])`).
- Invariante para la Fase 1: las categorías efectivas de una empresa deben
  salir de su configuración (o de su plantilla de vertical), nunca de una
  constante global; el texto libre existente en `products.category` debe
  seguir siendo válido.

## Conversaciones y WhatsApp

- Integraciones por empresa (`whatsapp_integrations`, varias por empresa,
  una primaria), métodos EMBEDDED_SIGNUP y MANUAL, token cifrado en BD.
- Webhook, historial, handoffs, flowbots (con plantillas `isTemplate`), bot
  de chat, kill switch por empresa.
- Estado en staging: 3 integraciones, ninguna conectada al momento de la
  revisión (hallazgo operativo, no funcional).

## Operación y seguridad

- Sesiones con refresh por dispositivo, eventos de login, tokens de
  recuperación, throttling por ruta, CSRF por origen, CSP horneada en build,
  COOP `same-origin-allow-popups` (PR #13).
- Salud: `/api/health`, `/ready`, `/status` (agregado db/queue/worker/outbox/
  realtime/flowbot), `/queue`, `/version`.
- Auditoría (`audit_logs`, 170 filas) y sesiones de soporte.

## Lo que la Fase 1 debe conservar

1. Aislamiento por `companyId` en todas las entidades (hoy 0 fugas).
2. Datos existentes de las 4 empresas de staging: pipelines, etapas, settings
   v1 y colores tal como están; cualquier cambio de esquema debe ser aditivo y
   nullable.
3. Onboarding con código de invitación de un solo uso.
4. Los endpoints de salud y su semántica.
5. El mecanismo de respaldo local y sus nombres de artefacto hasta que exista
   un plan de renombrado operativo.

## Pendientes (sin evidencia en esta sesión)

- Verificación funcional en navegador de cada módulo: PENDIENTE.
- Comportamiento del onboarding extremo a extremo con un código nuevo:
  PENDIENTE (prohibido consumir códigos en Fase 0).
- Ejecución de las suites unitarias/e2e/frontend sobre `main`: PENDIENTE
  (no se ejecutaron en esta sesión).
