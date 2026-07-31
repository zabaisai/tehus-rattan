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
- [x] **Procesador en el worker** — `inbound.processor.ts` en `WebhookModule`
      (evita el ciclo) · solo arranca si `shouldConsumeQueue()` · resuelve
      `assignedTo` al procesar, no lo toma del job · 13 pruebas
- [x] **Outbox durable** — `20260731152150_add_outbox_events` · evento en la
      MISMA transacción que el mensaje · `FOR UPDATE SKIP LOCKED` ·
      recuperación de colgados · backoff persistido en `availableAt` ·
      42 pruebas · **la ejecución en línea se eliminó**: un solo camino
- [x] **WebSockets con aislamiento por empresa** — namespace `/realtime`,
      autenticación en el **middleware del handshake** (el cliente rechazado
      recibe `connect_error` y nunca se cree en vivo), salas de empresa,
      usuario y conversación, eventos versionados `v1:`, puente de Redis para
      el worker, polling conservado como respaldo · **47 pruebas unitarias +
      14 e2e con sockets reales y dos empresas**
- [x] **Salud agregada `/api/health/status`** — db + cola + worker + outbox +
      tiempo real. **Con Redis o el worker caídos NUNCA reporta `ok`**: las
      conversaciones se siguen guardando y la interfaz responde, así que las
      sondas clásicas daban verde mientras los efectos de cada mensaje se
      acumulaban sin procesar. Latido del worker en PostgreSQL (no en Redis:
      si viviera allí, una caída de Redis borraría la prueba de la caída del
      worker) · `20260731172240_add_system_heartbeats` · 24 pruebas
      · **`degraded` responde 200 a propósito**, no 503: el CRM atiende y
      tumbar la instancia empeoraría las cosas; manda el campo `status`
- [ ] Observabilidad: 4xx visibles, logs sin PII, métricas

### Bloque 7 — Capacidades funcionales
- [x] **Conversación → oportunidad → asignación** — `LeadIntakeService`:
      el webhook por fin llega al tablero. Regla de la decisión 2 (reutiliza
      la abierta; si todas están cerradas, abre nueva), idempotente ante
      ráfagas mediante `pg_advisory_xact_lock(companyId:contactId)` ·
      round-robin por `User.lastAssignedAt` (sobrevive a reinicios y a dos
      procesos) · oportunidad y conversación al MISMO asesor · sin elegibles
      entra sin asignar y avisa a administradores ·
      `20260731161636_add_auto_assignment_fields` · 12 unit + 17 e2e reales
- [x] **Tarea desde la conversación** — panel comercial en el chat: muestra
      la oportunidad y su etapa, y crea la tarea atada a conversación +
      oportunidad + contacto sin salir del hilo. El asesor decide el siguiente
      paso mientras lee el mensaje; obligarle a ir al tablero y volver es el
      momento exacto en que se pierde el seguimiento · 7 pruebas
- [x] **Tiempo real en tablero, tareas y avisos** — la oportunidad entrante
      aparece sola; polling relajado a 30 s, nunca eliminado
- [x] **Aviso al reasignar a mano** — reasignar era silencioso: el nuevo
      responsable no se enteraba hasta abrir la bandeja por su cuenta, y
      mientras tanto el cliente esperaba. El reparto automático sí avisaba;
      esto lo iguala · 6 pruebas
- [x] **Bandeja omnicanal (backend)** — `InboxService` aparte del servicio de
      conversación: aquel gestiona UNA, este la LISTA. Filtros por estado,
      asignación (`me`/`unassigned`/id), no leídos, canal y oportunidad;
      búsqueda por nombre y teléfono; contadores; acciones masivas (asignar,
      desasignar, estado, leer/no leer) con tope de 100 y verificación de
      pertenencia **antes** de tocar nada. No leídos **por usuario** derivados
      de `lastReadAt` —sin contador que desincronizar— resueltos en SQL porque
      la correlación entre mensaje y marca no se puede expresar en Prisma ·
      `20260731…_add_conversation_reads` · 29 e2e contra base real
- [x] **Bandeja omnicanal (interfaz)** — pestañas con contador (Todas, Mías,
      Sin asignar, Sin leer), búsqueda, filtro de estado, selección múltiple y
      barra de acciones masivas. Abrir un hilo lo marca leído. Cada pestaña
      **reemplaza** el filtro anterior en vez de acumularlo, y cambiar de
      filtro limpia la selección: mantenerla dejaría marcadas conversaciones
      que ya no se ven. Sin borrado masivo — cerrar y archivar son
      reversibles, borrar no · 33 pruebas
