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
- [x] **Chatbot v1: motor durable** — flujos con **borrador y publicado
      separados** (se edita mientras hay gente conversando con la versión
      anterior), versiones inmutables y sesiones atadas a la **versión**, no
      al flujo: cambiarle el flujo bajo los pies a quien está respondiendo lo
      deja en un nodo que ya no existe. Índice parcial `WHERE status =
      'ACTIVE'` para una sola sesión por conversación —sin él, dos mensajes
      simultáneos duplican el saludo—. Entrega a humano que **pausa** la
      conversación para que el bot no se reenganche, y que **no depende de la
      asignación**: si el asesor elegido ya no existe, la entrega se completa
      igual y el cliente no queda atrapado con el bot. Tope de 30 pasos que
      corta bucles entregando a una persona, no enmudeciendo ·
      2 migraciones · 22 unit + 23 e2e reales
- [x] **Estrategia única frente al doble efecto** — el chatbot va primero y,
      si responde, las automatizaciones se saltan. Sin esa regla el cliente
      recibe DOS mensajes por cada uno que envía. También se salta el aviso de
      «nuevo mensaje» mientras el bot conversa; al entregar, el asesor recibe
      el suyo · 5 pruebas
- [x] **Chatbot: constructor visual** — cada paso declara a cuál va después
      **eligiéndolo de una lista**, no escribiéndolo: es lo que hace imposible
      el error más común, enlazar a un paso inexistente. No es un lienzo de
      nodos porque sobre un flujo de WhatsApp —lineal con bifurcaciones en los
      menús— añade la carga de colocar cajas sin añadir capacidad, e invita a
      dibujar ramificaciones que el motor no ejecuta. Borrar un paso limpia
      los enlaces que apuntaban a él y reasigna el inicio si hacía falta ·
      15 pruebas
- [ ] Notificaciones (productores completos)
- [ ] WhatsApp: salud, medios, plantillas, estados
- [x] **Cotizaciones con PDF en servidor** — PDFKit, no Chromium (decisión
      11): un Chromium por PDF multiplica por diez la memoria del contenedor
      para dibujar una tabla. En el servidor y no imprimiendo la pantalla
      porque un PDF hecho por el navegador depende de la impresora, el zoom y
      la versión de Chrome de quien lo genere: dos personas mandarían
      documentos distintos al mismo cliente. **Lo que DICE el documento vive
      en una función pura** (`quote-document.ts`) separada del dibujado: el
      contenido de un PDF va comprimido y no se puede comprobar buscando
      texto, así que sin esa separación las decisiones que importan —qué
      campos se omiten, si aparece la línea de descuento— quedarían sin
      probar · 68 pruebas
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
- [x] **Sistema visual aplicado al producto** — `Button` y `Badge` codifican
      las reglas de marca para que no dependan de que alguien las recuerde
      (un botón naranja lleva texto navy; `type="button"` por defecto). 48
      botones primarios pasados al navy de marca. El acento aparece donde
      aporta —contador de no leídos, «Sin asignar», barra a la izquierda del
      menú activo—, como borde y no como fondo: el naranja a pantalla completa
      compite con el contenido y taparía el color propio de cada empresa
- [x] **Foco visible en todo lo interactivo** — el producto usa `outline-none`
      en casi todos sus campos y no reponía nada. Regla global, **sin
      `:where()`**: eso la dejaría con especificidad cero y cualquier
      `.outline-none` la anularía, que es justo el caso que cubre
- [x] **`docs/DESIGN-SYSTEM.md`** — dónde vive cada cosa, las tres reglas
      irrompibles, y qué NO hay (tema oscuro, logo en el PDF) con su motivo
- [x] **QA visual del login** (escritorio 1440×900, Chrome headless) — el
      lockup TAKTO, la división TAK/TO, Archivo en el titular, IBM Plex Sans
      en el cuerpo y los neutrales de marca se ven correctos. La captura
      móvil se tomó sin emulación de dispositivo, así que **no es
      concluyente** sobre el diseño responsive; el `<meta viewport>` sí se
      verificó presente
