# TAKTO FlowBot — estado de implementación

> Fichero de continuidad. **No empezar de cero.** Lo marcado `[x]` está hecho,
> con pruebas, y no debe repetirse. Al reanudar: leer esto entero, verificar el
> estado real (nunca asumirlo) y continuar por «Próximo paso».

**Rama:** `feature/takto-flowbot-visual-builder`, creada desde `origin/main`
en `6be9756`.

---

## Preflight verificado (2026-08-03, solo lectura)

| Comprobación | Resultado |
|---|---|
| Repositorio | `C:\Users\Usuario\Desktop\Tehus_Rattan` · `zabaisai/tehus-rattan` |
| `main == origin/main` | sí, `6be9756`, 0 adelante / 0 detrás |
| Working tree | limpio (solo `brand/` sin rastrear, que NO se versiona) |
| CI del SHA exacto | **success** |
| Release en staging | `f9369c9` (main va 1 commit por delante, solo documentación) |
| Migraciones | 41 aplicadas, 0 fallidas |
| Contenedores | backend/frontend/redis/postgres/caddy/takto-web `running`, reinicios 0 |
| Salud agregada | `ok` — database, queue, worker, outbox y realtime `up` |
| WhatsApp | 1 integración **CONNECTED** |
| Datos | companies 2 · users 4 · contacts 4 · conversations 4 · messages 7 |

### Infraestructura que SE REUTILIZA (no duplicar)

| Pieza | Dónde |
|---|---|
| Cola durable (BullMQ) | `common/queue/` |
| Outbox transaccional | `common/outbox/` |
| Tiempo real + puente Redis | `common/realtime/` |
| Espera de Redis lista | `common/redis/redis-ready.ts` |
| Latido y salud del sistema | `common/health/` |
| Cliente de WhatsApp y multi-número | `modules/whatsapp/`, `modules/whatsapp-integration/` |
| Motor durable de automatizaciones | `modules/automations/` |
| Auditoría de plataforma | `modules/platform/platform-audit-log.service.ts` |

### Chatbot v1 existente — referencia (ver decisión del bloque 1)

Modelos ya en el esquema: `ChatbotFlow` (DRAFT/PUBLISHED, `draftNodes` JSON,
`publishedVersion`, `triggerKeywords`), `ChatbotFlowVersion` (versiones
inmutables) y `ChatbotSession` (ejecución: `currentNode`, `context`, `steps`).

Motor en `modules/chatbot/`: 5 tipos de nodo (`message`, `question`, `menu`,
`handoff`, `end`), flujo lineal con `next`, validador `validarFlujo`,
`elegirOpcion`, `interpolar`, tope `MAXIMO_PASOS = 30`, ejecución **síncrona**
dentro del webhook.

**Decisión revisada en el bloque 1:** se crean modelos `FlowBot*` nuevos en
vez de ampliar estos. El motivo está documentado abajo. Lo que NO se duplica es
la infraestructura: cola, outbox, tiempo real, WhatsApp y auditoría se
reutilizan tal cual.

---

## Bloque 0 — Correcciones operativas previas al despliegue

- [x] **Healthcheck engañoso del worker.** Heredaba el `HEALTHCHECK` de la
      imagen del backend (`wget http://127.0.0.1:3001/api/health`) y el worker
      no expone HTTP: figuraba `unhealthy` estando vivo. Ahora el proceso
      refresca una marca local en cada latido y el healthcheck mide su edad.
      Se escribe **con independencia de PostgreSQL**: un parpadeo de la base no
      puede marcar enfermo a un worker sano — sería el mismo error al revés.
      `docker-compose.staging.yml` define healthcheck propio para `worker`.
      **9 pruebas.**
- [x] **Carrera de `QueueHealthService`.** `QueuePingService` usa
      `lazyConnect`, cuyo estado inicial es `'wait'`, pero solo llamaba a
      `connect()` para `'end'`/`'close'`. El primer sondeo tras arrancar
      pingueaba un socket sin abrir y publicaba «cola caída» sobre una Redis
      sana: el `degraded` fugaz de cada despliegue. **5 pruebas.**
- [x] **Un solo lugar para «esperar a que Redis esté lista».** Extraído a
      `common/redis/redis-ready.ts` (`esperarListo`, `conTiempoLimite`,
      `pingCuandoListo`, `puenteUtilizable`). `realtime.redis.ts` lo reexporta
      para no romper importaciones. Tener dos copias fue exactamente lo que
      permitió que el mismo fallo apareciera dos veces por caminos distintos.
- [ ] Caddy: **no tocar sin backup, validación y rollback.** No se ha
      modificado. El access logging sigue desactivado (deuda registrada).

**Verificación:** backend **1302 unit / 457 e2e** verdes, typecheck 0 errores,
lint 0 errores, build limpio.

---

## Bloque 1 — Modelo de datos

- [x] **8 modelos nuevos** en `prisma/schema.prisma`: `FlowBot`,
      `FlowBotVersion`, `FlowBotTrigger`, `FlowBotExecution`,
      `FlowBotExecutionStep`, `FlowBotWait`, `FlowBotMetric`, `FlowBotTestRun`,
      con 5 enums. Todos aislados por `companyId`, directamente o por una
      relación inequívoca.
- [x] **Migración `20260803183745_flowbot_modelo_inicial`**, creada con
      `--create-only` y revisada a mano: 8 `CREATE TABLE`, 5 `CREATE TYPE`,
      25 índices y las claves ajenas. **Cero** `DROP TABLE`, `DROP COLUMN`,
      `TRUNCATE`, `DELETE FROM` ni `SET NOT NULL`. Aplicada **solo en local**.
- [x] Relaciones inversas añadidas a `Company`, `User`, `Conversation`,
      `Contact`, `Lead` y `WhatsAppIntegration`.

### Decisión registrada: modelos nuevos, no ampliar `ChatbotFlow`

El fichero de estado anterior decía «FlowBot evoluciona el chatbot v1». Al
llegar al modelo concreto, esa vía resultó peor y se cambió — queda anotado
porque contradice lo escrito antes:

El chatbot v1 está desplegado y con datos en staging. Su grafo es lineal
(`next` más opciones de menú) y su ejecución es síncrona dentro del webhook.
FlowBot necesita puertos tipados, ejecución durable, esperas que sobreviven a
un reinicio y disparadores que no son solo «mensaje entrante». Forzar ambas
semánticas sobre las mismas tablas dejaría filas que significan una cosa u otra
según una bandera. El v1 se conserva intacto y funcionando; FlowBot lo
sustituye cuando cubra su superficie.

### Rollback de la migración

Es puramente aditiva: nada que revertir en datos. Para deshacerla bastaría
`DROP TABLE` de las ocho tablas y `DROP TYPE` de los cinco enums, en orden
inverso a las claves ajenas. **No se ha aplicado en staging** y no se aplicará
hasta el despliegue final autorizado.

---

## Bloque 2 — Grafo, variables, validador y compilador

- [x] **`flowbot.graph.ts`** — catálogo tipado de **48 tipos de nodo** en seis
      categorías. Cada tipo declara categoría, puertos, configuración con tipos
      y obligatoriedad, variables que produce, si espera, si tiene efecto
      externo, si requiere IA y el rol mínimo. **Puertos, no `next`**: una rama
      sin conectar es detectable antes de publicar en vez de ser un `undefined`
      en ejecución. Límites duros de nodos, conexiones, pasos y profundidad.
- [x] **`flowbot.variables.ts`** — sustitución `{{ruta}}` con valor por
      defecto, **sin `eval`, sin `new Function`, sin intérprete**. Solo lee
      propiedades propias: `{{constructor.name}}` y `{{__proto__.x}}` no
      resuelven. No pinta objetos como `[object Object]`. Operadores de
      condición como funciones concretas, insensibles a mayúsculas y acentos,
      con formato de miles colombiano. Escapado de HTML para lo que se muestra
      en el panel del asesor.
- [x] **`flowbot.validator.ts`** — errores frente a avisos: un error impide
      publicar, un aviso no. Comprueba forma, inicio único y disparador,
      conexiones rotas, puertos inexistentes o duplicados, salidas obligatorias
      sin conectar, alcanzabilidad, **ciclos sin espera** (un bucle que pasa por
      una pregunta es legítimo; uno que gira solo no), configuración por tipo,
      referencias a pipeline/etapa/usuario/plantilla/credencial contra la
      empresa, secretos incrustados, y nodos de IA sin proveedor.
- [x] **SSRF en el validador** — solo HTTPS; bloquea localhost, loopback,
      10/172.16-31/192.168, `169.254` (metadata de nube), `.internal` y
      `.local`; rechaza credenciales en la URL. Si **solo la ruta** lleva
      variables, el host **sí** se valida al publicar; solo se difiere cuando
      la variable está en el host.
- [x] **`flowbot.compiler.ts`** — compila a `nodo → puerto → destino` con
      huella SHA-256 estable (claves ordenadas). Solo compila si no hay
      errores.
- [x] **75 pruebas** del núcleo.

