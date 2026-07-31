# TAKTO — Estado de implementación

> Archivo de continuidad. Se actualiza después de cada bloque coherente de
> trabajo y antes de cualquier acción larga. **Nunca contiene secretos.**
>
> Para reanudar: leer este archivo + `git log --oneline origin/main..HEAD`.
> No empezar de cero. No repetir migraciones ni envíos ya registrados aquí.

## Objetivo

Transformar el CRM en una plataforma comercial multiempresa TAKTO: WhatsApp
multi-número, conversación→oportunidad automática, múltiples pipelines,
asignación round-robin, automatizaciones durables con constructor visual,
chatbot visual, tiempo real, campos personalizados, PDF real, retención y la
identidad oficial TAKTO — con aislamiento multiempresa, auditoría y rollback
intactos.

## Rama y base

| | |
|---|---|
| Rama | `feature/takto-crm-platform-overhaul` |
| Base (`origin/main` al empezar) | `58dfb760ec6b09b6514238787cfb6dc4e3e6e129` |
| Fecha de inicio | 2026-07-30 |
| Producción | **fuera de alcance — no se toca** |

## Decisiones aprobadas (cerradas, no re-preguntar)

1. Varios números WhatsApp por empresa; uno principal; `phoneNumberId` único
   global; enrutamiento por `phone_number_id`. La integración viva se migra
   como principal. El número terminado en 9970 es el **número de prueba de
   Meta** y no debe presentarse como número real de la empresa.
2. Primer mensaje entrante crea oportunidad **solo si** no hay una `OPEN`/
   `PAUSED` para ese contacto en el pipeline aplicable. Reutiliza la abierta.
   Si todas están cerradas, un contacto posterior puede crear una nueva.
   Idempotente frente a webhooks duplicados/concurrentes.
3. Múltiples pipelines; predeterminado obligatorio; etapas configurables;
   `Lead.stageId` como fuente única del estado comercial; `Conversation.stage`
   se retira por transición compatible (dual-read/write), nunca de golpe.
4. Asignación round-robin entre asesores activos y elegibles; configurable;
   reasignación manual siempre posible y auditada; sin elegible → bandeja sin
   asignar + notificación a administradores.
5. Tareas relacionables con conversación, contacto, oportunidad, empresa y
   asesor; creables desde el chat sin salir de la conversación.
6. Automatizaciones: constructor visual + motor durable (Redis + BullMQ),
   versiones, reintentos con backoff, idempotencia, historial, DLQ.
7. Chatbot v1 visual con transferencia humana, borrador/publicado y sesiones.
8. Tiempo real por WebSockets autenticados y aislados por empresa; polling
   como respaldo.
9. Campos personalizados híbridos: definiciones normalizadas + valores JSONB
   validados, con índices GIN donde aporten.
10. Historial previo de WhatsApp: **no se promete importación automática**.
    Se documenta y se prepara importación controlada CSV/API.
11. PDF servidor con librería ligera (PDFKit/pdf-lib). Sin Chromium salvo
    necesidad demostrada.
12. Identidad visible → TAKTO. **Sin reemplazo masivo** de identificadores
    internos `tehus-*` que invaliden sesiones o infraestructura.
13. Retención configurable por empresa; sin purga automática por defecto;
    exportación, solicitud de eliminación, auditoría, soft delete y purga
    programable.

## Inventario inicial (staging, 2026-07-30)

| Elemento | Valor |
|---|---|
| Release desplegado | `58dfb760…` (`builtAt 2026-07-30T18:16:27Z`) |
| Migraciones | 21/21 aplicadas, 0 fallidas, **drift 0** (26/26 tablas) |
| Companies | 2 (una sin pipeline) |
| Users | 4 (1 ADMIN, 2 AGENT, 1 SUPER_ADMIN plataforma), todos activos |
| Contacts / Conversations / Messages | 4 / 4 / **7** |
| Mensajes | 5 INBOUND + 2 OUTBOUND, todos TEXT, RECEIVED/SENT |
| Leads / Tasks / Automations / Notifications | **0 / 0 / 0 / 0** |
| Pipelines / Stages | 1 / 5 |
| WhatsAppIntegration | 1 · `CONNECTED` · método `MANUAL` |
| Conversaciones sin asesor / sin tarea / sin oportunidad | 4 / 4 / 4 |
| Contactos sin `+` (E.164 pendiente) | 4 de 4 |
| Tests | backend 717 unit + 214 e2e · frontend 120 |
| CI de la base | verde (frontend y backend) |