- [x] **QA visual con sesión iniciada, 6 pantallas × 3 viewports** (390, 768,
      1440) vía CDP: login real, emulación de dispositivo y captura. 18
      capturas, **0 desbordes horizontales**. La revisión a ojo encontró lo
      que la comprobación automática no ve: **las pestañas de la bandeja
      salían recortadas** con flechas de desplazamiento —dos de los cuatro
      filtros invisibles— porque el desborde era interno al contenedor y no de
      la página. Corregido envolviéndolas
- [x] Design system con tokens semánticos + documentación
- [x] Favicon, manifest/PWA, Open Graph, metadatos
- [x] Fuentes Archivo / IBM Plex Sans / IBM Plex Mono
- [ ] Todas las superficies del §4 del encargo
- [ ] Separación identidad plataforma vs empresa cliente
- [ ] `prefers-reduced-motion`

### Bloque 9 — Seguridad y cumplimiento
- [x] **Política de acceso comprobada sobre TODO el árbol** —
      `security-policy.spec.ts` recorre cada controlador y exige sesión,
      aislamiento por empresa y rol donde toca. Va sobre el **código** y no
      sobre peticiones porque el riesgo real no es el controlador de hoy: es
      el que se añada en tres meses sin guardas, y ninguna prueba de
      comportamiento existente fallará por él. Las excepciones llevan su
      motivo escrito — una excepción sin motivo es indistinguible de un olvido
      · 69 comprobaciones
- [x] **HALLAZGO CORREGIDO: `/notifications` sin `BusinessTenantGuard`.** Un
      SUPER_ADMIN de plataforma alcanzaba un endpoint de negocio. No filtraba
      datos —ninguna notificación tiene `companyId` null— pero eso es una
      casualidad de los datos, no una garantía del control de acceso
- [x] **Matriz de permisos con peticiones reales** — SUPER_ADMIN de
      plataforma, SUPER_ADMIN de empresa, ADMIN y AGENT contra las tres clases
      de endpoint. Comprueba además que el servicio **no llega a ejecutarse**
      cuando se rechaza: un 403 devuelto después de leer datos sigue siendo
      una fuga · 20 e2e
- [x] **Retención por empresa** — `retentionMonths` nulo por defecto =
      **no se purga nada**. La purga exige **dos señales** (plazo Y
      interruptor explícito): con una sola, un plazo puesto por error empieza
      a borrar solo. Mínimo de 3 meses, previsualización antes de ejecutar, y
      solo toca conversaciones cerradas o archivadas — una abierta es trabajo
      en curso por antigua que sea
- [x] **Exportación** de los datos de la empresa, sin credenciales de ningún
      tipo: exportar un secreto cifrado sigue siendo exportar un secreto
- [x] **Solicitud de eliminación que NO borra** — queda `PENDING` y exige
      aprobación aparte, con motivo obligatorio. Un endpoint que borre el
      historial completo en una llamada es justo lo que no debe existir
- [x] **Auditoría** de cambio de política, exportación, purga y solicitud, con
      actor obligatorio · `20260731…_add_retention_and_data_requests` ·
      21 e2e reales, incluido que la purga **no toca nada de otra empresa**
- [x] **Observabilidad** — `/api/health/status` agregado (bloque 6) + latido
      del worker + typecheck en CI

### Bloque 9 — Seguridad y cumplimiento (detalle heredado)
- [ ] Corregir PII en logs de WhatsApp
- [ ] Observabilidad de 4xx
- [ ] Desconexión completa de WhatsApp
- [ ] Rotación de clave de cifrado
- [ ] Retención / exportación / eliminación
- [ ] Sesiones de soporte vencidas marcadas ACTIVE
- [ ] Fijar throttling y límites de body en `.env.staging`

### Bloque 10 — QA y entrega
- [x] **Suites verdes** — 1268 unit / 457 e2e / 304 frontend, typecheck sin
      errores en ambos proyectos, lint y build limpios