- [ ] UI de pipelines y etapas
- [ ] Oportunidades (vista detallada)
- [x] **SLA de primera respuesta** — `ResponseSlaService`: detecta
      conversaciones cuyo **último** mensaje es entrante y lleva más del
      umbral de su empresa (`Company.responseSlaMinutes`, `null` = sin
      compromiso, que no es cero). Avisa al responsable, o a los
      administradores si no hay nadie — esa es la que más urge. Excluye
      resueltas, cerradas, archivadas y **pausadas** (están en manos del
      chatbot a propósito) · 17 e2e reales
- [x] **Trabajos programados en UN SOLO proceso** — `shouldRunScheduledJobs()`.
      Backend y worker comparten `AppModule`, así que ambos registraban los
      mismos `@Cron` y todo lo programado corría por duplicado. Hoy no se veía
      porque las notificaciones se deduplican y los borrados son idempotentes,
      pero eso era una coincidencia afortunada, no un diseño · 5 pruebas
- [x] **Asignación automática** — round-robin por `User.lastAssignedAt`
      (cerrado con el bloque de oportunidades)
- [x] **Automatizaciones: motor durable** — `AutomationRun` +
      `AutomationVersion`. Antes ejecutaba en línea y se tragaba los errores
      en un `logger.error`: si una automatización dejaba de funcionar, nadie
      se enteraba, y ante "¿por qué no se mandó ese mensaje?" no había nada
      que mirar. Ahora cada ejecución registra **qué versión** corrió y el
      resultado de **cada acción**; una acción fallida no detiene las
      siguientes, pero la ejecución no se marca completada. Idempotencia por
      `messageId:automationId` — un reintento del job no vuelve a mandarle un
      WhatsApp al cliente. `DEAD` tras 3 intentos, en la base y no en Redis
      para que sobreviva a un reinicio ·
      `20260731…_add_automation_versions_and_runs` · 14 e2e reales
- [x] **Automatizaciones: constructor visual** — pantalla propia (solo
      administradores: mandan mensajes reales a clientes reales) con editor de
      **lista ordenada**, no lienzo de nodos: el motor ejecuta "cuando pase X,
      haz A, luego B", y un lienzo con flechas prometería ramificaciones que
      no existen. Validación en cliente además del servidor, historial de
      ejecuciones con el resultado de cada acción y la versión que corrió ·
      **la prueba encontró un fallo real**: el campo de palabras clave se
      comía las comas, así que era imposible configurar más de una · 17
      pruebas
- [ ] Chatbot (motor + constructor visual)
- [ ] Notificaciones (productores completos)
- [ ] WhatsApp: salud, medios, plantillas, estados
- [ ] Cotizaciones + PDF real
- [ ] Configuración y personalización por empresa
- [ ] Plataforma y soporte

### Bloque 8 — Branding TAKTO
- [x] **Fundamento visual** — tokens del paquete de marca traducidos a
      `@theme` de Tailwind 4 (Tailwind 4 se configura en CSS, no con preset
      JS): paleta navy/naranja, neutrales de marca, semánticos, colores de
      etapa, radios, sombras teñidas de navy y curvas de movimiento
- [x] **Tipografía autoalojada** — Archivo (titulares, wordmark en 800) +
      IBM Plex Sans (interfaz) + IBM Plex Mono (cifras), vía
      `next/font/local`. Ninguna petición sale a Google Fonts, que además es
      lo que exige `font-src 'self'` de la CSP. Licencias OFL incluidas
- [x] **Identidad del navegador** — favicon (ico/svg/16/32/48), apple-touch,
      PWA 192/512, maskable, `site.webmanifest`, OG 1200×630, `themeColor`
      navy, título TAKTO con plantilla `%s · TAKTO`, `robots: noindex`
      (herramienta interna)
- [x] **Logotipo** — `TaktoLogo` como SVG inline (no `<img>`: en `<img>` el
      navegador no ve la fuente autoalojada y el wordmark caería a Arial).
      Fija la división TAK navy / TO naranja y la geometría del isotipo ·
      8 pruebas
- [x] **Marca visible en producto** — login con lockup TAKTO; correos de
      notificación y de recuperación; mensaje de prueba de WhatsApp. Dentro
      del espacio de trabajo sigue mandando la identidad de la empresa: es su
      casa, y mezclarlas es justo lo que prohíbe el manual
