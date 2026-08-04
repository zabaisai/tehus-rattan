# Activar WhatsApp real en FlowBot

> **Nada de este documento está aplicado.** Hoy FlowBot no manda ni un mensaje:
> el transporte real existe, está probado y está bloqueado. Encenderlo requiere
> una autorización aparte de la que produjo este candidato.

Este runbook cubre tres cosas: cómo se enciende **una empresa, un número y un
destinatario de prueba**, cómo se para todo en segundos, y cómo se vuelve al
transporte falso.

---

## 1. Los tres modos

| Modo | Qué hace | Cuándo |
| --- | --- | --- |
| `falso` | Devuelve un identificador inventado. Nada sale del proceso. | Por defecto, y hasta que alguien encienda lo demás a mano. |
| `dry-run` | Ejecuta **todo** —resolver el número, ventana de 24 h, plantilla, idempotencia— y construye la petición exacta que se habría mandado, sin abrir la conexión. | El paso previo obligatorio a encender de verdad. |
| `real` | Sale hacia Meta. | Solo tras un dry-run limpio y con autorización explícita. |

La decisión se toma **envío a envío** en `decidirModo`, con el estado real del
sistema delante. No hay banderas dentro de los nodos.

---

## 2. Los trece guardarraíles

Para que salga **un** mensaje real tienen que cumplirse **todos a la vez**:

1. bandera global de envío real encendida;
2. interruptor de emergencia apagado;
3. empresa en la lista de permitidas;
4. número remitente en la lista de permitidos;
5. destinatario en la lista de pruebas;
6. integración de WhatsApp conectada;
7. bot con versión publicada;
8. bot activo;
9. la versión de la ejecución es la publicada **ahora**;
10. ejecución viva (no terminada, cancelada ni pausada);
11. sin handoff humano activo en esa conversación;
12. clave de idempotencia presente;
13. dentro de la ventana de 24 h **o** plantilla verificada como aprobada.

Más el límite de frecuencia y el circuit breaker.

Si falla cualquiera, **no se envía** y la decisión explica cuáles fallaron —
todos, no solo el primero.

---

## 3. Variables nuevas

Todas tienen valor seguro por defecto. **La ausencia de configuración equivale
a bloqueado**: las listas vacías significan *ninguno*, no *todos*.

| Variable | Por defecto | Qué hace |
| --- | --- | --- |
| `FLOWBOT_REAL_WHATSAPP_ENABLED` | `false` | Permite llegar a `dry-run` o `real`. Solo se enciende con el texto exacto `true`. |
| `FLOWBOT_WHATSAPP_DRY_RUN` | `true` | Mientras esté puesta, se prepara el envío y no sale. Solo se quita con el texto exacto `false`. |
| `FLOWBOT_WHATSAPP_COMPANY_ALLOWLIST` | vacía | Ids de empresa separados por coma. |
| `FLOWBOT_WHATSAPP_PHONE_ALLOWLIST` | vacía | `phoneNumberId` remitentes separados por coma. |
| `FLOWBOT_WHATSAPP_RECIPIENT_ALLOWLIST` | vacía | Destinatarios de prueba. Se comparan por dígitos, así que el formato da igual. |
| `WHATSAPP_GRAPH_BASE_URL` | sin poner | **Solo para pruebas.** Únicamente admite `localhost`/`127.0.0.1`; con cualquier otro destino se ignora y se usa Meta. En producción debe estar sin poner. |

Ejemplo con valores **ficticios** — nunca poner identificadores reales en el
repositorio ni en un ticket:

```
FLOWBOT_REAL_WHATSAPP_ENABLED=true
FLOWBOT_WHATSAPP_DRY_RUN=true
FLOWBOT_WHATSAPP_COMPANY_ALLOWLIST=cmp_ejemplo_piloto
FLOWBOT_WHATSAPP_PHONE_ALLOWLIST=000000000000000
FLOWBOT_WHATSAPP_RECIPIENT_ALLOWLIST=+00 000 000 0000
```

---

## 4. Encender una empresa, un número y un destinatario

**Antes de empezar:** hace falta autorización explícita. Este procedimiento
hace que un bot escriba a un teléfono real.

### Paso 1 — registrar y verificar las plantillas

Una plantilla que no esté en `whatsapp_templates` con `status = APPROVED`
**queda bloqueada**. No se asume aprobada: mandar plantillas que Meta rechaza
degrada la calidad del número, y eso tarda semanas en revertirse.

Hay que registrar, por cada plantilla que use el bot: nombre exacto, idioma,
número de parámetros del cuerpo y el número al que pertenece. Una plantilla
aprobada en un WABA **no existe** en otro.

### Paso 2 — dry-run

```
FLOWBOT_REAL_WHATSAPP_ENABLED=true
FLOWBOT_WHATSAPP_DRY_RUN=true          # sigue puesto
FLOWBOT_WHATSAPP_COMPANY_ALLOWLIST=<id de la empresa piloto>
FLOWBOT_WHATSAPP_PHONE_ALLOWLIST=<phoneNumberId del número piloto>
FLOWBOT_WHATSAPP_RECIPIENT_ALLOWLIST=<teléfono de prueba propio>
```

Reiniciar backend y worker. En la pantalla de FlowBot debe leerse:

> **Modo de prueba: FlowBot no está enviando mensajes reales**