**Verificación:** backend **1377 unit / 457 e2e** verdes, typecheck 0, lint 0,
build limpio.

---

## Bloque 3a — Intérprete, puertos de efecto y ejecutores

- [x] **`flowbot.ports.ts`** — el motor NO toca nada directamente. Todo efecto
      (WhatsApp, CRM, HTTP, IA, reloj, auditoría) pasa por una interfaz. Es lo
      que hace inocuo al simulador **por construcción**: no es una bandera
      repartida por el código que alguien pueda olvidar en un sitio, es otro
      juego de implementaciones. El `ContextoNodo` es deliberadamente estrecho:
      un ejecutor no recibe Prisma ni la petición, así que no puede consultar
      otra empresa porque no tiene con qué.
- [x] **`flowbot.executors.ts`** — 36 ejecutores. Un nodo devuelve el **puerto**
      por el que sale, nunca el nodo destino: así una conexión mal hecha se
      detecta al publicar. Incluye validación de correo, teléfono a E.164,
      número con rango y fecha en formato colombiano.
- [x] **Ventana de WhatsApp aplicada en el motor**, no en cada nodo: fuera de
      las 24 h el texto libre sale por la rama de error en vez de intentar un
      envío que Meta rechazaría dejando al cliente sin respuesta.
- [x] **`flowbot.interpreter.ts`** — avanza hasta esperar, terminar, fallar o
      alcanzar un tope. **No toca la base**: recibe estado y devuelve estado,
      lo que permite que el simulador ejecute EL MISMO código y que las pruebas
      de bucles y reanudaciones corran en milisegundos.
- [x] **`flowbot.fake-effects.ts`** — efectos falsos con registro, reloj
      manejable e identificadores con prefijo `sim-`, reconocibles de un
      vistazo si alguno acabara donde no debe.
- [x] **114 pruebas** del núcleo y el motor.

### Decisiones del motor

| Decisión | Por qué |
|---|---|
| La entrada la consume **un solo** nodo | Si no, la siguiente pregunta se autorrespondería con el mismo mensaje |
| Al vencer se sale por `timeout` **sin reejecutar** el nodo | Reejecutarlo reenviaría la pregunta al cliente |
| Sin rama de `timeout`, vencer **termina** | Es una decisión legítima del autor, no un fallo |
| El reparto por porcentaje es **determinista por ejecución** | Con azar real, un reintento mandaría al cliente por la otra rama |
| Superar el tope de pasos es **FAILED**, no fin normal | Terminar en silencio escondería el bucle |
| La clave de idempotencia lleva el **número de paso** | Sin él, la segunda vuelta de un bucle legítimo se tomaría por un reintento |
| El error guarda solo el **nombre**, no el mensaje | El mensaje del proveedor arrastra teléfonos y cuerpos de petición |
| El reintento lleva **dispersión** | Cien fallos por una caída de Meta reintentarían al unísono y repetirían la avalancha |

### Semántica real de entrega

**No es «exactly once»** y no se promete. Es *at-least-once* con efectos
idempotentes: cada efecto lleva una clave `ejecución:nodo:paso`, y el adaptador
la usa para no repetirlo. Un reintento tras un fallo de red puede volver a
llamar al adaptador; lo que no puede es producir dos mensajes o dos tareas.

**Verificación:** backend **1416 unit / 457 e2e** verdes, typecheck 0, lint 0,
build limpio.

---

## Bloque 4 — Entrada de oportunidades configurable

**Hallazgo del preflight:** la Parte 5 del encargo («mensaje entrante → Nuevo
lead») **ya estaba resuelta en su mayor parte** por `LeadIntakeService`, del
bloque 7 del proyecto anterior. Crea el contacto, la conversación y la
oportunidad, la reutiliza si ya hay una abierta, y **serializa con un bloqueo
consultivo de PostgreSQL** por `(empresa, contacto)` para que dos mensajes
simultáneos no abran dos oportunidades. No se reescribió nada de eso.

Los huecos reales eran dos, y son los que se han cerrado:

- [x] **`PipelineStage.isInitial`** — antes se usaba «la primera etapa por
      orden», que cambia sola en cuanto alguien reordena el tablero: las
      oportunidades nuevas empezarían a caer en otra etapa sin que nadie lo
      pidiera. Ahora la entrada se ata a una marca explícita. **El nombre no
      decide nada**: puede llamarse «Nuevo lead» o cualquier otra cosa, y hay
      una prueba que verifica que ninguna consulta filtra por texto.
- [x] **`CompanyLeadSettings`** — configuración por empresa: crear oportunidad
      sí/no, pipeline y etapa de entrada, reutilizar la abierta, tarea inicial
      con título y vencimiento, estrategia de asignación (ninguna / turnos /
      fija) y qué hacer con un contacto archivado que vuelve a escribir.
- [x] **`LeadSettingsService`** — resuelve la configuración comprobando
      **toda** referencia contra la empresa. Una configuración caduca o
      manipulada no puede meter la oportunidad de una empresa en el tablero de
      otra; y cuando una referencia no vale, se cae al valor por defecto en vez
      de fallar, porque el mensaje del cliente no puede perderse por un ajuste
      obsoleto. **13 pruebas**, la mitad de aislamiento.
- [x] `LeadIntakeService` conectado a la configuración, sin reescribir su
      transacción ni su bloqueo.

### Migración `entrada_oportunidades_configurable`

Aditiva y revisada a mano: 1 tabla, 1 enum, 1 columna con `DEFAULT false`,
1 índice único. **Cero** sentencias destructivas. Aplicada **solo en local**.

Incluye un **backfill** que marca como inicial la etapa de menor orden de cada
pipeline. Sin él, ninguna quedaría marcada y las empresas existentes dejarían
de recibir oportunidades: una migración aditiva habría roto el comportamiento
en silencio, que es peor que un error visible. Verificado en local: exactamente
una etapa inicial por pipeline.

**Rollback:** `UPDATE "pipeline_stages" SET "isInitial" = false;` y
`DROP TABLE "company_lead_settings"; DROP TYPE "EstrategiaAsignacion";`

### Lo que el typecheck de specs volvió a atrapar

Añadir `LeadSettingsService` al constructor de `LeadIntakeService` rompió
`test/lead-intake.e2e-spec.ts`, que lo construye a mano. El paso «typecheck
incluye specs» del CI lo detectó antes de publicar — es la tercera vez que ese
paso paga su coste.

**Verificación:** backend **1429 unit / 457 e2e** verdes, typecheck 0, lint 0,
build limpio.

---

## Bloque 3b (en curso) — Cola y selección de bots

- [x] **`QUEUE_NAMES.FLOWBOT`** — cola propia sobre el mismo Redis y la misma
      configuración. Separada de `INBOUND` porque un atasco de ejecuciones de
      bots no debe frenar el procesamiento de mensajes entrantes, ni al revés.
- [x] **`FlowBotQueueService`** — `jobId` **determinista**:
      `avanzar:<ejecución>:<paso>:<intento>` y `despertar:<espera>`. BullMQ
      descarta un `add` con un `jobId` existente, así que dos productores
      concurrentes producen **un** solo trabajo. El número de paso es
      imprescindible: sin él, el segundo avance de la misma ejecución se
      descartaría como duplicado y la ejecución quedaría parada para siempre.
- [x] **Retirada del despertar** cuando la espera se reanuda por otra vía, para
      que un vencimiento no saque por el puerto de tiempo agotado una ejecución
      que ya siguió. El consumidor lo revalida contra PostgreSQL: esta es la
      primera barrera, no la única.
- [x] **`FlowBotSelectorService`** — selección **determinista**. Filtra por
      empresa **dentro de la consulta**, solo bots `ACTIVE` con versión
      publicada y que no sean plantillas, y desempata por prioridad → más
      reciente → id. Sin el último criterio, dos bots con la misma prioridad
      creados en el mismo instante volverían a depender del orden de la base.
- [x] **Exclusividad**: en cuanto entra un bot exclusivo, ninguno más arranca.
      Dos bots contestando a la vez al mismo cliente es el fallo más visible y
      más difícil de explicar.
- [x] **Trazabilidad**: cada descarte lleva su motivo, para que «el bot no
      contestó» tenga respuesta.
- [x] Filtros por palabra clave (insensible a acentos), pipeline, etapa,
      etiqueta, primera conversación y horario —con rangos que cruzan la
      medianoche—. Un filtro desconocido **no** silencia el bot: descartar por
      una clave que no entendemos dejaría bots mudos sin explicación.
- [x] **16 pruebas** de cola y selección.

**Verificación:** backend **1445 unit / 457 e2e** verdes, typecheck 0, lint 0,
build limpio.

---

## Bloque 3c — Runner durable (persistencia)

- [x] **`FlowBotRunnerService`** — el motor deja de vivir solo en memoria.
- [x] **Creación idempotente** por índice único de `idempotencyKey`
      (`empresa:bot:versión:evento`). **No** es «buscar y si no existe crear»:
      con dos workers, ambos leerían «no existe» antes de que ninguno
      escribiera. La versión va en la clave para que republicar el bot permita
      arrancar de nuevo con el mismo mensaje.