**Datos reales a preservar sin excepción:** la integración `CONNECTED`, los
4 contactos, 4 conversaciones y **7 mensajes**.

## Checklist maestro

Leyenda: `[ ]` pendiente · `[~]` en curso · `[x]` terminado y verificado.

### Bloque 0 — Preflight
- [x] Revalidar git, `origin/main`, working tree, `index.lock`, `autocrlf`
- [x] Verificar checksums del brand pack (205/205 OK)
- [x] Capturar baseline (release, contenedores, migraciones, conteos, tests)
- [x] Crear rama `feature/takto-crm-platform-overhaul`
- [x] Crear este archivo de estado
- [x] Backup fresco de PostgreSQL + uploads, con SHA-256 verificado

### Bloque 1 — Pruebas de caracterización (antes de tocar arquitectura)
- [x] **Pipelines y etapas** — `pipeline.service.spec.ts`, 27 casos
- [x] **Contactos** — `contacts.service.spec.ts`, 27 casos (puerta E.164)
- [x] **Tareas** — `tasks.service.spec.ts`, 29 casos (puerta `conversationId`)
- [x] **Automatizaciones** — `automations.service.spec.ts`, 31 casos
- [x] **Resolución WhatsApp** — 2 casos añadidos al spec existente
      (puerta del multi-número)
- [x] Webhook firmado + idempotencia por `wamid` — **ya cubierto** por
      `webhook.service.spec.ts` (14 casos) y `webhook-signature.e2e-spec.ts`.
      Verificado, no duplicado.
- [x] Integración manual y Embedded Signup — **ya cubierto**
      (`whatsapp-integration-management.service.spec.ts`,
      `whatsapp-embedded-signup.service.spec.ts`, 2 e2e)
- [x] Permisos ADMIN / AGENT / SUPER_ADMIN — **ya cubierto**
      (`roles-guard.e2e-spec.ts`, `business-tenant-guard.e2e-spec.ts`)
- [x] Sesión de soporte — **ya cubierto** (`support-sessions.e2e-spec.ts`)
- [x] Origin / cookies / refresh rotation — **ya cubierto**
      (`cookie-origin`, `refresh-rotation-concurrency`, `session-revocation`)
- [ ] Conversaciones (servicio) — pendiente
- [ ] Productos y cotizaciones: aislamiento explícito — pendiente

### Bloque 2 — Migraciones aditivas
- [x] **Empresa: regional** — `20260730225506_add_company_regional_settings`
      · `timezone` / `currency` / `locale` con default, `businessHours` JSONB
      nullable · aplicada **solo en local** · staging intacto
- [ ] Empresa: preferencias de automatización/retención, branding de empresa
- [ ] Pipelines/etapas: orden, archivado, probabilidad, tipo, color semántico,
      predeterminado garantizado + backfill
- [ ] `Conversation.leadId` (nullable) y `Task.conversationId` (nullable)
- [ ] Mensajes: tipos ampliados, media, reply/context, estados de entrega
- [ ] Campos personalizados (definiciones + valores JSONB)
- [ ] Reglas de asignación
- [ ] `AutomationVersion` + `AutomationRun`
- [ ] Chatbot: flujos, versiones, nodos, sesiones
- [ ] Índices de tráfico (medidos antes)

### Bloque 3 — E.164
- [x] **Utilitario único** — `src/common/phone/e164.util.ts` (33 pruebas)
- [x] **Normalización al crear** + reutilización del contacto existente en
      lugar de duplicar (`contacts.service.ts`)
- [x] **Compatibilidad de búsqueda** con y sin `+` (3 pruebas dedicadas)
- [x] Pruebas de regresión — spec de contactos: 27 → 36 casos
- [x] **Backfill de las filas existentes** —
      `20260730233500_backfill_contact_phones_to_e164` · alcance estrecho
      (solo antepone `+` a dígitos ya E.164) · **nunca sobrescribe una
      colisión** · idempotente, verificado · aplicada **solo en local**

### Bloque 4 — WhatsApp multi-número (mayor riesgo)
- [x] **Segundo backup verificado** (2026-07-30 18:40) — checksums OK, gzip
      íntegro, y confirmado que contiene la integración, 7 mensajes, 4
      contactos y 4 conversaciones reales
