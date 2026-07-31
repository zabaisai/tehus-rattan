# TAKTO — Informe de preparación para el despliegue

Rama `feature/takto-crm-platform-overhaul`. **Nada desplegado, nada fusionado
a `main`.** Este documento es lo que hay que leer antes de decidir el
despliegue único final.

## 1. Qué cambia para quien usa el CRM

| Antes | Ahora |
|---|---|
| WhatsApp funcionaba y el tablero seguía vacío | El mensaje entrante crea la oportunidad y la asigna |
| Bandeja plana, sin filtros ni no-leídos | Filtros, búsqueda, contadores, selección múltiple y acciones en lote |
| Nadie sabía si una automatización había fallado | Historial por ejecución, con el resultado de cada acción y la versión que corrió |
| Sin chatbot | Chatbot v1 con borrador/publicado, versiones y entrega a una persona |
| Cotización impresa desde el navegador | PDF generado en el servidor, idéntico siempre |
| Sin política de retención | Retención configurable, exportación y solicitud de eliminación |
| Identidad heredada | Sistema visual TAKTO aplicado al producto |

**El agujero que se cierra.** `lead.create` solo se invocaba desde el
endpoint manual: el webhook nunca lo llamaba. Por eso WhatsApp «funcionaba»
—el mensaje se guardaba, la conversación existía— y el tablero seguía vacío,
con 4 de 4 conversaciones fuera del pipeline.

## 2. Estado de verificación

| Comprobación | Resultado |
|---|---|
| Backend unitarias | **1238** verdes / 90 suites |
| Backend E2E (base real) | **388** verdes / 35 suites |
| Frontend | **229** verdes / 35 suites |
| Typecheck (incluye specs) | 0 errores en ambos proyectos |
| Lint | limpio |
| Build | limpio |
| CI del SHA exacto | verde, `head_sha` verificado en cada commit |

### QA visual y accesibilidad

36 capturas: 6 pantallas × 6 viewports (320, 390, 430, 768, 1280, 1920), con
**sesión iniciada real** vía CDP. Cero desbordes horizontales, cero controles
sin nombre accesible, cero campos sin etiqueta, cero imágenes sin `alt`.

Dos defectos los encontró **mirar las capturas**, no el umbral automático:
las pestañas de la bandeja salían recortadas (el desborde era interno al
contenedor, así que la medición de página daba cero) y un `<select>` de
cotizaciones no tenía etiqueta.

### Carga

20 concurrentes, por debajo del límite de tasa:

| Ruta | p50 | p95 |
|---|---|---|
| Bandeja con filtros y no leídos | 40 ms | 50 ms |
| Contadores de bandeja | 38 ms | 42 ms |
| Notificaciones | 29 ms | 43 ms |
| Salud agregada | 22 ms | 25 ms |

La primera pasada agotó el límite de 300 peticiones/minuto por IP y midió el
camino del 429 — el limitador funciona, y quedó comprobado de paso.

### Ruta de actualización de la base

Verificada con `scripts/verificar-ruta-de-migracion.sh`: base temporal llevada
al estado **exacto de staging** (21 migraciones), datos insertados, y solo
entonces aplicadas las **18 restantes**. Los datos siguen ahí.

Esto no es lo mismo que lo que hace el CI. El CI aplica desde cero, sobre
tablas vacías: una migración que añada una columna `NOT NULL` sin default
pasaría ahí y fallaría en el despliegue.

### Degradación y recuperación

Comprobado con la configuración de staging (cola activada) y Redis caído:

```
status global : degraded      ← nunca "ok"
  database   up
  queue      down       Error
  worker     unknown    sin-latido-registrado
  realtime   down       redis-inalcanzable  (fallback: polling)
HTTP 200
```

`degraded` responde **200 a propósito**: el CRM sigue atendiendo, y un 503
haría que el orquestador reiniciara una instancia sana. Quien monitorice debe
leer el campo `status`. `/health/ready` sigue mirando solo la base.

## 3. Riesgos del despliegue

| Riesgo | Mitigación |
|---|---|
| **18 migraciones de golpe** | Ruta verificada sobre el estado de staging con datos. Todas aditivas salvo índices parciales; ninguna borra columnas |
| **Índices parciales** | Viven en SQL dentro de su migración. Si `prisma migrate dev` propone eliminarlos, **rechazar** |
| **Redis y worker son nuevos en staging** | El CRM funciona sin ellos, degradado y visible en `/health/status`. Pero el outbox no se drena: no dejar staging así |
| **`Conversation.stage` sigue en dual-write** | No retirar la columna en este despliegue. Es una migración aparte, después de rodaje |
| **El chatbot responde a clientes reales** | Nace inactivo. Publicar no activa; activar es una acción aparte y explícita |
| **La purga de retención borra** | Desactivada por defecto y exige dos señales. Ninguna empresa tiene política configurada |

## 4. Lo que este trabajo NO incluye

Dicho explícitamente para que no se descubra después:

- **QA E2E contra staging desplegado.** Imposible sin desplegar; es el
  siguiente paso, no una omisión.
- **Importación del historial previo de WhatsApp** (decisión 10): no se
  promete importación automática.
- **Tema oscuro.** Se retiró el `prefers-color-scheme` heredado, que solo
  invertía el fondo del `body`.
- **Aprobación y ejecución de la eliminación de datos.** La solicitud se
  registra y queda pendiente; aprobarla y ejecutarla es trabajo posterior y
  deliberadamente manual.
- **Rotación de la clave de cifrado de tokens de WhatsApp.** Pendiente.
- **Constructor de automatizaciones con ramificaciones.** El editor es una
  lista ordenada porque el motor ejecuta una lista ordenada.

## 5. Deuda registrada

- La escala `stone` es un puente hacia `neutral-*` (929 usos). Funciona y está
  documentado; el barrido final queda pendiente.
- `npm run lint` del backend lleva `--fix`, así que reformatea al ejecutarlo.
  Los commits de formato se separan a propósito.
- El `.tar.gz` de uploads queda `root:root` y el `chmod` del script de backup
  falla.

## 6. Secuencia recomendada de despliegue

1. Fusionar a `main` y esperar CI **verde del SHA exacto**.
2. Backup verificado de la base de staging **antes** de migrar.
3. Levantar Redis y el worker **antes** que el backend: si no, el primer
   arranque reporta `degraded` y confunde la verificación.
4. `prisma migrate deploy`.
5. Desplegar backend, worker y frontend. `up -d --no-deps backend frontend`
   **ya no es suficiente**: hay que incluir `redis` y `worker`.
6. Comprobar `/api/health/status` → debe decir `ok`, no solo responder 200.
7. QA E2E sobre staging: enviar un WhatsApp real y comprobar que aparece la
   oportunidad en el tablero.

El detalle operativo está en `docs/DEPLOYMENT_RUNBOOK.md`.
