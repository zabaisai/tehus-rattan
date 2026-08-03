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

### Chatbot v1 existente — punto de partida a EVOLUCIONAR

Modelos ya en el esquema: `ChatbotFlow` (DRAFT/PUBLISHED, `draftNodes` JSON,
`publishedVersion`, `triggerKeywords`), `ChatbotFlowVersion` (versiones
inmutables) y `ChatbotSession` (ejecución: `currentNode`, `context`, `steps`).

Motor en `modules/chatbot/`: 5 tipos de nodo (`message`, `question`, `menu`,
`handoff`, `end`), flujo lineal con `next`, validador `validarFlujo`,
`elegirOpcion`, `interpolar`, tope `MAXIMO_PASOS = 30`, ejecución **síncrona**
dentro del webhook.

**Decisión de arquitectura:** FlowBot **evoluciona** estos modelos; no se crea
un segundo motor ni modelos paralelos. Los nombres `Chatbot*` se conservan
donde ya existen para no romper datos ni migraciones aplicadas, y lo nuevo se
añade de forma aditiva.

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

## Próximo paso

Modelo de datos de FlowBot: migración **aditiva** que amplía el chatbot v1 con
disparadores, ejecuciones durables, esperas y métricas, conservando lo
existente. Revisar el SQL a mano antes de aplicarlo y documentar el rollback.

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