- [x] **Columnas `isPrimary`, `label`, `order` + backfill** —
      `20260730234117` · la integración viva quedó como principal · solo local
- [x] **Resolución con desempate** — `findConnectedByCompanyId` ordena por
      principal → orden → antigüedad; `findAllConnectedByCompanyId` (sin
      token) y `findConnectedByCompanyAndPhoneNumberId` (acotado por empresa)
- [x] **Envío por número explícito** — `sendMessage(..., fromPhoneNumberId?)`
      resuelve acotado a la empresa; omitirlo usa la principal
- [x] **PII en logs corregida** — teléfono enmascarado y solo
      `error.message` de Meta, nunca el cuerpo crudo
- [x] **Índice parcial `whatsapp_one_primary_per_company`** — `20260730235500`
- [x] **`UNIQUE(companyId)` retirado** — `20260730235606`
- [x] **19 pruebas contra la base REAL** (`whatsapp-multi-number.e2e-spec.ts`):
      dos números por empresa, dos empresas, enrutamiento por
      `phone_number_id`, envío explícito, fallback a principal, prohibición de
      dos principales, reconexión vs alta, y **cero fuga multiempresa**
- [ ] UI: selector de número remitente en la bandeja
- [ ] Pruebas: dos números / una empresa y dos empresas
- [ ] Retirar `UNIQUE(companyId)` + constraints finales
- [ ] Desconexión local vs desconexión real en Meta

### Bloque 5 — Retiro de `Conversation.stage`
- [x] **Dual-write implementado** — `change_stage` mueve la OPORTUNIDAD
      (`Lead.stageId` + `LeadStageHistory`) y sigue escribiendo
      `Conversation.stage` durante la transición · 6 pruebas
- [x] Auditoría de alcance: **1 solo escritor**, **0 filas** lo usan
- [ ] Retirar la columna en migración separada (tras rodaje del dual-write)

### Bloque 6 — Infraestructura
- [x] **Redis con healthcheck** en staging y desarrollo · `appendonly`,
      `noeviction`, sin puertos publicados
- [x] **Configuración de cola** (BullMQ) · 3 colas, backoff exponencial,
      `removeOnFail: false` como DLQ · 15 pruebas
- [x] **Worker como proceso separado** (`src/worker.ts`) · misma imagen y
      AppModule, sin servidor HTTP, `stop_grace_period` 60 s
- [x] **QueueModule registrado** + `/health/queue` aislado de `/health/ready`
      · `QueuePingService` con conexión propia y perezosa · 11 pruebas
- [x] **Productor enganchado**: el webhook hace persistir + encolar, con
      idempotencia por `messageId` y **marcha atrás en línea** si Redis falla
- [x] **`queue.role.ts`**: el backend produce, el worker consume · prueba de
      que hay exactamente UN consumidor en un despliegue normal
- [ ] **Procesador (consumidor) en el worker** — falta registrar el `Worker`
      de BullMQ que ejecute `runInboundEffects`
- [ ] Outbox/eventos durables
- [ ] WebSockets autenticados y aislados por empresa
- [ ] Observabilidad: 4xx visibles, logs sin PII, métricas, health/live/ready

### Bloque 7 — Capacidades funcionales
- [ ] Conversación → oportunidad → asignación → tarea (flujo completo)
- [ ] Bandeja omnicanal
- [ ] UI de pipelines y etapas
- [ ] Oportunidades (vista detallada)
- [ ] Tareas y SLA
- [ ] Asignación automática
- [ ] Automatizaciones (motor + constructor visual)
- [ ] Chatbot (motor + constructor visual)
- [ ] Notificaciones (productores completos)
- [ ] WhatsApp: salud, medios, plantillas, estados
- [ ] Cotizaciones + PDF real
- [ ] Configuración y personalización por empresa
- [ ] Plataforma y soporte

### Bloque 8 — Branding TAKTO
- [ ] Design system con tokens semánticos + documentación
- [ ] Favicon, manifest/PWA, Open Graph, metadatos
- [ ] Fuentes Archivo / IBM Plex Sans / IBM Plex Mono
- [ ] Todas las superficies del §4 del encargo
- [ ] Separación identidad plataforma vs empresa cliente
- [ ] `prefers-reduced-motion`