- [x] **QA visual en 6 viewports** (320/390/430/768/1280/1920) con sesión
      iniciada real vía CDP · 36 capturas, 0 desbordes · **más accesibilidad**:
      0 controles sin nombre, 0 campos sin etiqueta, 0 imágenes sin `alt`.
      Dos defectos los encontró mirar las capturas, no el umbral automático
- [x] **Ruta de actualización de la base verificada** —
      `scripts/verificar-ruta-de-migracion.sh`: base llevada al estado exacto
      de staging (21 migraciones), datos insertados, y **solo entonces** las
      20 restantes. No es lo mismo que el CI, que aplica desde cero sobre
      tablas vacías: una columna `NOT NULL` sin default pasaría allí y
      fallaría en el despliegue
- [x] **Pruebas de carga** — 20 concurrentes: p95 entre 25 y 50 ms. La primera
      pasada agotó el límite de 300 pet./min por IP y midió el 429; el
      limitador funciona y quedó comprobado de paso
- [x] **Degradación y recuperación** — con la configuración de staging y Redis
      caído, `/health/status` responde `degraded` (nunca `ok`) con la causa
      por componente, y HTTP 200 para que el orquestador no reinicie una
      instancia sana. `/health/ready` y el negocio siguen sirviendo
- [x] **`docs/TAKTO-IMPLEMENTATION-REPORT.md`** — informe de preparación con
      riesgos, lo que NO incluye y la secuencia de despliegue

#### Cierre de todo lo que el informe marcaba como no incluido

- [x] **Eliminación de datos completa** — solicitar, aprobar y ejecutar como
      tres papeles separados; recuento previo, nombre exacto de la empresa
      tecleado, auditoría y pruebas de aislamiento. La empresa no se borra:
      sin su ficha, la auditoría de su propio borrado no apunta a nada
- [x] **Rotación de `WHATSAPP_TOKEN_ENCRYPTION_KEY`** — clave anterior y nueva
      conviviendo, recifrado verificado fila a fila **antes** de escribir, y
      luz verde para retirar la vieja solo con cero filas antiguas y cero
      ilegibles. Runbook sin secretos en `docs/ROTACION-CLAVE-WHATSAPP.md`
- [x] **Historial de WhatsApp hasta el límite real de Meta** — la Cloud API no
      expone mensajes pasados; solo llega el historial de coexistencia, una
      vez. Lo demás, CSV con análisis previo. Nada importado dispara efectos.
      El límite se dice en la propia pantalla (`docs/HISTORIAL-WHATSAPP.md`)
- [x] **Barrido de `stone`** — 1407 usos → `neutral-*` en 85 ficheros, puente
      retirado, mismo conjunto de colores en el CSS compilado antes y después.
      Sin tocar `primaryColor` / `logoUrl` de cada empresa
- [x] **Interfaz para lo que solo existía en el backend** — Ajustes › Datos
      (retención, exportación, solicitud), Plataforma › Eliminaciones,
      importación de historial y administración de números
- [x] **Auditoría de las pantallas existentes** — chatbot, automatizaciones,
      pipelines, tareas y cotizaciones: estados vacíos, de error y de permiso,
      con pruebas de página para cada uno
- [x] **Varios números de punta a punta** — se listan, se nombran, se elige el
      principal, y **cada conversación se responde por el número que la
      recibió**. Antes se contestaba siempre desde el principal
- [x] **Lint del backend en CI** — estaba fuera y había acumulado 31 errores,
      dos de comportamiento