- [x] **Recoloreado global** — la escala `stone` (929 usos en 76 ficheros)
      se reasigna a los neutrales de marca en `@theme`. Un barrido manual
      habría sido enorme, propenso a erratas e imposible de revisar; así toda
      la interfaz cambia de una vez, sin tocar componentes y con vuelta atrás
      inmediata. **Verificado en el CSS compilado**: 0 apariciones de los
      grises originales (`#78716c`, `#1c1917`, `#f5f5f4`, `#a8a29e`).
      Es un puente: las pantallas nuevas usan `neutral-*`, y cuando no quede
      ningún `stone-*` el bloque se borra sin que cambie nada
- [ ] Aplicar el naranja de acento a superficies concretas (hoy solo vive en
      el logotipo; el token existe y las reglas de contraste ya están fijadas)
- [x] **QA visual del login** (escritorio 1440×900, Chrome headless) — el
      lockup TAKTO, la división TAK/TO, Archivo en el titular, IBM Plex Sans
      en el cuerpo y los neutrales de marca se ven correctos. La captura
      móvil se tomó sin emulación de dispositivo, así que **no es
      concluyente** sobre el diseño responsive; el `<meta viewport>` sí se
      verificó presente
- [ ] QA visual del resto de pantallas (requiere sesión iniciada)
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
| `20260731152150_add_outbox_events` | ✅ | ✅ | ❌ **no aplicada** | tabla nueva + enum | `DROP TABLE` / `DROP TYPE` |
| `20260731161636_add_auto_assignment_fields` | ✅ | ✅ | ❌ **no aplicada** | aditiva pura (3 columnas con default + 1 índice) | `DROP COLUMN` / `DROP INDEX` |

> **Importante para quien reanude:** staging sigue con **21** migraciones y en
> el release `58dfb76`. De la 22ª a la 31ª existen solo en la rama y en la
> base local. No se despliegan hasta que los bloques funcionales y el branding
> estén completos.

## Commits

| SHA | Descripción |
|---|---|
| _(ver `git log origin/main..HEAD`)_ | test(pipeline): caracterización pre-reforma |
| `1598def` | feat(realtime): canal WebSocket aislado por empresa |
| `32bbc7c` | style(backend): formato prettier que eslint ya exigía |
| `337e33e` | feat(leads): oportunidad automática desde WhatsApp + round-robin |
| `cef26f7` | feat(conversations): oportunidad y tarea desde el chat |
| `f8efb71` | feat(pipeline): selector de pipelines en el tablero |
| `3f7cb04` | feat(branding): identidad visual TAKTO (tokens, tipografía, iconos) |
| `c1a4173` | feat(branding): escala `stone` reapuntada a los neutrales de marca |
| `80d9590` | fix(realtime): el puente de Redis ya no cuelga el arranque |

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
| 2026-07-31 | tras productor de cola | 958 unit / 233 e2e verdes |
| 2026-07-31 | **CI** `c344540` (productor) | **success**, `head_sha` verificado |
| 2026-07-31 | tras procesador | 971 unit / 233 e2e verdes |
| 2026-07-31 | **CI** `e2c3254` y `b180055` (HEAD) | **success**, `head_sha` verificado en ambos |
| 2026-07-31 | tras outbox durable | **1000 unit / 233 e2e verdes** |
| 2026-07-31 | **CI** `f640106` (outbox) | **success**, `head_sha` verificado |
| 2026-07-31 | tras WebSockets | **1047 unit / 247 e2e verdes** (backend) |
| 2026-07-31 | frontend tras WebSockets | **130 verdes / 26 suites**, lint y build limpios |
| 2026-07-31 | **CI** `32bbc7c` (WebSockets) | **success** en ambos jobs, `head_sha` verificado |
| 2026-07-31 | tras entrada de oportunidades + reparto | **1064 unit / 264 e2e verdes** |
| 2026-07-31 | **CI** `337e33e` (oportunidades + reparto) | **success**, `head_sha` verificado |
| 2026-07-31 | tras tarea desde conversación | **1064 unit / 264 e2e / 137 frontend verdes** |
| 2026-07-31 | **CI** `cef26f7` (chat → tarea) | **success**, `head_sha` verificado |
| 2026-07-31 | tras fundamento de marca TAKTO | **1064 unit / 264 e2e / 150 frontend verdes** |
| 2026-07-31 | **CI** `3f7cb04` (branding) y `c1a4173` (neutrales) | **success**, `head_sha` verificado en ambos |
| 2026-07-31 | tras arreglo del arranque sin Redis | **1071 unit / 264 e2e verdes** |
| 2026-07-31 | **CI** `cbdbc18` (incluye el arreglo) | **success**, `head_sha` verificado |
| 2026-07-31 | **CI** `80d9590` | **cancelled** por el push siguiente — cubierto por `cbdbc18` |
| 2026-07-31 | tras aviso de reasignación | **1077 unit / 264 e2e verdes** |
| 2026-07-31 | **CI** `437cfbd` y `c8036fa` | **success**, `head_sha` verificado |
| 2026-07-31 | tras salud agregada | **1101 unit / 264 e2e verdes** |
| 2026-07-31 | **CI** `4dbc8d4` (salud agregada) | **success**, `head_sha` verificado |
| 2026-07-31 | tras bandeja omnicanal (backend) | **1101 unit / 293 e2e verdes** |
| 2026-07-31 | **CI** `7748c73` (bandeja backend) | **success**, `head_sha` verificado |
| 2026-07-31 | tras bandeja omnicanal (interfaz) | **183 frontend verdes / 32 suites** |
| 2026-07-31 | **CI** `b11da62` (bandeja interfaz) | **success**, `head_sha` verificado |
| 2026-07-31 | tras SLA de respuesta | **1106 unit / 310 e2e verdes** |
| 2026-07-31 | **CI** `eaa5503` (SLA) | **success**, `head_sha` verificado |
| 2026-07-31 | tras motor durable de automatizaciones | **1106 unit / 324 e2e verdes** |
| 2026-07-31 | **CI** `e4d8c8a` (motor durable) | **success**, `head_sha` verificado |
| 2026-07-31 | tras constructor visual | **200 frontend verdes / 33 suites** |
| 2026-07-31 | **CI** `efbcebe` | ❌ **failure** — E2E: `roles-guard` no arrancaba |
| 2026-07-31 | tras recuperación | **1106 unit / 324 e2e / 200 frontend verdes**, typecheck sin errores propios, lint y build limpios |
| 2026-07-31 | **CI** `eaa5503` (SLA) | **success**, `head_sha` verificado |
| 2026-07-31 | tras historial de automatizaciones | **1106 unit / 324 e2e verdes** |