### Bloque 9 — Seguridad y cumplimiento
- [ ] Corregir PII en logs de WhatsApp
- [ ] Observabilidad de 4xx
- [ ] Desconexión completa de WhatsApp
- [ ] Rotación de clave de cifrado
- [ ] Retención / exportación / eliminación
- [ ] Sesiones de soporte vencidas marcadas ACTIVE
- [ ] Fijar throttling y límites de body en `.env.staging`

### Bloque 10 — QA y entrega
- [ ] Suites unitarias/E2E/frontend nuevas y existentes verdes
- [ ] QA visual en 6 viewports
- [ ] QA E2E de extremo a extremo en staging
- [ ] CI verde de rama y de `main`
- [ ] Despliegue con etiquetas por SHA + release anterior recuperable
- [ ] Runbooks de despliegue y rollback actualizados
- [ ] `docs/TAKTO-IMPLEMENTATION-REPORT.md`

## Cambios terminados

### Bloque 0 — Preflight ✅
- Git revalidado: `origin/main` sin cambios desde la auditoría; árbol limpio;
  sin `index.lock`; `core.autocrlf=true` preservado.
- Brand pack íntegro: **205/205 checksums OK**, sin discrepancias ni faltantes.
  No se ejecutó ningún HTML/JS del paquete.
- Rama creada desde `origin/main`.
- **Backup fresco verificado** (2026-07-30 17:35 hora VPS):
  - Dump SQL: 15.148 bytes · checksum **OK** · `gzip -t` íntegro.
  - Uploads: 294 bytes · checksum **OK** · `tar` íntegro (4 entradas).
  - **Contenido confirmado dentro del dump**: 7 `messages`, 4 `contacts`,
    4 `conversations`, 1 `whatsapp_integrations`. Los datos reales están
    respaldados antes de cualquier migración.
  - Observación menor: el `.tar.gz` de uploads queda como `root:root` 644
    (lo crea el contenedor); el `chmod` del script falla con "Operation not
    permitted". No afecta a la integridad ni a la restauración. **Anotado
    como deuda operativa**, no corregido en este bloque.

### Bloque 1 — Caracterización (parcial)
- `apps/backend/src/modules/pipeline/pipeline.service.spec.ts` — **27 casos**,
  el módulo pasa de **0 a 27** pruebas. Fija:
  - aislamiento multiempresa en los 8 métodos que resuelven pipeline
    (tabla `it.each`): 404 y **ninguna escritura** si el pipeline es de otra
    empresa;
  - `create` fuerza el `companyId` del contexto;
  - orden automático de etapas (último+1, o 0 en pipeline vacío);
  - `remove`/`removeStage` bloqueados por etapas o leads existentes;
  - reordenamiento rechazado si alguna etapa es ajena, y aplicado en **una**
    transacción;
  - kanban: filtro `companyId` + `status OPEN`, totales por etapa, `value`
    nulo tratado como 0;
  - **hueco documentado**: hoy marcar `isDefault` NO desmarca el anterior.
    La reforma debe cerrarlo de forma deliberada.

### Bloque 1 — Caracterización (esencialmente completo)

Cobertura añadida en esta sesión, **114 casos nuevos** en 4 módulos que
estaban a cero, más 2 casos en el resolutor de WhatsApp:

| Módulo | Antes | Ahora | Puerta que protege |
|---|---:|---:|---|
| `pipeline` | 0 | 27 | orden, archivado, probabilidad, tipo de etapa |
| `contacts` | 0 | 27 | normalización E.164 + deduplicación |
| `tasks` | 0 | 29 | `Task.conversationId` + round-robin |
| `automations` | 0 | 31 | motor durable v2 |
| `whatsapp-integration` | 13 | 18 | retirada de `companyId @unique` |

**Huecos fijados como prueba explícita** (para que cerrarlos sea deliberado
y visible en el diff, no un efecto colateral):

1. `pipeline`: marcar `isDefault` **no** desmarca el anterior → una empresa
   puede acabar con varios predeterminados.
2. `contacts`: el teléfono se guarda **tal cual**; dos formatos del mismo
   número son dos contactos distintos.
3. `tasks`: no existe ninguna noción de conversación, ni en el contrato ni
   en los filtros.
4. `automations`: solo 3 disparadores y 4 acciones; `change_stage` escribe
   `Conversation.stage` (texto libre) en vez de mover el lead; los errores se
   tragan sin reintento, sin `AutomationRun` y sin idempotencia.