- [ ] QA E2E de extremo a extremo **en staging** — requiere desplegar
- [ ] CI verde de `main` — requiere fusionar
- [ ] Despliegue con etiquetas por SHA + release anterior recuperable

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
| 2026-07-31 | tras chatbot v1 (motor) | **1133 unit / 347 e2e verdes** |
| 2026-07-31 | **CI** `b1659bc` | ❌ **failure** — lint del frontend que publiqué a sabiendas |
| 2026-07-31 | **CI** `dc5b26d`, `179cb54` | **success**, `head_sha` verificado |
| 2026-07-31 | tras cotizaciones con PDF | **1167 unit / 347 e2e / 215 frontend verdes** |
| 2026-07-31 | **CI** `7e24cc0` (bloque 8) | **success**, `head_sha` verificado |
| 2026-07-31 | tras bloque 9 (seguridad y cumplimiento) | **1238 unit / 388 e2e verdes** |
| 2026-07-31 | **CI** `655efa8` (bloque 9) | **success**, `head_sha` verificado |
| 2026-07-31 | eliminación completa + rotación de clave | **CI** `5f6bee2` **success**, `head_sha` verificado |
| 2026-07-31 | historial de WhatsApp (sync + CSV) | **CI** `e255e8c` **success**, `head_sha` verificado |
| 2026-07-31 | barrido de `stone` | 1407 usos → `neutral-*`; **mismo conjunto de colores** en el CSS compilado |
| 2026-07-31 | pantallas que faltaban + auditoría de las existentes | **304 frontend verdes / 45 suites** |
| 2026-07-31 | varios números de punta a punta | **1268 unit / 457 e2e verdes** |
| 2026-07-31 | lint del backend a cero y dentro del CI | 31 errores → 0; dos eran de comportamiento |
| 2026-07-31 | ruta de migración staging → HEAD (20 migraciones) | **verificada con datos, sin pérdidas** |
| 2026-07-31 | **CI** `f5487c3` (cierre de pendientes) | **success** en ambos jobs, `head_sha` verificado, **incluye el nuevo paso de lint** |
| 2026-07-31 | QA visual 6 viewports + accesibilidad | 36 capturas, **0 problemas** |
| 2026-07-31 | ruta de migración staging → HEAD con datos | **verificada, sin pérdidas** |
| 2026-07-31 | carga (20 concurrentes) | p95 25–50 ms; limitador de tasa comprobado |
| 2026-07-31 | degradación con Redis caído | `degraded`, nunca `ok`; negocio sirviendo |
| 2026-07-31 | tras cerrar la deuda de tipos | **typecheck sin errores en ambos proyectos** |
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

## Incidente: primer despliegue a staging revertido (`ac7e32d`)

**Qué pasó.** El merge a `main` (`ac7e32d`) llegó verde, las 20 migraciones se
aplicaron sin error y con los datos intactos, y aun así `/api/health/status`
devolvió `degraded`: base, cola, worker y outbox `up`, pero el **puente de
tiempo real** en `redis-inalcanzable`.

**Causa, reproducida dentro del contenedor.** No era la infraestructura:

```
con enableOfflineQueue:false -> FALLA: Stream isn't writeable and enableOfflineQueue options is false
esperando ready              -> PONG
```

`crearClientesRedis()` construía el cliente y llamaba a `ping()` acto seguido.
ioredis conecta de forma asíncrona, así que el socket aún no era escribible y,
con `enableOfflineQueue: false`, el comando se rechazaba **al instante**. Ese
rechazo se leía como «Redis inalcanzable» y el puente quedaba apagado en
**todos** los arranques, contra una Redis sana — la misma que BullMQ usaba sin
problema, porque BullMQ sí espera a la conexión. Por eso `queue` salía `up` y
`realtime` `down` a la vez: la pista estaba en el propio health.

Lo irónico: `enableOfflineQueue: false` se había añadido para arreglar un
cuelgue de arranque. Arregló el cuelgue e introdujo esto.

**Qué se hizo.** Rollback documentado completo: restaurar el dump
pre-migración (21 migraciones, conteos idénticos), devolver las imágenes
`:58dfb76` y smoke test **17/17** exigiendo ese release. `postgres`, `caddy` y
`takto-web` conservaron su ID de contenedor: nunca se recrearon.

**Corrección.** `esperarListo()` espera el evento `ready` —acotado, y
retirando siempre sus escuchadores— antes del PING; `puenteUtilizable()` reúne
espera + PING en una sola función para que backend y worker no puedan volver a
divergir. `enableOfflineQueue: false` se conserva: lo que faltaba no era la
cola, era esperar.