- [x] **Evento de outbox en la MISMA transacción** que la ejecución. Si el
      proceso muere tras el commit y antes de encolar, el despachador publica
      igual: el trabajo no puede perderse.
- [x] **Lease con vencimiento** (`leaseOwner` / `leaseUntil`) tomado con
      `updateMany` condicional — atómico. Un `findFirst` seguido de `update`
      deja un hueco por el que otro worker se cuela. Con vencimiento porque, si
      el proceso que lo tenía muere, nadie lo libera y la ejecución quedaría
      bloqueada para siempre. Solo se libera el lease **propio**.
- [x] **Solo avanza lo vivo.** El lease exige `RUNNING`/`WAITING_*`, así que un
      trabajo antiguo no puede revivir una ejecución cancelada, pausada,
      terminada o transferida.
- [x] **Consumo atómico de esperas** con `updateMany` sobre `consumedAt: null`:
      dos mensajes casi simultáneos no pueden consumir la misma espera ni hacer
      que el bot conteste dos veces.
- [x] **Pasos, estado, variables, espera y outbox en una transacción.** Guardar
      el estado sin la espera dejaría la ejecución dormida sin nada que la
      despierte.
- [x] **Pausa, reanudación y cancelación** durables. Cancelar **consume** las
      esperas pendientes: dejarlas vivas haría que un vencimiento intentara
      despertar algo que ya no debe seguir.
- [x] **Migración `flowbot_lease_de_ejecucion`**: 2 columnas nulables y 1
      índice. Cero destructivas. Solo local.
      **Rollback:** `ALTER TABLE "flowbot_executions" DROP COLUMN "leaseOwner", DROP COLUMN "leaseUntil";`
- [x] **18 pruebas E2E contra la base real**, incluidas tres carreras
      concurrentes de verdad.

### Un fallo que solo aparece contra PostgreSQL

La primera versión capturaba el choque de unicidad **dentro** de la transacción
y consultaba allí mismo la fila existente. PostgreSQL aborta la transacción en
cuanto una sentencia falla: la consulta de rescate fallaba también con
`current transaction is aborted`. La recuperación pasó a ir **fuera**. En
memoria no se ve; solo lo detecta una prueba contra la base.

**Verificación:** backend **1445 unit / 475 e2e** verdes, typecheck 0, lint 0,
build limpio.

---

## Bloque 3d (primera mitad) — Consumidor y adaptador real de CRM

- [x] **`FlowBotProcessor`** — consumidor de `takto.flowbot` siguiendo el mismo
      patrón que `InboundProcessor`. Se registra **solo en el worker**
      (`shouldConsumeQueue()`); en los dos procesos, cada trabajo se
      procesaría dos veces. Concurrencia configurable —más baja que la de
      entrantes, porque aquí el cuello de botella es PostgreSQL, no Meta—,
      cierre limpio esperando a los trabajos en vuelo, y contadores para el
      health.
- [x] **No confía en el contenido del trabajo.** El job lleva identificadores;
      la ejecución y la versión se releen con el `companyId` acotado. Un
      `versionId` de otra empresa no ejecuta su flujo con los datos de esta.
- [x] **`FlowBotEffectsFactory`** — la mezcla real/falso vive en **un solo
      sitio**. Si «enviar de verdad» fuese una bandera dentro de cada nodo,
      activarla por error en uno bastaría para escribirle a un cliente.
- [x] **`CrmAdapter` real** — contacto, etiquetas, oportunidad, etapa con
      historial, valor, asignación, reparto por carga, cierre, tareas, notas,
      cerrar/reabrir conversación y transferencia. El `companyId` se fija en el
      **constructor**: un nodo no puede pedir datos de otra empresa porque no
      tiene forma de indicar cuál. Toda escritura usa `updateMany` filtrando
      por empresa, nunca `update` por id.
- [x] Mensajería, HTTP e IA siguen siendo **falsos**: no se envía nada.
- [x] `FlowBotModule` registrado en `AppModule`.

### Dos fallos que atraparon las herramientas

- **`String(normalizePhone(x))`** habría escrito `[object Object]` como
  teléfono del contacto: `NormalizedPhone` es un objeto con `.e164`. Lo
  detectó la regla `no-base-to-string` — el mismo fallo que ya costó dos
  correcciones antes en este repositorio.
- **Campos inventados**: asumí `Contact.customFields` y una relación
  `assignedLeads` que no existen. El typecheck los rechazó antes de ejecutar
  nada.

### Limitación real anotada

`crm.contact_field` guarda el valor como etiqueta `campo:valor` porque
`Contact` **no tiene** un almacén de campos libres en el esquema. Cuando exista
la columna, cambia el adaptador sin tocar el nodo ni el grafo — que es
exactamente para lo que sirve el puerto.

**Verificación:** backend **1445 unit / 475 e2e** verdes, typecheck 0, lint 0,
build limpio.

---

## Bloque 3d (cerrado) — Transporte y recuperación durable

El motor **se mueve solo**. Demostrado levantando backend y worker de verdad y
empujando un webhook firmado: nadie llama al runner.

### Despacho del outbox → BullMQ

- [x] **`OutboxHandlerRegistry`** (`common/outbox/outbox.handlers.ts`). El
      despachador vive en `common/` y FlowBot en `modules/`; importar FlowBot
      allí haría que la capa común dependiera de un módulo de negocio y cada
      tipo nuevo obligaría a tocarla. Cada módulo declara qué sabe publicar. Un
      tipo **sin manejador se sigue marcando fallido**, no ignorado: un evento
      que nadie publica y que además desaparece del radar es exactamente cómo
      se pierde trabajo sin que nadie se entere.
- [x] **`FlowBotOutboxPublisher`** publica `flowbot.advance` y `flowbot.wake`.
      Corre en **los dos procesos**: si solo corriera en el worker, un worker
      caído dejaría los eventos acumulándose sin que nadie los despachara.
- [x] **Orden inviolable**, con prueba que lo fija:
      `persistir transición + outbox → commit → publicar → marcar outbox`.
      El manejador **no marca nada**: devuelve si pudo publicar y decide el
      despachador.
- [x] **Distingue «no pude publicar» de «no había que publicar».** Relee el
      estado antes de encolar; si la ejecución ya se canceló o pausó, lo da por
      despachado. Devolver fallo lo haría girar hasta quedar `FAILED` por haber
      funcionado bien.
- [x] **Políticas de reintento por tipo**, no una sola para todos:
      `flowbot.advance` reintenta rápido (2 s) y se rinde antes (8) porque el
      reconciliador lo rehará; `flowbot.wake` va con más calma (5 s) e insiste
      mucho más (12) porque perderlo deja la ejecución dormida para siempre.

### Reanudación por mensaje

- [x] **`FlowBotIntakeService`** conectado al webhook **después de
      `LeadIntakeService`** —un bot que consulta la etapa o el asesor necesita
      que existan— y **antes** del chatbot heredado y de las automatizaciones:
      la regla de «el primero que atiende se lo queda» no cambia, solo que
      FlowBot es ahora el primero de la fila. Dos motores respondiendo al mismo
      mensaje son dos WhatsApp al cliente.
- [x] **Reanudar antes que arrancar.** Al revés, un cliente que contesta a la
      pregunta de un bot arrancaría un segundo bot.
- [x] **La espera no se consume en el webhook.** La consume el runner al
      avanzar, con escritura condicional. Consumirla antes y morir sin escribir
      el evento dejaría la ejecución despierta sin nada que la despertara.
- [x] **El texto no viaja.** Ni al outbox ni a Redis: solo el `messageId`. El
      consumidor relee el cuerpo acotado por empresa.
- [x] **El `jobId` de un mensaje lleva el mensaje, no el paso.** Dos mensajes
      seguidos del mismo cliente están en el mismo paso y compartirían id.
- [x] Respeta `isPaused` igual que el chatbot heredado. Ningún fallo propaga:
      preferimos una conversación sin respuesta automática a un mensaje
      perdido.

### Reanudación por tiempo

- [x] El despertar se programa con el retraso hasta `wakeAt`; al vencer sale
      por el puerto de tiempo agotado y **no reejecuta** el nodo que esperaba,
      que reenviaría la pregunta al cliente.
- [x] Un despertar tardío, cuando el cliente ya contestó, es un **no-op**.
- [x] Un mensaje que llega tras vencer el plazo **no reanuda**: si las dos
      salidas compitieran por la misma espera, cuál gana dependería del orden
      en que se procesaran los trabajos.

### `FlowBotReconcilerService` — doce condiciones

`esperas-vencidas`, `ejecuciones-atascadas`, `leases-vencidos`,
`dormidas-sin-despertador`, `esperas-huerfanas`, `esperas-de-canceladas`,
`version-desaparecida`, `abandonadas`, `outbox-atrasado`, `outbox-fallido`,
`recuperaciones-en-bucle`, `atencion-pendiente`.