5. `whatsapp-integration`: el saliente usa `findFirst` **sin criterio de
   desempate** → al retirar el UNIQUE devolvería una fila arbitraria. Debe
   pasar a resolver `isPrimary` o exigir el número explícito.

Verificado además que webhook/firma/idempotencia, Embedded Signup, permisos,
sesión de soporte y origin/refresh **ya tenían cobertura suficiente**; se
revisaron y no se duplicaron.

## Cambios en curso

- Bloque 1: quedan `conversations` (servicio) y el aislamiento explícito de
  productos/cotizaciones. No bloquean el bloque 2.

## Migraciones creadas / aplicadas

| Migración | Creada | Local | **Staging** | Tipo | Rollback |
|---|:--:|:--:|:--:|---|---|
| `20260730225506_add_company_regional_settings` | ✅ | ✅ | ❌ **no aplicada** | aditiva pura (4 columnas) | `DROP COLUMN` |
| `20260730230534_add_pipeline_ordering_and_stage_type` | ✅ | ✅ | ❌ **no aplicada** | aditiva + backfill + índice parcial | `DROP COLUMN` / `DROP INDEX` |
| `20260730231440_link_conversation_lead_and_task_conversation` | ✅ | ✅ | ❌ **no aplicada** | aditiva pura (2 FK nullable + 9 índices) | `DROP COLUMN` |
| `20260730232007_add_message_media_and_delivery_status` | ✅ | ✅ | ❌ **no aplicada** | aditiva + `ALTER TYPE ADD VALUE` | columnas: `DROP`; enum: **no reversible en caliente** |
| `20260730233500_backfill_contact_phones_to_e164` | ✅ | ✅ | ❌ **no aplicada** | solo datos (UPDATE) | restaurar desde backup si hiciera falta |
| `20260730234117_add_whatsapp_multi_number_fields` | ✅ | ✅ | ❌ **no aplicada** | aditiva + backfill de principal | `DROP COLUMN` |

> **Importante para quien reanude:** staging sigue con **21** migraciones y en
> el release `58dfb76`. La 22ª existe solo en la rama y en la base local. No
> se despliega hasta cerrar un lote coherente del bloque 2.

## Commits

| SHA | Descripción |
|---|---|
| _(ver `git log origin/main..HEAD`)_ | test(pipeline): caracterización pre-reforma |

## Pruebas ejecutadas

| Fecha | Suite | Resultado |
|---|---|---|
| 2026-07-30 | baseline heredada (backend unit) | 717 verdes |
| 2026-07-30 | baseline heredada (backend e2e) | 214 verdes |
| 2026-07-30 | baseline heredada (frontend) | 120 verdes |
| 2026-07-30 | backend unit tras `pipeline` | 744 verdes / 66 suites |
| 2026-07-30 | backend unit tras contacts+tasks+automations | **831 verdes / 69 suites** |
| 2026-07-30 | `whatsapp-integration.service.spec` ampliado | 18 verdes |
| 2026-07-30 | lint de los specs nuevos | 0 hallazgos nuevos |
| 2026-07-30 | tras migración regional: build + unit + e2e | **833 unit / 214 e2e verdes** |
| 2026-07-30 | **CI remoto** `312ced6` | frontend y backend **success** |
| 2026-07-30 | **CI remoto** `0837c28` (pipelines) | frontend y backend **success**, `head_sha` verificado |
| 2026-07-30 | **CI remoto** `93b6b81` (relaciones) | frontend y backend **success**, `head_sha` verificado |
| 2026-07-30 | tras bloque 2.4 | 851 unit / 214 e2e verdes |
| 2026-07-30 | CI `e59d22a` | **cancelled** (lo canceló el push siguiente) |
| 2026-07-30 | tras bloque 3 (E.164) | 893 unit / 214 e2e verdes |
| 2026-07-30 | **CI remoto** `d92d4d1` (E.164) | frontend y backend **success**, `head_sha` verificado |
| 2026-07-30 | tras backfill E.164 | 893 unit / 214 e2e verdes |
| 2026-07-30 | **CI remoto** `4f4a007` (backfill) | frontend y backend **success**, `head_sha` verificado |
| 2026-07-30 | tras bloque 4 fase aditiva | 897 unit / 214 e2e verdes |
| 2026-07-30 | **CI remoto** `7a74fee` | frontend y backend **success**, `head_sha` verificado |
| 2026-07-30 | tras número remitente + PII | 900 unit / 214 e2e verdes |
| 2026-07-31 | **CI** `56e5a63` (multi-número) | **success**, `head_sha` verificado |
| 2026-07-31 | **CI** `531b12b` (dual-write etapa) | **success**, `head_sha` verificado |
| 2026-07-31 | tras bloque 6 infra | 920 unit / 233 e2e verdes |
| 2026-07-31 | **CI** `eebaa91` (Redis + worker) | **success**, `head_sha` verificado |
| 2026-07-31 | tras QueueModule | 931 unit / 233 e2e verdes |
| 2026-07-31 | **CI** `53fac94` (QueueModule) | **success**, `head_sha` verificado |
| 2026-07-31 | tras productor de cola | **958 unit / 233 e2e verdes** |