Provocar una conversación con el número de prueba y comprobar en los registros
las líneas `[DRY-RUN] no se envía nada a Meta`. Revisar que el número
remitente, el destinatario enmascarado y el tipo de mensaje son los esperados.

**Si el dry-run no produce esas líneas, no se sigue.** Significa que algún
guardarraíl está bloqueando y hay que averiguar cuál antes de encender nada.

### Paso 3 — real, solo para ese destinatario

```
FLOWBOT_WHATSAPP_DRY_RUN=false
```

Reiniciar. La pantalla debe leerse:

> **FlowBot está enviando mensajes reales**

Mandar **un** mensaje desde el teléfono de prueba y comprobar que llega. A
partir de aquí, cualquier otro destinatario sigue bloqueado por la lista.

### Paso 4 — ampliar

Ampliar **de uno en uno** y comprobando entre medias. El orden importa: primero
más destinatarios en la misma empresa, luego más números, y solo al final más
empresas.

---

## 5. Parar todo — interruptor de emergencia

**Es lo primero que hay que hacer si algo va mal.** No requiere recompilar, ni
desplegar, ni reiniciar: se cambia una fila y el worker la lee en el siguiente
envío.

```
POST /api/flowbots/kill-switch
{ "activo": true, "motivo": "por qué se está parando" }
```

Requiere `SUPER_ADMIN`. Como toda la API de FlowBot, un `SUPER_ADMIN` de
plataforma necesita **una sesión de soporte abierta** (cabecera
`x-support-session-id`). Conviene tenerlo ensayado: abrir la sesión son unos
segundos, pero no es el momento de descubrirlo.

Qué hace y qué **no**:

- ✅ para los envíos de **todos** los bots, de todas las empresas;
- ✅ deja auditoría con quién y por qué;
- ✅ se ve en la pantalla de FlowBot con el motivo;
- ❌ **no** para los mensajes que escribe una persona desde el CRM — la empresa
  sigue pudiendo hablar con sus clientes;
- ❌ **no** cancela ni borra ejecuciones;
- ❌ **no** borra trabajos de la cola.

Es **fail-closed**: si la consulta falla, se asume activo.

Para levantarlo:

```
POST /api/flowbots/kill-switch
{ "activo": false }
```

---

## 6. Volver inmediatamente al transporte falso

Tres opciones, de más rápida a más limpia:

| Cuánto tarda | Cómo | Efecto |
| --- | --- | --- |
| segundos | Interruptor de emergencia | Nada sale. Las ejecuciones siguen vivas y quedan explicadas. |
| un reinicio | `FLOWBOT_WHATSAPP_DRY_RUN=true` | Se sigue preparando todo, no sale nada. Útil para diagnosticar. |
| un reinicio | `FLOWBOT_REAL_WHATSAPP_ENABLED=false` | Vuelta completa al transporte falso, el estado por defecto. |

Vaciar las listas de permitidos tiene el mismo efecto que la última: lista
vacía significa *ninguno*.

---

## 7. Checklist de emergencia

Cuando algo esté saliendo mal y no se sepa aún qué:

1. **Parar.** `POST /api/flowbots/kill-switch { "activo": true, "motivo": ... }`.
2. **Comprobar que paró.** La pantalla de FlowBot debe decir «Envíos parados».
3. **Mirar qué salió.** Las ejecuciones afectadas quedan con su motivo; los
   mensajes fallidos llevan una frase legible, no un código.
4. **No reintentar a ciegas.** Un resultado ambiguo —timeout, conexión
   cortada— *no* se reintenta solo, a propósito: no se sabe si el mensaje
   salió. Comprobarlo en WhatsApp antes de decidir.
5. **Si hay dudas sobre el número:** pausar los bots afectados (`PAUSED`) —eso
   además impide que arranquen ejecuciones nuevas.
6. **Volver al falso** con `FLOWBOT_REAL_WHATSAPP_ENABLED=false` antes de
   levantar el interruptor.
7. **Escribir qué pasó** en el motivo del interruptor antes de levantarlo: es
   lo que va a leer quien mire el registro dentro de un mes.

---

## 8. Rollback del despliegue

Este candidato **no está desplegado**. Si llegara a desplegarse y hubiera que
revertirlo:

- **Código:** volver a la revisión anterior. No hay estado que migrar de vuelta.
- **Migraciones:** las diez de esta rama son **aditivas** —tablas y columnas
  nuevas, ningún `DROP`, ningún cambio de tipo—. El código anterior las ignora,
  así que **no hace falta revertirlas**. Revertir el enum `MANAGER` exigiría
  recrear el tipo; se deja y se ignora.
- **Datos:** nada que restaurar. Las tablas nuevas (`flowbot_kill_switch`,
  `whatsapp_templates`) quedan huérfanas y vacías, sin efecto.
- **WhatsApp:** al no haberse activado nunca, no hay mensajes que deshacer.

---

## 9. Lo que este runbook NO cubre

- **Verificar plantillas contra Meta.** La interfaz existe (`ProveedorPlantillas`)
  y hoy solo está el proveedor falso, que devuelve «no sé». El registro es
  manual y deliberadamente conservador.
- **Límite de frecuencia y circuit breaker reales.** Los guardarraíles existen
  y se evalúan, pero hoy reciben siempre «dentro del límite» y «circuito sano»:
  no hay contador ni detector implementados. Antes de subir el volumen de la
  prueba hay que cerrarlos.
- **Revocar el token del lado de Meta** al desconectar un número.