Idempotente, acotado a 100 filas por condición, seguro con dos instancias (todo
`updateMany` con el estado esperado en el `where` —incluidos el contador de
recuperaciones y el `leaseUntil` leído—, todo encolado con `jobId`
determinista). Pasa cada minuto y expone
`GET`/`POST /api/platform/flowbot/reconciler` tras `PlatformGuard`: forzar un
pase toca ejecuciones de todas las empresas.

**No inventa.** Reparar es reencolar o cerrar lo que ya no puede seguir; nunca
reejecuta un efecto externo. El outbox atrasado solo se **cuenta**, porque
publicarlo desde aquí duplicaría el camino del despachador.

### La decisión más importante del motor

`leasesVencidos`. Un lease vencido significa que un worker murió **mientras**
avanzaba: pudo morir antes del nodo, durante, o después de ejecutarlo y antes
de persistir el paso. En el tercer caso **el efecto ya ocurrió** —el WhatsApp
salió, la tarea se creó— y no hay rastro en la base.

- Con paso registrado tras el inicio del lease → el efecto está probado y su
  clave de idempotencia lo protege: se libera el lease y se reencola.
- **Sin** paso registrado → no se sabe nada. Reintentar podría mandarle el
  mismo mensaje otra vez al cliente; abandonar podría dejarlo a medias. Ninguna
  de las dos es aceptable como decisión automática, así que la ejecución pasa a
  **`NEEDS_ATTENTION`** con el motivo y decide una persona.

Es más lento y más molesto que reintentar a ciegas. También es la diferencia
entre un cliente que espera y un cliente que recibe la misma pregunta tres
veces.

El rastro de cada intervención va a la línea de tiempo de la ejecución como
paso `system.reconcile`, **no** a `AuditLog`: ese registra lo que hace una
PERSONA y exige un rol de actor. Meter ahí al reconciliador con un rol
inventado convertiría la auditoría en algo que miente sobre quién hizo qué.

### Los reintentos no llegaban a ejecutarse nunca

Un fallo reintentable persistía la ejecución como `FAILED` y encolaba el
reintento. Cuando el trabajo llegaba, `tomarLease` lo rechazaba —solo acepta
estados vivos— y devolvía «omitido». El reintento no se ejecutaba jamás.

**Un fallo reintentable no es un estado terminal.** Con reintento por delante
la ejecución sigue `RUNNING` con el `errorCode` anotado; solo pasa a `FAILED`
al agotar los intentos, que es cuando de verdad se probó y no salió. Como
efecto secundario, el reconciliador cubre el caso sin tocarlo: una ejecución
`RUNNING` sin lease y sin avanzar es justo lo que ya detecta como atascada.

El reintento va por outbox como todo lo demás, y el nº de intento viaja en el
trabajo: en el `jobId` para que no se descarte como duplicado del avance que
acaba de fallar, y en el payload para que el backoff crezca en vez de creerse
siempre el primero.

### Salud: degradado, nunca enfermo

`/api/health/status` gana el componente `flowbot`, que consulta la base
directamente y no los servicios —viven en otra capa y solo corren en el
worker—. Ejecuciones esperando revisión o despertares sin disparar lo ponen en
`stale` y el sistema en `degraded`. **Nunca en `down`**: un motor de bots que
necesita revisión no impide atender conversaciones a mano, y sacar el backend
del balanceador por esto convertiría un problema de bots en una caída del
producto.

### Migración `20260803224322_flowbot_recuperacion_segura` (solo local)

Puramente aditiva: valor de enum `NEEDS_ATTENTION`, columnas `attentionReason`
(nulable), `recoveries` (defecto 0) y `lastRecoveryAt` (nulable), e índice
`(status, lastStepAt)` sin el cual cada pase del reconciliador leería la tabla
entera de ejecuciones.

**Rollback:** basta con no desplegar el código; las columnas sobran pero no
estorban. Revertir un valor de enum exige recrear el tipo en PostgreSQL, así
que si hubiera que volver atrás se deja el valor y se ignora.

### El fallo que ninguna prueba podía ver

**BullMQ rechaza cualquier `jobId` que lleve `:`.** Con 1539 unitarias y 505
e2e en verde, contra BullMQ de verdad no avanzaba ni una ejecución.

Ninguna prueba lo vio porque un doble de la cola guarda la cadena tan contento:
la propiedad que se estaba comprobando —«mismo id, un solo trabajo»— se cumplía
perfectamente en el doble. Y se presentaba como un warning de «no se pudo
encolar», indistinguible de un Redis caído, que es transitorio: la ejecución se
quedaba quieta para siempre y el log no daba ninguna pista.

Los tres constructores pasan a `-`, y el id se **valida antes** de llamar a
BullMQ registrando **ERROR** y no warning: un id mal construido es un error de
programación permanente y tiene que leerse distinto de una caída pasajera.

Lo destapó la demostración autónoma. Es exactamente su razón de ser.

### Demostración autónoma

`apps/backend/scripts/flowbot-demo-autonoma.mjs`. No llama al runner, ni al
intake, ni al reconciliador: prepara datos, levanta **backend y worker de
verdad**, empuja un webhook firmado con HMAC-SHA256 —secreto generado al vuelo
con `randomBytes`, en memoria, nunca escrito en ningún archivo— y **mira la
base** cada segundo.

```bash
docker compose up -d redis
cd apps/backend && npm run build
node scripts/flowbot-demo-autonoma.mjs
```

Recorrido observado, sin que nadie empuje nada tras el webhook: arranque →
`inicio → saluda → pide` → `WAITING_INPUT` → los tres eventos de outbox
`COMPLETED` solos → segundo webhook → `pide → gracias → fin`; y una tercera
conversación sin contestar que vence sola y sale por `pide → nadie → fin`.

No manda nada a nadie: la mensajería es el adaptador falso y no hay token de
Meta configurado. Lo que se observa es el recorrido del estado.

Dos trampas de configuración local anotadas, que costaron un rato: las rutas
van bajo `/api`, y `buildRedisConnection` lee `REDIS_HOST` y `REDIS_PORT` —no
una URL— con `redis` por defecto, que es el nombre del servicio en la red de
Docker y no resuelve fuera de ella.

**Verificación:** backend **1551 unit / 511 e2e** verdes, typecheck 0, lint 0,
build limpio, demostración autónoma completa.

---

## Bloque 5 (cerrado) — La vertical completa del backend

Existe una vertical funcional y demostrada:

```
mensaje entrante por el webhook real → contacto → conversación →
oportunidad en la etapa isInitial → selección del bot → ejecución durable →
respuesta de WhatsApp simulada → espera → segundo mensaje → reanudación →
campos personalizados → tarea → handoff humano → reanudación manual
```

### Campos personalizados reales

Se cierra la limitación anotada: `crm.contact_field` ya no guarda
`campo:valor` como etiqueta.

`CustomFieldDefinition` por empresa y entidad (`CONTACT` o `LEAD`), con los
doce tipos, opciones, validación, orden, activo y requerido.

- **La clave es `key`, no la etiqueta.** Renombrar «Cédula» a «Documento» no
  puede romper los flujos que escriben ahí. Es inmutable, y la base lo obliga
  con un CHECK `^[a-z][a-z0-9_]{0,62}$`: sin él, «Estado Credito» y «estado
  credito» convivirían como campos distintos.
- **El tipo también es inmutable.** Los valores ya están en la columna que les
  corresponde; pasar `TEXT` a `NUMBER` dejaría los datos existentes en
  `valueText` y las lecturas nuevas mirando `valueNumber`, así que el campo
  parecería vacío para todos los clientes anteriores.
- **Columnas tipadas, no un JSON opaco.** Con JSON, `"12"` y `12` conviven,
  ordenar por número ordena alfabéticamente y filtrar por rango de fechas
  exige castear en cada consulta. `Decimal` y no `Float` para `NUMBER` y
  `CURRENCY`.
- **Un CHECK** garantiza que un valor cuelga de UN contacto o de UNA
  oportunidad, nunca de ambos ni de ninguno: en PostgreSQL los NULL no chocan
  en un índice único, así que sin él una fila huérfana quedaría invisible.
- **Desactivar no borra.** Los valores son datos del cliente.
- **Historial propio**, no `AuditLog`: ese exige un rol de actor y registra lo
  que hace una PERSONA. Un bot no tiene rol. Solo se anota cuando el valor
  cambia de verdad — un bot que reescribe lo mismo llenaría el historial de
  ruido. **Necesita política de retención** antes de que el volumen importe.
- **Un solo camino de escritura**: el nodo y la API usan el mismo servicio,
  así que un bot no puede guardar lo que un formulario rechazaría. Y no se
  crea la definición sobre la marcha: un campo que aparece porque un bot lo
  mencionó llena el CRM de columnas fantasma con erratas por nombre.

Dos nodos nuevos: `crm.lead_field` —un dato del negocio pertenece a la
oportunidad; en el contacto se arrastraría a la siguiente venta, donde ya no
es cierto— y `crm.contact_archive`.

Validación compartida en `custom-fields.types.ts`: `dd/mm/aaaa` leído como
Colombia y no como Estados Unidos, `31/02` rechazada en vez de convertida en
3 de marzo, `javascript:` rechazada en una URL que el asesor va a abrir, y un
objeto rechazado en vez de guardado como `[object Object]`.

