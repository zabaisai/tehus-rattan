# Historial previo de WhatsApp: qué se puede y qué no

Este documento existe para que nadie prometa a un cliente algo que la API no
permite. La pregunta «¿el CRM traerá las conversaciones que ya tengo?» tiene
una respuesta concreta y con límites duros.

## El límite que no se puede sortear

**La Cloud API no expone ningún endpoint para pedir mensajes pasados.** No hay
una llamada del tipo «dame las conversaciones de este número». Los mensajes
llegan **solo por webhook**, y solo desde el momento en que la aplicación está
suscrita a la WABA.

Esto no es una limitación del CRM ni algo que se pueda rodear con más trabajo:
Meta simplemente no sirve ese dato. Cualquier función que prometiera «importar
tus conversaciones anteriores» desde la API sería falsa.

**Consecuencia práctica:** para un número que se conecta por Embedded Signup
normal, el historial anterior a la conexión **no existe dentro del CRM**, y no
va a aparecer más tarde.

## La única vía por la que Meta sí entrega historial

Cuando un número que **venía usándose en la app de WhatsApp Business** se
conecta a la Cloud API en modo **coexistencia**, Meta envía por webhook —una
sola vez, en lotes, poco después de completar la conexión— los chats
recientes de ese número.

El CRM lo procesa en `HistorySyncService`. Dos precisiones importantes:

- **El alcance lo fija Meta, no el CRM.** Cuántos chats y cuánto tiempo atrás
  se entregan es decisión suya y puede cambiar. El CRM importa lo que llegue.
- **Ocurre una sola vez, al conectar.** No es una sincronización continua ni
  se puede pedir de nuevo. Si se pierde, se pierde.

El handler está escrito **defensivamente**: reconoce varias formas de payload
y descarta lo que no entiende sin romper el webhook — por ese mismo webhook
llegan los mensajes en vivo, y tumbarlo por un formato inesperado sería peor
que no importar el historial.

> **No verificado contra la API en vivo.** La implementación se probó con
> payloads sintéticos que reproducen la forma documentada. Antes de anunciar
> esta función a un cliente, conviene comprobarla con una conexión real de
> coexistencia y ajustar el parser si la forma difiere. Está construido para
> que ese ajuste sea de una función.

## La vía que siempre funciona: importación CSV

Para todo lo demás —migrar desde otro CRM, un export manual, conversaciones
de un número conectado hace tiempo— el camino es la importación controlada por
CSV, en **Ajustes → WhatsApp → Importar historial**.

Columnas obligatorias:

| Columna | Formato | Notas |
|---|---|---|
| `telefono` | E.164 o local | Se normaliza igual que el resto del CRM |
| `fecha` | ISO 8601 | `2026-03-01T10:15:00Z`. Una fecha futura se rechaza |
| `direccion` | `INBOUND` / `OUTBOUND` | Quién escribió |
| `texto` | libre | Admite comas y comillas si el campo va entrecomillado |
| `referencia` | libre, única | **Obligatoria**: es lo que evita duplicar al reimportar |

La `referencia` merece explicación: se convierte en el identificador único del
mensaje. Sin ella, un segundo intento tras un fallo a mitad dejaría el hilo
con todo duplicado. Con ella, reimportar el mismo fichero es inofensivo.

Hay un análisis previo (`preview`) que valida el fichero **sin importar nada**.
Conviene usarlo: descubrir a mitad que el formato de fecha era otro deja el
hilo con la mitad de las conversaciones.

Tope: 20.000 filas por fichero.

## Lo que NUNCA dispara el historial importado

Esto es lo más importante de toda la función.

Un mensaje importado —venga de coexistencia o de CSV— **no ejecuta
automatizaciones, no despierta al chatbot, no crea oportunidades, no cuenta
para el SLA y no genera notificaciones**.

El motivo es concreto: sin esa regla, importar seis meses de historial haría
que las automatizaciones respondieran a cada mensaje antiguo, enviando cientos
de WhatsApp reales a clientes por conversaciones que terminaron hace medio
año. Sería un incidente con los clientes de la empresa, no un fallo interno.

La garantía se sostiene en el campo `Message.source`:

| Valor | Origen | ¿Dispara efectos? |
|---|---|---|
| `LIVE` | Webhook en tiempo real | Sí |
| `HISTORY_SYNC` | Coexistencia, al conectar | **No** |
| `CSV_IMPORT` | Importación manual | **No** |

Está fijado en `test/whatsapp-history.e2e-spec.ts`.

## Resumen para responder a un cliente

> «Desde el momento en que conectamos tu número, todas las conversaciones
> quedan en el CRM. Las anteriores dependen de cómo venías usando WhatsApp: si
> usabas la app de WhatsApp Business y conectamos en modo coexistencia, Meta
> nos envía los chats recientes automáticamente. Si no, podemos importar el
> historial que tengas exportado en un fichero. Lo que no existe es una forma
> de pedirle a Meta las conversaciones antiguas de un número ya conectado.»
