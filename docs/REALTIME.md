# Tiempo real (WebSockets)

Canal en vivo para que la bandeja, el tablero, las tareas y los avisos se
actualicen solos. Sustituye al polling de 5 s como camino principal, **sin
eliminarlo**: sigue ahí, más lento, como red de seguridad.

## Lo que hay que entender primero

**El `companyId` sale siempre del token.** Nunca de un parámetro del cliente.
Si se aceptara uno del handshake, cualquiera escucharía las conversaciones de
otra empresa cambiando un valor en el navegador. Es la misma regla que ya rige
la API REST, y es la única propiedad de este subsistema que no admite matices.

## Piezas

| Fichero | Papel |
|---|---|
| `common/realtime/realtime.rooms.ts` | Nombres de sala y de evento (versionados) |
| `common/realtime/realtime.auth.ts` | Valida el JWT del handshake y devuelve la identidad |
| `common/realtime/realtime.gateway.ts` | Namespace `/realtime`, middleware, salas, suscripciones |
| `common/realtime/realtime.transport.ts` | Elige por dónde emitir según el proceso |
| `common/realtime/realtime.redis.ts` | Adaptador de Redis entre procesos |
| `common/realtime/realtime.emitter.ts` | API de emisión para los servicios de negocio |
| `frontend/src/lib/realtime.ts` | Socket del navegador (token en `auth`, no en la URL) |
| `frontend/src/lib/use-realtime.ts` | Traduce eventos a invalidaciones de React Query |

## Autenticación: en el handshake, no al conectar

El gateway instala un middleware en `afterInit`. Un token inválido se rechaza
con `next(new Error('unauthorized'))`, así que el cliente recibe
`connect_error` y **nunca llega a estar conectado**.

Rechazar más tarde, dentro de `handleConnection`, también cerraría el socket
—pero el cliente habría visto antes un `connect`, y durante esos milisegundos
se creería en vivo. El respaldo por polling decide su ritmo justo a partir de
ese estado, así que la diferencia no es cosmética.

Un SUPER_ADMIN de plataforma (`companyId` null) **no obtiene canal**: no
pertenece a ninguna empresa. Ver conversaciones exige una sesión de soporte
activa y auditada, que es otro camino y deliberadamente más lento.

## Salas

```
company:<companyId>                          todos los conectados de la empresa
user:<userId>                                un usuario, en todas sus pestañas
company:<companyId>:conversation:<convId>    quienes tienen ese hilo abierto
```

Las dos primeras se unen solas al conectar, derivadas del token. La tercera va
bajo demanda (`conversation:subscribe`) y **se comprueba contra la base**
filtrando por el `companyId` del token: un id de otra empresa no encuentra
fila y la suscripción se rechaza.

El nombre de la sala de conversación incluye la empresa a propósito. Es una
segunda barrera: aunque alguien lograra colarse con un id ajeno, la sala a la
que entraría no sería aquella a la que emite la empresa dueña.

## Eventos

Versionados en el **nombre**, no en el payload: un cliente antiguo simplemente
no escucha los nuevos, en vez de recibir una forma que no sabe interpretar.

| Evento | Sala | Para qué |
|---|---|---|
| `v1:message.created` | conversación | Mensaje nuevo en el hilo abierto |
| `v1:message.status_changed` | conversación | Entregado / leído / fallido |
| `v1:conversation.updated` | empresa | Reordenar la lista de conversaciones |
| `v1:lead.updated` | empresa | Mover la tarjeta en el tablero |
| `v1:task.updated` | empresa + responsable | Tarea creada, editada o completada |
| `v1:notification.created` | usuario | Campana de avisos |

**Los payloads no llevan contenido.** Solo identificadores: el evento avisa de
que algo cambió y el cliente lo recarga por la API, que aplica sus permisos.
Mandar el cuerpo del mensaje por el canal duplicaría la superficie de
exposición sin ahorrar prácticamente nada.

## El worker es otro proceso

El worker de la cola arranca con `createApplicationContext`: **no tiene
servidor HTTP**. Los clientes están conectados al backend. Sin puente, cuando
el worker termina de procesar un mensaje entrante y emite, ese evento no llega
a nadie.

- **Backend**: `main.ts` monta `RedisIoAdapter` antes de escuchar.
- **Worker**: `RealtimeTransport` crea un servidor de socket.io sin HTTP con
  el adaptador de Redis. Solo publica; nadie se conecta a él.

Es también lo que permitirá varias réplicas de backend sin que un cliente deje
de recibir lo suyo por estar conectado a la réplica equivocada.

Si Redis no está, ambos procesos siguen funcionando: se pierde la propagación
entre procesos, no el producto.

## El polling se queda

| Estado | Refresco |
|---|---|
| Canal abierto | 30 s |
| Sin canal | 5 s |

Quitarlo del todo convertiría el WebSocket en un punto único de fallo, y su
caída se manifestaría como "el CRM no actualiza" — de los síntomas más caros
de diagnosticar. Tras cada reconexión el cliente además recarga lo visible,
porque durante el corte pudieron pasar cosas.

Las salas viven en el servidor y mueren con el socket, así que el cliente
**reenvía la suscripción al hilo en cada `connect`**.

## Emisión best-effort

Un fallo al emitir nunca rompe la operación de negocio. Que un asesor no vea
la burbuja aparecer sola es una molestia; que el mensaje no se guarde es un
incidente. Por eso `RealtimeEmitter` traga sus propios errores y registra solo
el tipo, sin detalle que pueda arrastrar PII.

Las emisiones van siempre **después del commit**. Avisar dentro de la
transacción haría que el cliente recargara y no encontrara todavía el cambio.

## Operación

- **CORS**: mismo allowlist exacto que la API (`FRONTEND_URL` /
  `CSRF_ALLOWED_ORIGINS`). Un gateway abierto a cualquier origen sería una vía
  de exfiltración desde una página de terceros.
- **CSP**: `connect-src` incluye el origen `wss://` del mismo host de la API.
- **Caddy**: `reverse_proxy` gestiona el upgrade a WebSocket sin configuración
  extra.
- **Heartbeat**: ping cada 25 s, se da por muerto a los 60 s. Una caída de red
  se detecta en menos de un minuto sin castigar a móviles con cobertura
  intermitente.

## Pruebas

- 47 unitarias (`realtime.auth.spec`, `realtime.gateway.spec`,
  `realtime.emitter.spec`).
- 14 e2e con **sockets reales y dos empresas simultáneas**
  (`test/realtime.e2e-spec.ts`): un evento de A no llega a B; un cliente de B
  no puede suscribirse a un hilo de A; mandar el `companyId` ajeno en el
  handshake no cambia de empresa; una notificación no llega al compañero de
  empresa; el cuerpo del mensaje no viaja por el canal.
