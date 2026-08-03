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

## Bloque 3d (parcial) — Consumidor y adaptador real de CRM

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

## Próximo paso

**Cerrar el 3d.** Falta, y sin ello el motor todavía no se mueve solo:

1. **Despachador de outbox** que reconozca `flowbot.advance` y `flowbot.wake`
   y los publique en BullMQ, marcando el evento **después** de encolar.
2. **Reconciliador**: leases vencidos, esperas vencidas sin trabajo, outbox
   pendiente, ejecuciones canceladas con trabajos vivos.
3. **Orquestador** conectado al webhook tras `LeadIntakeService`.
4. Pruebas de recuperación con worker reiniciado y Redis vacío.

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
```

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