### Archivado seguro

`Contact.archivedAt` + `archivedReason`. Se marca, nunca se borra:
conversaciones, oportunidades e historial se conservan. Distinto de
`isBlocked`, que es una decisión sobre la relación; archivar es «ya no está
activo». `reactivateArchived` **por fin se aplica** — se leía desde el bloque
4 y no hacía nada porque no había estado que mirar.

### Handoff persistente

`ConversationHandoff` con `ACTIVE`/`RESOLVED`/`CANCELLED`. Existe como tabla y
no como bandera porque `isPaused` no responde ninguna de las preguntas que
importan: quién atiende, por qué, qué bot y qué nodo lo decidieron, cuándo, y
si ya se resolvió.

`RESOLVED` y `CANCELLED` se distinguen a propósito: medir «cuántas entregas se
quedaron sin respuesta» es imposible si son lo mismo.

**Una sola activa por conversación**, garantizada por un índice único PARCIAL
—Prisma no sabe expresarlo—. Chocar contra él se trata como idempotencia: un
reintento no le roba la conversación al asesor que ya la tenía.

**Dos barreras, y la redundancia es deliberada.** El handoff mantiene
`isPaused` en sincronía, pero esa bandera la puede quitar cualquier pantalla
sin saber que hay una entrega viva. La fuente de verdad es la tabla.

**No hay equipos en el esquema**, así que el handoff asigna un USUARIO. No se
inventa una columna que no apunte a ninguna tabla.

`GET`/`POST /api/conversations/:id/handoff[/resolve]`. `resumeBot` es decisión
de quien resuelve: muchas veces la conversación termina con la persona, y
despertar al bot volvería a escribirle al cliente sin motivo.

### WhatsApp: adaptador real sobre transporte falso

`WhatsappAdapter` implementa el puerto completo —texto, plantilla, imagen,
documento, botones y listas— con la lógica de verdad:

- Ventana de 24 h medida desde el último mensaje **ENTRANTE**: desde uno
  saliente se renovaría sola para siempre.
- Número remitente por donde entró la conversación, con desempate **explícito**
  al caer al principal (`isPrimary`, `order`, `id`), nunca un `findFirst`
  ambiguo.
- Idempotencia por `Message.externalKey`. `wamid` no sirve: lo asigna Meta
  después de enviar. La fila se reserva **antes** de llamar.
- Menú de más de 3 opciones convertido a lista en vez de perder las que
  sobran; títulos recortados a los límites de Meta.
- Errores clasificados en reintentable / definitivo / requiere atención.

**Que el transporte sea falso y no el adaptador entero es lo importante.** Si
se falseara el adaptador completo, el día que se conecte de verdad se
estrenaría en producción todo el código que nunca corrió. El falso implementa
el mismo contrato y recibe el mismo sobre.

Ni tokens, ni App Secret, ni teléfono completo, ni cuerpo del mensaje en
ningún log: del fallo solo se conservan el estado HTTP y el código de Meta.

### Cuatro fallos reales que encontraron las pruebas y la demostración

1. **Un avance suelto le repetía la pregunta al cliente.** Un evento de avance
   sin la espera que desbloquea la ejecución —un reintento tardío, un
   duplicado del outbox— reejecutaba el nodo que esperaba, y ese nodo VUELVE A
   PREGUNTAR. Ahora es un no-op.

2. **Guardar el `wamid` podía tumbar un envío que ya había salido.** Es único
   en la tabla; un choque hacía fallar el paso como reintentable y el motor
   REENVIABA. A partir de que el mensaje sale, nada de lo que pase escribiendo
   en la base puede convertirse en un error que se reintente.

3. **Todo se reintentaba igual.** El intérprete clasificaba como `interno`
   cualquier excepción de un ejecutor: un token caducado y un 503 de Meta se
   reintentaban cinco veces los dos. Ahora un error puede declarar su clase y
   el intérprete la respeta, leída por forma y no con `instanceof` —el motor no
   puede importar los adaptadores sin invertir la dependencia que hace inocuo
   al simulador—.

4. **Dos expectativas mías estaban mal y el producto tenía razón**: al vencer
   una espera, el nodo que preguntaba se ejecuta UNA vez; y asignar a un
   usuario de otra empresa LANZA en vez de no hacer nada.

### Pruebas

- **30 E2E de la vertical** (`test/flowbot-vertical.e2e-spec.ts`) con servicios
  reales cableados a mano: entrada, etapa por marca y no por nombre, selección
  determinista, idempotencia, espera y reanudación, consumo exactamente una
  vez, vencimiento, campos, historial, tarea, etapa, asignación acotada,
  reintento sin duplicar, archivado, handoff y su bloqueo del bot, reanudación
  manual, dos empresas aisladas, dos números, dos mensajes concurrentes, lease
  vencido a `NEEDS_ATTENTION`, outbox pendiente y ausencia de PII.
- **87 unitarias** de validación de campos, handoff y adaptador de WhatsApp.

### Demostración autónoma, 24 pasos

`apps/backend/scripts/flowbot-demo-autonoma.mjs`, por el webhook REAL y
firmado. Levanta PostgreSQL (ya en marcha), Redis, backend y worker.

```bash
docker compose up -d redis
cd apps/backend && npm run build
node scripts/flowbot-demo-autonoma.mjs
```

Recorrido observado: `inicio → saluda → pide → pide → campo_contacto →
campo_lead → tarea → entrega` con estado `HANDED_OFF`, más un segundo cliente
que no contesta y sale por `pide → nadie → fin`. Son dos personas distintas a
propósito: la conversación de la primera está entregada y el bot no debe
volver a hablar en ella, cosa que el paso 20 comprueba.

El token de la integración se cifra de verdad con la clave del entorno local
—en texto plano se estaría probando el camino de error— y su contenido es la
cadena `token-de-demostracion`. No hay ningún token de Meta.

### Cuatro migraciones, todas aditivas y solo en local

| Migración | Qué añade |
|---|---|
| `20260803224322_flowbot_recuperacion_segura` | `NEEDS_ATTENTION`, `recoveries`, índice |
| `20260803234805_campos_personalizados` | 3 enums, 3 tablas, 2 CHECK |
| `20260803235347_handoff_y_archivado_seguro` | `HandoffStatus`, `conversation_handoffs`, `Contact.archivedAt`, índice único parcial |
| `20260803235900_idempotencia_de_salientes` | `Message.externalKey` + único |

**Cero** `DROP`, `TRUNCATE` o `SET NOT NULL` sobre columnas existentes. Los
índices únicos sobre columnas nulables nuevas son seguros con datos previos:
en PostgreSQL los NULL no chocan.

**Rollback:** basta con no desplegar el código; las columnas y tablas sobran
pero no estorban. Para revertir del todo, en orden inverso a las claves
ajenas: `DROP TABLE custom_field_value_changes, custom_field_values,
custom_field_definitions, conversation_handoffs;` `DROP TYPE
CustomFieldSource, CustomFieldEntity, CustomFieldType, HandoffStatus;`
`ALTER TABLE contacts DROP COLUMN archivedAt, DROP COLUMN archivedReason;`
`ALTER TABLE messages DROP COLUMN externalKey;`. Revertir un valor de enum
—`NEEDS_ATTENTION`— exige recrear el tipo, así que se deja y se ignora.

**Verificación:** backend **1640 unit / 541 e2e** verdes, typecheck 0, lint 0,
build limpio, demostración autónoma completa, Nest arranca y mapea las rutas.

---

## Bloque 6 (cerrado) — Deudas del backend

Las cuatro deudas que quedaban anotadas. Eran el prerrequisito declarado para
exponer nodos en la interfaz: un nodo que se muestra pero no funciona es peor
que uno que no se muestra.

### La hora es la de la EMPRESA, nunca la del servidor

El fallo era **invisible en local**. Un horario «de 8 a 18» configurado en
Bogotá se evaluaba con `Date#getHours()`, o sea con la hora del contenedor,
que corre en UTC: a las 19:00 de Bogotá —medianoche UTC— el bot creía estar
fuera de horario por casualidad, no por la regla. En la máquina del
desarrollador nunca se veía, porque allí el servidor y la empresa comparten
zona.

`common/time/zona-horaria.ts`, con `Intl.DateTimeFormat` y sin dependencias
nuevas —una librería de fechas para leer una hora sería cargar dos megas—:

- `dentroDeHorario` devuelve `null`, no `false`, cuando la configuración no se
  entiende: una errata de un administrador no puede silenciar un bot en
  silencio.
- `proximaApertura` avanza hora a hora en vez de sumar 24 h, porque con
  cambios de horario de verano sumar un día no cae a la misma hora local.
- `instanteLocal` interpreta «2026-08-10 14:00» donde está el negocio. Sin
  esto, un recordatorio para las 9 de la mañana llegaba a las 4 de la
  madrugada.
- `zonaSegura` cae a la zona del producto si la de la empresa no vale: `Intl`
  **lanza** con una zona inventada.