**Lección para quien reanude:** la suite pasaba porque el doble de Redis
aceptaba `ping()` siempre. Un doble que no puede reproducir el fallo no
protege de nada. Las pruebas nuevas fallan contra el código anterior — se
comprobó reintroduciendo el defecto: **5 rojas**.

## Incidente de seguridad: `SMTP_PASSWORD` expuesta en la salida

**Qué pasó.** Para leer el usuario de base de datos ejecuté
`set -a; . ./.env.staging`. Bash falló al analizar una línea posterior y, al
informar del error de sintaxis, **incluyó el contenido de esa línea**, que era
`SMTP_PASSWORD`. El valor quedó en el registro de la sesión.

**Alcance.** Solo esa variable. No se imprimió ninguna otra credencial; el
fichero conserva permisos `600 deploy:deploy` y no se copió a ningún sitio.

**Por qué ocurrió.** `source` sobre un fichero de entorno lo ejecuta como
script: cualquier valor con comillas, `)`, `|` o `$` se interpreta, y el
mensaje de error de bash cita la línea completa. Un `.env` no es un script.

**Cómo se lee a partir de ahora** — nunca `source`, y sin volcar el valor:

```bash
# Dentro del contenedor, que ya tiene la variable en su entorno:
docker compose -f docker-compose.staging.yml exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "..."'
```

**Acción pendiente del operador:** rotar `SMTP_PASSWORD`. El despliegue queda
detenido hasta la confirmación explícita «SMTP rotada».

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

**Deuda de tipos: CERRADA.** `npm run build` usa `tsconfig.build.json`, que
**excluye los specs**, así que el CI nunca veía los errores de tipo de las
pruebas — y de ahí salieron dos fallos de esta sesión. Ahora:

- los **6 errores heredados** están corregidos (el `Buffer` de exceljs, el
  Prisma parcial y los `possibly undefined` en mocks de axios; estos últimos
  además afirmando que la cabecera **existe** antes de compararla: con acceso
  opcional a secas, la comparación pasaba sola sin comprobar nada);
- hay `npm run typecheck` en ambos proyectos y **el CI lo ejecuta**, así que
  un spec desalineado con el constructor que instancia vuelve rojo antes de
  poder mezclarse.

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

## Incidente: el CRM quedó inservible tras el despliegue (resuelto)

**Síntoma.** «No pudimos conectar con el servidor» en todas las pantallas,
inmediatamente después de desplegar `b9f3662`.

**La petición que fallaba**, capturada en el navegador:

```
POST https://crm-staging.tehusrattan.com/auth/refresh  ->  404
```

Salía contra el **origen del frontend**, sin el host de la API ni el prefijo
`/api`. Ese 404 se clasifica como fallo transitorio (`classifyRefreshError`),
y el arranque de sesión pasa a `unavailable`, que es justo esa pantalla. No es
sesión expirada: un 401 habría llevado a `/login`.

**Causa raíz — error de procedimiento, no del código.** `NEXT_PUBLIC_API_URL`
se incrusta en el bundle al construir. Se construyó con
`docker compose build` **sin `--env-file .env.staging`**, así que
`${NEXT_PUBLIC_API_URL}` se interpoló como cadena vacía y el bundle salió sin
`baseURL`. `deploy/scripts/deploy.sh` envuelve todas sus llamadas a compose con
`--env-file`; construir a mano se saltó eso.

Evidencia: ningún chunk de la imagen `b9f3662` contenía
`api.crm-staging.tehusrattan.com`; la imagen anterior `58dfb76` lo tenía en
tres.

**Lo grave no fue el error, sino que nada lo vio.** La imagen se construyó sin
fallo, el contenedor quedó `healthy`, `/api/health/status` respondió `ok` y el
smoke test pasó **17/17** con la aplicación totalmente inservible. El único
indicio era una línea de docker compose —«variable is not set»— que además
quedó oculta porque los comandos filtraban `level=warning`.

**Corrección (`f9369c9`), en dos capas:**