## Despliegues

_(ninguno en esta rama — staging sigue en `58dfb76`)_

## Bloqueadores

_(ninguno)_

## Aprendizaje operativo importante

**El CI cancela runs anteriores del mismo ref.** El workflow tiene
`concurrency: cancel-in-progress: true`, así que hacer push de un commit
mientras corre el del anterior deja al primero en `cancelled`, no en verde.

Ocurrió con `e59d22a` (bloque 2.4): su run fue **cancelado** por el push de
`a1de25b`. No debe darse por cubierto.

**Regla para quien reanude:** verificar el CI del **último SHA publicado** del
lote, y comprobar siempre que `head_sha` del run coincide exactamente. Un run
verde de un SHA anterior no cubre el código nuevo.

## Deuda operativa detectada (no corregida aún)

- El `.tar.gz` de uploads queda `root:root`; el `chmod` del script de backup
  falla. Revisar `backup-postgres.sh` cuando se toque el runbook.

## Próximo comando seguro

Bloques 0–4 completos. Bloque 5 en dual-write. Bloque 6 con Redis, worker,
config, salud y **productor** listos. Falta el **consumidor**.

```
# BLOQUE 6, FASE 4 — el procesador en el worker
#
# Lo que YA existe y esta probado (958 unit verdes):
#   - Redis en ambos compose; worker como proceso separado
#   - queue.config.ts: 3 colas, backoff, removeOnFail:false (DLQ)
#   - queue.role.ts: backend produce / worker consume, con prueba de que solo
#     hay UN consumidor
#   - InboundQueueService: encola con jobId = messageId (idempotente) y
#     devuelve false en vez de lanzar si Redis falla
#   - WebhookService.runInboundEffects(): publico, lo comparten el camino
#     encolado y el camino en linea
#
# Lo que falta, en src/common/queue/inbound.processor.ts:
# 1. Un provider que, SOLO si shouldConsumeQueue(), cree un `Worker` de BullMQ
#    sobre QUEUE_NAMES.INBOUND con buildRedisConnection().
# 2. Su handler recibe InboundMessageJob y llama a
#    webhookService.runInboundEffects(companyId, conversationId, body,
#    contactPhone, assignedTo). OJO: hay que resolver `assignedTo` leyendo la
#    conversacion, porque el job no lo lleva (puede haber cambiado entre el
#    encolado y el procesado).
# 3. onApplicationShutdown: worker.close() para drenar en SIGTERM. El compose
#    ya da 60s de gracia.
# 4. Pruebas: el worker NO se crea cuando shouldConsumeQueue() es false; el
#    handler ejecuta los efectos; un fallo deja el job en la cola.
#
# Cuidado con la dependencia circular: WebhookModule ya importa QueueModule.
# Si el procesador vive en QueueModule e inyecta WebhookService, habra ciclo.
# Opcion mas limpia: que el procesador viva en WebhookModule, que ya tiene
# ambas piezas a mano.
```

**Recordatorios de seguridad vigentes**

- **Staging sigue en 21 migraciones y release `58dfb76`.** La rama va por 29
  migraciones. **Nada desplegado.** El despliegue exigirá levantar Redis y el
  worker, no solo backend y frontend, y el runbook debe actualizarse antes.
- Dos backups verificados: 2026-07-30 17:35 y 18:40.
- Índices parciales (`pipelines_one_default_per_company`,
  `whatsapp_one_primary_per_company`) viven solo en el `migration.sql`. Si
  `prisma migrate dev` propone eliminarlos, **rechazar**.
- El CI cancela runs anteriores del mismo ref: verificar siempre el **último**
  SHA publicado y que `head_sha` coincida.