Conectado al selector —con la consulta **perezosa**, porque casi ningún
disparador declara horario y preguntar por la empresa en cada mensaje para no
usar el dato es una consulta regalada—, al contexto de nodo y a
`control.wait_until`.

**Nodo nuevo `control.business_hours`**, con TRES salidas: dentro, fuera y
esperar a que abra. La tercera convierte un «estamos cerrados» en «te
atendemos a primera hora»; sin ella el autor solo puede disculparse.

### Retención del historial de campos personalizados

Crecía sin límite: un bot que escribe un campo en cada mensaje deja una fila
por cambio, y con cien conversaciones al día son cien mil filas al año por
empresa.

90 días por defecto, configurable por entorno, `0` lo desactiva. **No borra a
ciegas**: de cada (entidad, campo) conserva siempre el cambio más reciente
aunque esté fuera de plazo, porque si no, un campo escrito una vez hace un año
perdería toda explicación de por qué tiene ese valor. Por lotes y empresa por
empresa, de madrugada y solo en el worker.

### HTTP con protección SSRF

`integration.http` estaba en el catálogo y en el validador desde el bloque 2,
pero no tenía ejecutor. Toda la seguridad vive en el adaptador: un nodo no
puede relajarla porque no la conoce.

1. Apagado salvo que la empresa lo encienda.
2. Lista de destinos, y **vacía significa ninguno**.
3. Solo HTTPS, solo el 443, sin credenciales en la URL.
4. DNS resuelto y comprobadas **todas** las direcciones. El validador
   comprueba la forma al publicar, pero `evil.com` puede resolver a
   `10.0.0.5` justo en el momento de la llamada.
5. Redirecciones **no** seguidas: un 302 a `169.254.169.254` saltaría todas
   las comprobaciones, que se hicieron sobre la URL original.
6. Tiempo límite y tope de respuesta leído **por trozos**: con `.text()`, un
   servidor que devuelve un gigabyte tumba el worker antes de que nadie mire
   la longitud, y `content-length` no sirve porque un servidor puede mentir.
7. Métodos y cabeceras de lista cerrada. `authorization` la pone la
   credencial, no el flujo.
8. Credenciales cifradas que **el flujo nunca ve**: si pudiera leerlas,
   cualquiera con permiso de edición las exfiltraría con otro nodo.

68 pruebas del guardia, que son funciones puras. Cubren metadata de nube,
CGNAT, IPv4 envuelta en IPv6 —`::ffff:10.0.0.1`, que se salta cualquier
comprobación que solo mire texto— y el `ejemplo.com.atacante.net` que un
`includes` dejaría pasar.

### IA con proveedor intercambiable

El motor **no conoce ninguno**. Solo la interfaz `ProveedorIa`.

**El único registrado hoy es el falso**, y es deliberado: sin credenciales
reales no se puede implementar uno de verdad, y fingir que existe sería peor
que decir que falta. Sin proveedor, `disponible()` responde que no y los nodos
salen por su rama de reserva: el flujo sigue en vez de romperse.

Redacción de PII antes de salir —lo que sale no vuelve—, prompt del sistema de
la empresa con el del nodo **debajo**, salida validada contra la lista de
opciones, y topes de tokens y llamadas por día contados en `FlowBotAiUsage`.
El consumo se anota **salga bien o mal**: una llamada que falla después de
gastar tokens los gastó igual.

Hay ambigüedades reales en la redacción —diez dígitos en Colombia pueden ser
un móvil o una cédula— y se resuelven hacia la privacidad: etiquetarlo mal es
un problema de legibilidad, dejarlo pasar sería una fuga.

### No se publica un flujo que va a fallar

Un paso que necesita configuración que no está no falla al publicarlo: falla a
mitad de una conversación con un cliente real. `FlowBotReferenciasService`
resuelve desde la base lo que el validador necesita, **acotado por empresa**,
manteniendo el validador puro: recibe conjuntos y responde, sin conocer
Prisma. Así el mismo validador corre en el simulador, en la publicación y —el
día que exista— en el navegador.

### Migración `flowbot_integraciones` (solo local)

Aditiva: `FlowBotCredential`, `FlowBotSettings` y `FlowBotAiUsage`. 12
sentencias, 0 destructivas.

**Rollback:** no desplegar el código. Para revertir del todo:
`DROP TABLE flowbot_ai_usage, flowbot_settings, flowbot_credentials;`
`DROP TYPE "FlowBotCredentialType";`

**Verificación:** backend **1780 unit / 541 e2e** verdes, typecheck 0, lint 0,
build limpio. Frontend **315** verdes.

---

## Bloque 7 (cerrado) — API administrativa, simulador y plantillas

Un administrador ya puede gobernar FlowBot entero sin escribir JSON en la
base. **31 rutas** bajo `/api/flowbots`, demostradas por HTTP.

### Rol MANAGER

No existía. `ADMIN` y `AGENT` no cubrían el hueco real: quien diseña y publica
bots necesita más que un asesor y menos que un administrador. Puede crear,
editar, simular y publicar, y ver todas las ejecuciones, pero **no toca
credenciales ni integraciones** — dar `ADMIN` a esa persona es entregarle
también las claves de WhatsApp.

Migración aditiva: `ADD VALUE IF NOT EXISTS 'MANAGER' BEFORE 'AGENT'`.

### Versiones inmutables

Publicar **congela el grafo tal como está** en una fila nueva. Guardar una
referencia al borrador haría que editarlo cambiara la versión que está
corriendo. Todo en una transacción: crear, apuntar y subir el contador;
separarlo dejaría, al morir en medio, un bot apuntando a una versión a medio
escribir.

**Publicar y activar son decisiones distintas**: se puede tener la versión
lista y encenderla el lunes. Y activar exige versión publicada, porque el
selector solo mira los que la tienen.

Restaurar crea un **borrador nuevo**; no republica ni toca la versión
histórica. Quien restaure tiene que publicar otra vez, que es lo que deja
constancia de la vuelta atrás.

### Concurrencia optimista

El cliente manda la revisión que editó y la comprobación va **dentro** del
`updateMany`: entre un `findFirst` y la escritura hay un hueco por el que se
cuela el otro guardado.

El **409 devuelve el grafo actual**, no solo el número. Sin él la interfaz
solo puede decir «alguien te pisó» y obligar a recargar perdiendo el trabajo.

### Simulador

Mismo catálogo, mismo validador, mismo compilador, mismo intérprete. Un
simulador con su propia lógica prueba el simulador, no el bot.

Lo que cambia es el juego de efectos, y cambia **por construcción**: el
intérprete solo conoce los puertos y aquí recibe falsos. No hay un
`if (simulacion)` que alguien pueda olvidar en un sitio. La prueba cuenta las
filas de ejecuciones, contactos, oportunidades, tareas, mensajes y handoffs
antes y después: ni una.

Simula **varios turnos** —cada vuelta es «avanza hasta esperar» más «alguien
responde»— y explica cada decisión en texto, porque quien simula quiere
entender la rama, no clasificarla.

### Paginación por cursor

No por desplazamiento. Con `skip`, una ejecución nueva desplaza todo y la
página 2 repite filas de la 1; y en la página 50 la base cuenta 5.000 filas
para descartarlas. El cursor es `(startedAt, id)`, y el `id` desempata porque
dos ejecuciones pueden empezar en el mismo milisegundo.

### Reintentar no reenvía a ciegas

Si el último paso quedó `OK` y aun así la ejecución falló, **el efecto ya
ocurrió**: pasa a `NEEDS_ATTENTION` en vez de mandar el mismo WhatsApp dos
veces. Misma regla que el reconciliador aplica a un lease vencido.

### Permisos

`ADMIN` completo · `MANAGER` diseña y publica · `AGENT` consulta **lo suyo**,
con el filtro impuesto en el servidor y no confiado al cliente. Un `AGENT`
**sí** puede reanudar su propia conversación: quien la atiende sabe cuándo
devolvérsela al bot, y pedir permiso convierte una acción de treinta segundos
en un ticket.

### Contrato tipado con un solo catálogo

El editor **no mantiene su lista**: la pide. Dos catálogos escritos a mano
divergen el día que alguien añade un puerto en uno. `disponible` lo decide el
servidor mirando si hay ejecutor, y el frontend **nunca lee el mensaje** para
decidir: el código es estable, el mensaje es para la persona.

### Ocho plantillas, y el contrato honesto de una plantilla

Al escribirlas apareció una tensión real: un campo obligatorio vacío **no
puede** pasar el validador, pero poner una referencia de ejemplo es peor
—alguien publicaría sin cambiarla y le mandaría a su cliente el catálogo de
otro—.

Se resuelve con `camposPorCompletar`: una plantilla **o valida entera, o dice
exactamente qué le falta**, y la prueba comprueba que sus únicos errores son
esos. Cinco validan tal cual; tres declaran las referencias que nadie puede
elegir por el cliente.

Las pruebas fijan además que ninguna promete plazos ni descuentos —lo que diga
se lo dice a un cliente de otra empresa— y que ninguna menciona nada de Tehus.

