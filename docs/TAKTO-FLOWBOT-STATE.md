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

## Próximo paso

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