## Despliegues

_(ninguno en esta rama — staging sigue en `58dfb76`)_

## Bloqueadores

_(ninguno)_

## Fallo encontrado ejecutando el producto (no lo detectó ninguna prueba)

**El backend se colgaba al arrancar sin Redis.** El puente de tiempo real
hacía `ping()` y esperaba: un `ping` a un Redis inalcanzable **no falla**,
ioredis encola el comando y reintenta la conexión para siempre. El proceso se
quedaba a mitad del arranque —sin escuchar, sin responder al health y sin
registrar la causa—, que es el peor modo de fallo posible porque parece un
cuelgue sin explicación.

Corregido con una espera máxima de 3 s (`ESPERA_MAXIMA_REDIS_MS`),
`enableOfflineQueue: false` y `disconnect()` en vez de `quit()` al cerrar
(`quit` también espera a poder enviar el comando si nunca hubo conexión).
6 pruebas nuevas, incluida una tarea que no termina jamás.

**Lección para quien reanude:** las suites no lo detectaron porque en pruebas
`QUEUE_ENABLED=false`. Levantar el producto de verdad es lo que lo encontró.

## Incidente: CI rojo en `efbcebe` (recuperado)

**Qué pasó.** `efbcebe` añadió `AutomationRunsService` y `PrismaService` al
constructor de `AutomationsController`. `test/roles-guard.e2e-spec.ts` no usa
el módulo de la aplicación: monta uno a mano y provee las dependencias una por
una. Al aparecer una nueva, Nest no pudo resolverla y **la suite entera dejó
de arrancar**, incluidas las pruebas de analytics que compartían módulo.

**Por qué no se detectó antes de publicar.** Se ejecutaron los unitarios tras
tocar el controlador, pero la última corrida de E2E era anterior al cambio.

**Regla para quien reanude:** cambiar el constructor de un controlador obliga
a **reejecutar E2E**, no solo unitarios. Son las suites que construyen módulos
a mano las que se rompen, y ninguna otra señal lo avisa.

**Hallazgo colateral, más grave que el fallo original.**
`whatsapp-tenant-isolation.spec.ts` construía `WebhookService` con 8 de sus 10
argumentos, y los que faltaban estaban **en medio**: la cola aterrizaba en la
posición de las notificaciones y el outbox en la de la cola. Las pruebas
pasaban porque no alcanzaban esos caminos. Corregido: los diez van nombrados
y en orden.

**Deuda de tipos registrada.** `npm run build` usa `tsconfig.build.json`, que
**excluye los specs**, así que el CI nunca ve los errores de tipo de las
pruebas. `npx tsc --noEmit -p tsconfig.json` sí. Tras la recuperación quedan
**6 errores anteriores a esta rama** (un `Buffer` de exceljs y varios
`possibly undefined` en mocks de fetch) que no se tocan para no mezclar deuda
heredada con la introducida aquí.

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