**Dos fallos míos que encontraron esas pruebas:** un menú de botones no tiene
salida `next` sino una por opción (`opcion:0`…), y había inventado
`trigger.no_reply` y `{{conversation.withinWindow}}`, que no existen — lo
segundo además sobraba, porque el motor ya comprueba la ventana de 24 h y saca
el flujo por la rama de error.

### Redacción

Tokens, credenciales y cabeceras se ocultan por **nombre de clave
normalizado** —`apiKey`, `api_key`, `API-KEY` son lo mismo para quien filtra—
y el teléfono va enmascarado. Esta pantalla la abre soporte y se comparte en
capturas.

### Pruebas y demostración

**64 E2E** contra PostgreSQL: dos administradores guardando a la vez con
`Promise.allSettled`, inmutabilidad comprobada editando el borrador después de
publicar, simulador que no escribe ni una fila, reintento con efecto incierto,
aislamiento en seis caminos distintos, cursor sin repetir filas.

**84 unitarias** de las plantillas, validadas con las mismas reglas que aplica
la publicación.

`scripts/flowbot-demo-admin.mjs` — **22 pasos, PASS con 0 fallos**. Habla por
HTTP con el backend real: si algo solo funciona llamando al servicio por
dentro, ahí falla. Crea sesiones de verdad porque un token sin `sid` se
rechaza, y eso fue justo lo que falló al primer intento.

```bash
cd apps/backend && npm run build
node scripts/flowbot-demo-admin.mjs
```

### Migración `20260804160000_rol_manager` (solo local)

Un valor de enum. **Rollback:** no desplegar el código; nadie tiene el rol.
Revertir el valor exige recrear el tipo, así que se deja y se ignora.

**Verificación:** backend **1866 unit / 605 e2e** verdes, typecheck 0, lint 0,
build limpio, Nest arranca y mapea las 31 rutas.

---

## Bloque 8 (cerrado) — El constructor visual y las pantallas

Un administrador ya hace todo el recorrido desde la interfaz: crear un bot,
elegir plantilla, diseñar el flujo, configurarlo, arreglar errores, simularlo,
publicarlo, activarlo, ver ejecuciones, ver el contacto, archivarlo y
administrar varios embudos. **Ocho rutas** bajo `/dashboard/flowbots`.

### Acceso de plataforma, por fin atado

Era la limitación abierta del bloque 7. Un `SUPER_ADMIN` entraba a los bots de
una empresa por tener el rol; ahora entra **abriendo una sesión de soporte** —
empresa concreta, motivo escrito, caducidad—, que ya existía en el producto.

La sesión viaja en una **cabecera, no en el token**: atarlas obligaría a
reautenticar para revocar un acceso, justo lo contrario de lo que se quiere
cuando alguien se equivoca de empresa. Y **fija una empresa** en
`req.user.companyId`, así que a partir de ahí es un usuario de esa empresa para
todos los efectos: no queda ninguna ruta transversal.

**El orden de las guardas no era el obvio, y lo enseñó la prueba E2E por
HTTP.** Puesta detrás de `BusinessTenantGuard`, la guarda nunca llegaba a
correr: un usuario de plataforma no tiene empresa y le rechazaban antes con
«necesitas una empresa asociada». Con mocks eso no se ve, porque el orden lo
pone quien escribe la prueba.

La auditoría conserva **quién fue de verdad** —operador, empresa soportada, id
de sesión y el motivo escrito al abrirla—. Un registro que dijera solo «se
publicó en la empresa X» escondería que fue soporte, que es justo la pregunta
que se hace después.

### Un solo catálogo, ampliado con lo que faltaba

El editor no mantiene su lista de pasos: la pide. Para poder dibujar el lienzo
hicieron falta dos cosas que no estaban en el contrato:

- **`puertosDinamicos`** — un menú de botones NO sale por «Continuar», sale por
  la opción que eligió el cliente (`opcion:0…`). Sin esto habría que saberlo de
  memoria, y es exactamente la clase de cosa que se olvida y deja conectar una
  rama que el motor nunca recorre.
- **`variables`** — la lista CERRADA del motor con etiqueta, tipo y ejemplo
  falso. Una segunda lista escrita a mano en el frontend solo puede quedarse
  corta o inventar variables que el validador va a rechazar.

Agrupar en la paleta es presentación, no contrato: un tipo que no encaje en
ningún grupo **aparece igualmente** en el de su categoría, para que un paso
nuevo del backend no sea invisible hasta que alguien se acuerde de venir aquí.

### Lo que el editor no deja hacer

Conectar un paso consigo mismo, meter algo antes de un disparador, poner dos
conexiones en la misma salida —dos salidas del mismo puerto no significan «las
dos», significa que una se ignora y cuál es imposible de saber mirando el
dibujo—, borrar el arranque sin preguntar, o publicar con errores.

Quitar una opción de un menú **borra su puerto y la conexión que colgaba de
él**, en vez de dejar una conexión a un puerto que ya no existe.

### Pulsar un problema lleva al sitio

Selecciona el paso, lo centra en el lienzo, abre su panel y **enfoca el campo**.
«Falta el texto del mensaje» en un flujo de treinta pasos, sin eso, obliga a
abrirlos uno a uno.

Se distingue **incompleto** de **inválido**: uno se arregla rellenando y el
otro revisando, y no es lo mismo.

### Guardado automático y el 409

«Hay cambios sin guardar» se **deduce** —el grafo en pantalla no es el último
que confirmó el servidor—, no se apunta: guardarlo aparte solo abre la puerta a
que el indicador diga «Guardado» con cambios pendientes encima.

La revisión **solo avanza cuando el servidor confirma**. Darla por buena al
enviar dejaría al editor creyendo una revisión que no existe, y a partir de ahí
todo daría 409 sin que nadie tocara nada.

**Un 409 no pisa nada.** No se recarga el grafo remoto ni se intenta fusionar:
dos grafos mezclados sin una estrategia segura producen un flujo que nadie
escribió y que además parece correcto. Se para, se explica y se ofrece
**descargar el trabajo local** antes de tomar el del servidor.

### Publicar no es activar

Se puede dejar la versión lista y encenderla el lunes; juntarlo en un botón hace
que quien solo quería prepararlo ponga a hablar un bot con clientes esa tarde.
Y se dice que **las conversaciones en curso no cambian de versión a mitad de
camino**.

Restaurar una versión crea un **borrador**, no republica: volver atrás sin
revisar pondría a hablar con clientes una versión vieja que nadie ha vuelto a
mirar.

### El simulador avisa siempre

El cartel de que no hace nada real está **fijo arriba**, no solo al empezar: a
los treinta segundos esa pantalla es indistinguible de la de verdad para quien
entre a mitad.

### «Eliminar» un contacto ahora lo archiva

`DELETE /contacts/:id` hacía un borrado físico. Eso se lleva por delante las
conversaciones, los mensajes y las oportunidades de esa persona, y esa
información es del negocio: **la conversación en la que se acordó un precio no
deja de existir porque alguien limpie la lista de contactos**. Además casi nunca
es lo que se quiere: se pulsa «eliminar» para dejar de ver, no para destruir.

El modelo ya tenía `archivedAt` y el motor ya aplicaba la política de qué pasa
cuando la persona vuelve a escribir; faltaba justo la puerta del CRM. Archivar
dos veces no pisa la fecha ni el motivo originales, hay restauración, y ambas
quedan registradas: sin registro, «este contacto desapareció» no tiene respuesta
y la conclusión natural es que el producto perdió datos.

**Archivar no es bloquear.** Archivar es «ya no está activo»; bloquear es una
decisión sobre la relación. El borrado real sigue por la solicitud de
eliminación de datos, deliberadamente más lenta.

### La etapa de entrada se marca, no se adivina

`isInitial` estaba en el modelo y lo leía la entrada de leads, pero **no se
podía tocar por la API**: en la práctica mandaba «Nuevo lead» por nombre o «la
primera por orden» como reserva. Una empresa que llame a la suya «Primer
contacto» tiene el mismo derecho a que sus leads caigan donde toca.

La invariante la sostiene el servidor: marcar una desmarca la anterior **en la
misma transacción** —con dos marcadas, en cuál aparece el lead depende del orden
de la consulta—, no se puede desmarcar la única, y no se puede borrar la de
entrada mientras queden otras.

### Tiempo real por tablero

El evento de oportunidad lleva ahora `pipelineId` y el cliente refresca **solo
el tablero afectado**. Antes cualquier cambio invalidaba `["kanban"]` entero —la
clave es un prefijo—, así que en una empresa con cuatro embudos eran tres
consultas tiradas por cada arrastre. Siguen viajando solo identificadores: el
contenido se pide por la API, que aplica los permisos de quien pregunta.

### QA visual sobre el producto real, y lo que encontró

PostgreSQL, Redis, backend, worker y frontend levantados; Chrome sin cabeza;
sesión de verdad. `scripts/qa-flowbot-visual.mjs` — **26 comprobaciones, verde,
0 desbordes horizontales, 0 errores de consola**, con capturas de ocho pantallas
a 1440, 1280, 1024, 768 y 390 px.