1. `verificarUrlDeApi` detiene la construcción de producción si la variable
   está vacía o no es absoluta, y el mensaje dice cómo construir bien. Se
   comprobó en el propio VPS: el mismo comando que causó el incidente ahora
   termina con `EXIT=1`.
2. El smoke test descarga el JavaScript realmente servido y exige que algún
   chunk contenga el host de la API. Es lo único que distingue un frontend
   sano de uno que apunta a la nada, porque el backend estaba perfecto y el
   frontend servía HTML con normalidad. Ahora **18/18**.

**Lección para quien reanude:** construir a mano en vez de usar `deploy.sh`
salta pasos que no se ven hasta que el producto está roto; y filtrar los
avisos de una herramienta es filtrar justo lo que intentaba avisar.

## DESPLEGADO EN STAGING — 2026-08-03

**Release en marcha: `f9369c97e30e22f0afaee8933e0f2c440c150246`** (11:40 hora
de Colombia), que incorpora el guardia de construcción. **Despliegue aceptado**
tras la QA autenticada del operador. El despliegue inicial
fue `b9f3662` a las 10:56, corregido tras el incidente documentado arriba.
Release anterior: `58dfb76`, conservado y recuperable.

### Verificación

| Gate | Resultado |
|---|---|
| CI del SHA exacto | **success** en ambos trabajos, `head_sha` verificado |
| Migraciones | **21 → 41**, **0 fallidas**, solo `migrate deploy` |
| Redis | `healthy`, **PONG** real, reinicios 0 |
| Puente de tiempo real | **conectado** — «Puente de tiempo real del worker conectado a Redis» |
| `Stream isn't writeable` | **0 apariciones** en worker y backend |
| Worker | `running`, release correcto, latido fresco, reinicios 0 |
| Backend / frontend | `healthy`, release correcto, reinicios 0 |
| `/api/health/status` | **`ok`** — 12 sondeos en 2 min, sin intermitencias |
| `health-check.sh` | **All checks passed** |
| Smoke test | **18/18**, `EXPECTED_RELEASE` = SHA desplegado, incluida la comprobación del bundle |
| Rutas del frontend | 13/13 sirven 200, incluidas Datos y Eliminaciones |
| API sin sesión | 401 en las 8 rutas protegidas comprobadas |

### Datos: idénticos antes y después

`companies 2 · users 4 · contacts 4 · conversations 4 · messages 7 ·
whatsapp CONNECTED 1`

### No recreados (id + StartedAt sin cambio)

```
postgres   db9487a56ba30a90  2026-07-29T14:40:41.529565451Z
caddy      7fc1da12b135516a  2026-07-29T14:40:41.536617591Z
takto-web  6072de2d372501da  2026-07-29T20:29:09.207992211Z
```

5 volúmenes intactos. Ningún `down`, ningún `-v`, ningún volumen eliminado.

### SMTP

Rotada el 2026-08-03 y **verificada con `verify()` — PASS, sin enviar ningún
correo**. Credencial anterior revocada por el operador en Hostinger. Se
comprobó por huellas SHA-256, sin imprimir ningún valor, que la nueva difiere
de la comprometida y que compose entrega al contenedor exactamente el valor
del fichero. El respaldo temporal con la clave comprometida y los scripts de
rotación se eliminaron con `shred`; los 50 backups restantes, intactos.

### Backups del despliegue

```
backups/tehus-crm-staging-20260803-105214.sql.gz
  sha256 14450084f7d5b2bd6ba4897436213bb61648667dd2346d43e361dbe6e03267ca
backups/tehus-crm-staging-uploads-20260803-105214.tar.gz
  sha256 913d5beeff9cf81afa2fa1cb575de9240284b3bef14ec2029fd46aaf588db1e9
```

Ambos `600 deploy:deploy`, checksum y gzip verificados, y **restore drill**
superado en base temporal `drill_20260803` con conteos idénticos; la temporal
se eliminó. Imágenes del release anterior conservadas como
`tehus-crm-staging-backend:58dfb76` y `…-frontend:58dfb76`.

### Rollback disponible