**Bloques 0–6 CERRADOS.** Redis, worker, cola, procesador, outbox durable y
WebSockets.

**Bloque 7 EN CURSO.** Hecho: entrada automática de oportunidades desde
WhatsApp (el agujero de fondo del producto), reparto round-robin, tarea desde
la conversación, selector de pipelines y tiempo real en las pantallas.
Pendiente: bandeja omnicanal, SLA de tareas, motor de automatizaciones durable
con constructor visual, chatbot v1, salud de WhatsApp/medios/plantillas,
cotizaciones con PDF en servidor y configuración de empresa.

**Bloque 8 PARCIAL.** Fundamento visual completo y aplicado. Pendiente:
aplicar el naranja de acento a superficies concretas y QA visual con sesión
iniciada.

**Bloques 9 y 10 SIN EMPEZAR.** Retención/exportación/eliminación, rotación de
clave de cifrado, sesiones de soporte caducadas; y la campaña de QA final.

### Estrategia de ejecución, ya unificada

Había dos caminos (encolar / ejecutar en línea) mientras el outbox no existía.
**Ya no.** El evento se escribe en la misma transacción que el mensaje, así
que los efectos están garantizados aunque el proceso muera; si el enqueue
inmediato falla, el evento queda `PENDING` y lo recoge el dispatcher. Ejecutar
también en línea duplicaría efectos si el enqueue sí había llegado a Redis
antes de fallar la respuesta.

### Tiempo real: cómo quedó (ver `docs/REALTIME.md`)

- Namespace `/realtime`. **La autenticación va en el middleware del
  handshake**, no en `handleConnection`: así el rechazado recibe
  `connect_error` y nunca llega a creerse conectado, que es de lo que depende
  el respaldo por polling para saber cuándo actuar.
- **El `companyId` sale SIEMPRE del token.** Un `companyId` en el handshake se
  ignora; hay prueba unitaria y prueba e2e con sockets reales que lo fijan.
- La suscripción a un hilo se comprueba **contra la base** filtrando por el
  `companyId` del token, y el nombre de la sala lleva la empresa dentro como
  segunda barrera.
- **El worker emite por Redis** (`RealtimeTransport` crea un servidor de
  socket.io sin HTTP; el backend monta `RedisIoAdapter`). Sin ese puente, todo
  lo que procesa el worker se emitiría al vacío: no rompe nada, simplemente no
  llega, y solo se ve en producción.
- **El polling NO se quitó.** Con canal vivo pasa de 5 s a 30 s. Quitarlo
  convertiría el WebSocket en punto único de fallo y su caída se vería como
  "el CRM no actualiza".
- Emisores enganchados: mensajes (alta y estado de entrega), conversaciones,
  oportunidades, tareas y notificaciones.

```
# BLOQUE 7 — CAPACIDADES FUNCIONALES
#
# Orden sugerido (el flujo comercial completo primero, que es lo que hoy
# esta roto de cara al usuario):
#   1. Conversacion -> oportunidad: hoy `lead.create` solo se invoca desde
#      LeadsService.create y el webhook NUNCA lo llama. Por eso "WhatsApp
#      funciona pero no aparece nada en el pipeline".
#   2. Asignacion automatica round-robin.
#   3. Bandeja omnicanal + UI de pipelines y oportunidades.
#   4. Tareas y SLA.
#   5. Motor de automatizaciones durable + constructor visual.
#   6. Chatbot v1, plantillas, salud de WhatsApp, medios.
#   7. Cotizaciones + PDF en servidor.
#
# Recordar: emitir por RealtimeEmitter en cada punto que cambie estado
# visible, y respetar el dual-write de Conversation.stage / Lead.stageId.
```

**Recordatorios de seguridad vigentes**

- **Staging sigue en 21 migraciones y release `58dfb76`.** La rama va por
  **31** migraciones. **Nada desplegado, nada fusionado a main.**
- No desplegar ni fusionar mientras las capacidades funcionales (bloques 7–10)
  y el branding sigan incompletos.
- **No retirar `Conversation.stage` todavía**: el dual-write sigue vigente
  hasta que frontend, automatizaciones, backfill y pruebas usen `Lead.stageId`
  de forma estable.
- Dos backups verificados: 2026-07-30 17:35 y 18:40.
- Índices parciales viven solo en el `migration.sql`. Si `prisma migrate dev`
  propone eliminarlos, **rechazar**.
- El CI cancela runs anteriores del mismo ref: verificar siempre el **último**
  SHA publicado y que `head_sha` coincida.