Encontró **dos fallos que ninguna prueba veía**:

1. **Tres pasos de cada plantilla se dibujaban uno encima de otro.** `enFila`
   colocaba solo la fila principal y el resto se quedaba en `{0,0}`, que es el
   valor por defecto de todos. Para el validador un grafo con tres nodos en la
   misma coordenada es válido, así que las 84 pruebas de plantillas pasaban. La
   prueba que debía cazarlo solo pedía que **alguno** tuviera posición; ahora
   exige que ningún par comparta coordenada.
2. **El minimapa dibujaba un recuadro en blanco.** La proyección crea objetos de
   nodo nuevos en cada render y con ellos React Flow pierde las medidas que
   había tomado. Se pasan ancho y alto explícitos.

Confirmó además que el producto ya se explicaba bien donde importa: un paso
suelto no deja publicar y dice «no lleva a ningún sitio · conecta la salida de
este paso a otro», y a 390 px el editor avisa de que hace falta una pantalla más
grande en vez de romperse.

```bash
node scripts/qa-seed.mjs                       # empresa y usuario de QA
node scripts/qa-flowbot-visual.mjs ./salida    # recorrido + capturas
node scripts/qa-seed.mjs limpiar               # borra lo que creó
```

### Dependencia

`@xyflow/react` **12.11.2**, versión exacta. Es el paquete que mantienen
oficialmente los autores de React Flow (`reactflow` es el nombre antiguo). Sus
`peerDependencies` piden `react >= 17` y el proyecto va con React 19.2.4 sobre
Next 16.2.9. Sin rango: un `^` en la librería que dibuja el editor entero
significa que una instalación limpia dentro de tres meses puede traer otro
comportamiento de arrastre sin que nadie haya tocado el código.

### Verificación

Backend **1893 unit / 636 e2e**, frontend **385**, typecheck 0, lint 0, ambos
builds limpios, las ocho rutas en el manifiesto de Next.

---

## Próximo paso

**Auditoría visual con ojo humano y preparación de staging.** Lo que queda no es
construir, es mirar y decidir:

- Recorrer las capturas de los cinco anchos y corregir lo que chirríe.
- Cerrar las limitaciones abiertas de abajo, por orden de riesgo.
- Preparar el despliegue controlado a staging (nada de esto se ha desplegado).

### Limitaciones honestas que siguen abiertas

- **WhatsApp sigue sobre transporte falso.** Es lo que separa esto de una beta
  de verdad: nada ha salido nunca hacia Meta.
- **No hay equipos.** El handoff asigna un usuario.
- **El simulador no anima el recorrido sobre el lienzo.** Enseña la ruta paso a
  paso en el panel y deja saltar de un paso a otro, pero no resalta el nodo en
  el dibujo.
- **La comparación de versiones es textual**, por listas de nodos y conexiones
  añadidos, quitados y cambiados; no se dibujan las dos versiones lado a lado.
- **Sin OpenAPI generado.** El contrato tipado existe en TypeScript y lo sirve
  `GET /flowbots/catalog`, pero no hay `@nestjs/swagger` en el proyecto.
- **`resumir` de IA devuelve vacío**: el puerto solo recibe el id de la
  conversación.
- **El rebinding de DNS no está cerrado del todo.**
- **La accesibilidad está comprobada por lo básico** —nombres, etiquetas, foco
  visible, sin desbordes— con un barrido automático; no ha pasado una auditoría
  con lector de pantalla de verdad.

### Referencia del bloque 7 (cierre de la API administrativa)

**El constructor visual.** Todo lo que necesita ya existe y está probado:

| Lo que el lienzo va a consumir | Endpoint |
|---|---|
| Paleta de nodos, puertos y configuración | `GET /flowbots/catalog` |
| Abrir y guardar con control de conflicto | `GET`/`POST /flowbots/:id/draft` |
| Validación en vivo con `nodeId` para enfocar | `POST /flowbots/validate` |
| Publicar, versiones, comparar y restaurar | `/flowbots/:id/versions*` |
| Simular sin efectos | `POST /flowbots/simulate` |
| Plantillas y lo que falta por completar | `GET /flowbots/templates` |

Falta añadir React Flow —no está en las dependencias— y construir las
pantallas: FlowBot, ejecuciones, panel lateral de Conversaciones y el tiempo
real del Pipeline.

### Limitaciones honestas que siguen abiertas

- **No hay equipos.** El handoff asigna un usuario.
- **`SUPER_ADMIN` de plataforma no está atado a sesión de soporte en esta
  API.** Hoy entra como `ADMIN` de la empresa del token. El `PlatformGuard` y
  `SupportSessionsService` existen y se usan en otros módulos; atarlo aquí es
  trabajo pendiente y no está hecho.
- **Sin OpenAPI generado.** El contrato tipado existe en TypeScript y lo sirve
  `GET /flowbots/catalog`, pero no hay `@nestjs/swagger` en el proyecto y no se
  añadió.
- **`resumir` de IA devuelve vacío**: el puerto solo recibe el id de la
  conversación.
- **El rebinding de DNS no está cerrado del todo.**
- **WhatsApp sigue sobre transporte falso.**

### Referencia del bloque 3d completo

**Bloque 3d — consumidor y reconciliador.** Registrar el consumidor de la cola
`takto.flowbot` en el arranque del worker, despachar los eventos de outbox
`flowbot.advance` y `flowbot.wake`, y añadir el reconciliador: ejecuciones con
lease vencido, esperas vencidas sin trabajo, y ejecuciones canceladas con
trabajos vivos.

Después: adaptadores reales de CRM, orquestador conectado al webhook tras
`LeadIntakeService`, handoff sobre la conversación, panel lateral, archivado
seguro, pipeline en tiempo real, API, permisos y QA.

### Referencia del bloque 3c original

**Bloque 3c — el runner.** Servicio que persiste lo que el intérprete decide:
creación idempotente de `FlowBotExecution` por `idempotencyKey`, escritura de
pasos y esperas en una transacción, bloqueo por conversación con expiración,
consumidor en el worker, reanudación por mensaje y por vencimiento, reintentos
con backoff y `NEEDS_ATTENTION`, y reconciliador de esperas vencidas sin job.

Después: adaptadores reales de CRM y WhatsApp, handoff conectado a la
conversación, panel lateral del contacto, archivado seguro, pipeline en tiempo
real, API, permisos y QA.

### Referencia del bloque 3b completo

**Bloque 3b — persistencia y cola.** Servicio que envuelve al intérprete:
selección de bots por disparador con prioridad y exclusividad, creación
idempotente de la ejecución, persistencia de pasos y esperas en una
transacción, encolado en BullMQ, reanudación por mensaje entrante y por
tiempo, bloqueo por conversación y reconciliador de esperas vencidas.

Después: adaptadores reales de CRM, nodo HTTP con SSRF en ejecución, IA
desacoplada, API y permisos, editor visual, simulador, plantillas, métricas,
seguridad, QA y despliegue.

### Lo que era el bloque 3 completo

**Bloque 3 — motor durable.** Servicio de ejecución sobre la cola y el outbox
existentes: arranque idempotente por evento, bloqueo por conversación, paso a
paso con `FlowBotExecutionStep`, esperas durables en `FlowBotWait`, reanudación
por mensaje entrante y por tiempo, reintentos con backoff y tope de pasos.
Adaptadores de efectos (WhatsApp, CRM) con implementación falsa para pruebas y
simulador.

### Comando seguro para reanudar

```bash
cd /c/Users/Usuario/Desktop/Tehus_Rattan
git checkout feature/takto-flowbot-visual-builder
git pull --ff-only origin feature/takto-flowbot-visual-builder
cd apps/backend && npx jest && npx tsc --noEmit -p tsconfig.json
npm run test:e2e -- --runInBand

# Y lo que ninguna suite puede responder: comprobar que el motor se mueve solo.
docker compose up -d redis
cd apps/backend && npm run build
node scripts/flowbot-demo-autonoma.mjs   # el motor se mueve solo
node scripts/flowbot-demo-admin.mjs      # la API administra sin JSON a mano
```

La demostración recorre la vertical entera —incluido el handoff— por el mismo
webhook que usaría un mensaje real. Si algo se rompe, se rompe ahí antes que
en producción.

### Reglas que no se negocian

- Nunca `db push` ni `migrate dev` en staging; solo `prisma migrate deploy`.
- Nunca `docker compose down -v`; nunca recrear postgres, caddy ni takto-web.
- Siempre `--env-file .env.staging` al construir para staging.
- **No filtrar los avisos de Docker Compose**: filtrarlos fue lo que dejó pasar
  un frontend sin URL de API.
- Conservar el guard de `NEXT_PUBLIC_API_URL` y la comprobación del bundle real
  en el smoke test.
- Todos los bots quedan `DRAFT` o `PAUSED` tras cualquier despliegue.
- No enviar WhatsApp real, correos ni notificaciones en pruebas ni despliegues.