Documentado en `docs/DEPLOYMENT_RUNBOOK.md` §6 y ya ejecutado con éxito una
vez (incidente del 31 de julio): restaurar el dump pre-despliegue, devolver
las imágenes `:58dfb76` y smoke test exigiendo ese release. Backend y worker
se revierten **a la vez**: comparten imagen.

### Deuda detectada en este despliegue

1. **El worker figura `unhealthy` y no lo está.** Hereda el `HEALTHCHECK` de
   la imagen del backend, que consulta `http://127.0.0.1:3001/api/health`, y
   el worker no expone HTTP por diseño. La señal real —su latido en
   `system_heartbeats`, y `worker: up` en `/api/health/status`— dice que
   funciona. No afecta al servicio (`restart: unless-stopped` no actúa sobre
   la salud), pero es una etiqueta que engaña a quien monitorice. Corregir con
   un healthcheck propio sobre el latido, o desactivarlo para ese servicio.
2. **Aviso transitorio de cola al arrancar.** `QueueHealthService` registró
   una vez «Cola no disponible» a los pocos segundos del arranque, mientras
   BullMQ aún conectaba. Se corrige solo en la siguiente consulta y los 12
   sondeos posteriores dieron `ok`. Es el mismo patrón de «comprobar antes de
   estar listo» que el puente, pero sin consecuencia porque el endpoint
   reevalúa en cada petición.
3. **QA autenticada: COMPLETADA por el operador el 2026-08-03.** Todas las
   secciones cargan correctamente y no reaparece «No pudimos conectar con el
   servidor». No pudo automatizarse: `SUPER_ADMIN_EMAIL`/`SUPER_ADMIN_PASSWORD`
   del entorno son credenciales de siembra inicial y ya no coinciden con la
   cuenta real (401). No se insistió, porque reintentar habría activado el
   limitador. Si en el futuro se quiere automatizar, hace falta una cuenta de
   QA dedicada cuyas credenciales viajen por variable de entorno, nunca por el
   repositorio ni por el chat.

## Próximo comando seguro

**Bloques 0–10 CERRADOS en código.** Lo único que queda del plan es lo que
por definición no se puede hacer sin desplegar: fusionar a `main`, backup,
migración, despliegue y QA sobre staging.

Todo lo que el informe marcaba como no incluido está cerrado: eliminación de
datos completa, rotación de la clave de cifrado, historial de WhatsApp hasta
el límite real de Meta, barrido de `stone`, e interfaz —con estados vacíos,
de error y de permiso— para lo que solo existía en el backend.

**Lo que queda pendiente, y por qué:**

| Pendiente | Motivo |
|---|---|
| QA E2E sobre staging | Requiere desplegar |
| CI verde de `main` | Requiere fusionar |
| Despliegue con etiquetas por SHA | Es el paso final |

**Antes de fusionar, en este orden:**

1. Verificar CI verde del **último SHA publicado**, comprobando `head_sha`.
2. Backup verificado de staging (dump + uploads, con checksum y conteos).
3. `prisma migrate deploy` — 20 migraciones sobre el estado de staging; la
   ruta está ensayada con datos dentro, no solo desde cero.
4. Levantar **Redis y worker antes que el backend**: al revés, el primer
   arranque reporta `degraded` y confunde la verificación.
5. `/api/health/status` debe decir `ok`, no solo responder 200.

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
  **41** migraciones. **Nada desplegado, nada fusionado a main.**
- Las capacidades funcionales ya no bloquean: lo que queda es el
  procedimiento de despliegue, que es una decisión, no una tarea de código.
- **No retirar `Conversation.stage` todavía**: el dual-write sigue vigente
  hasta que frontend, automatizaciones, backfill y pruebas usen `Lead.stageId`
  de forma estable.
- Dos backups verificados: 2026-07-30 17:35 y 18:40.
- Índices parciales viven solo en el `migration.sql`. Si `prisma migrate dev`
  propone eliminarlos, **rechazar**.
- El CI cancela runs anteriores del mismo ref: verificar siempre el **último**
  SHA publicado y que `head_sha` coincida.
