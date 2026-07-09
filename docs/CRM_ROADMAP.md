# Roadmap del CRM comercial

> Auditoría técnica de leads, pipeline, conversaciones, tareas, productos y
> cotizaciones — preparado 2026-07-09, sobre `main @ 2b2999f`.
>
> Este documento describe lo que el código hace hoy, verificado archivo por
> archivo (rutas de endpoint, modelos de Prisma, componentes de frontend y
> specs existentes), no lo que la documentación o los nombres de módulo
> sugieren. El orden del roadmap sigue dependencias técnicas reales entre
> piezas, no una estimación de impacto de negocio — esa priorización es una
> decisión pendiente (ver sección 12).

## 1. Resumen ejecutivo

El núcleo conversacional (WhatsApp) es lo más maduro del sistema: envío y
recepción reales, integración por empresa con token cifrado, y es la única
parte del producto con cobertura de pruebas seria. Leads y pipeline tienen
un backend notablemente más completo que su interfaz — historial de
etapas, transacciones, reordenamiento — pero gran parte de esa capacidad
nunca llegó al frontend. Productos es un módulo huérfano: existe como
catálogo aislado, sin una sola pantalla que lo use y sin relación con
ningún otro dato del negocio. Cotizaciones no existe: ni modelo, ni
endpoint, ni librería de PDF, ni pantalla.

Ese último punto importa para el orden del roadmap: cotizaciones no se
puede construir directamente. Necesita primero que un lead pueda tener
productos asociados con cantidad y precio — pieza que hoy tampoco existe.

**Hallazgos que condicionan todo lo demás:**

- Leads tiene backend avanzado pero frontend limitado.
- Conversations permite respuesta outbound, pero sin adjuntos, plantillas
  ni UI de seguimiento robusta.
- Tasks no tiene vista accionable de cliente para crear/editar con
  vínculo a lead/contacto/responsable.
- Products tiene CRUD backend pero no tiene frontend ni relación con
  ningún objeto de negocio.
- Quotes/Cotizaciones no existe — confirmado por búsqueda exhaustiva en
  todo el repositorio.
- Falta cobertura de pruebas dedicada en los módulos comerciales (leads,
  pipeline, conversaciones, tareas, productos, automatizaciones).
- La auditoría comercial todavía es limitada — `AuditLog` hoy solo cubre
  acciones de plataforma (soporte, SUPER_ADMIN), no acciones cotidianas
  de negocio.

## 2. Estado actual de los módulos

Leyenda: 🟢 Sólido (backend robusto y probado) · 🟡 Parcial (backend
fuerte, frontend o pruebas rezagadas) · ⚪ Aislado (funciona pero no
conecta con nada más) · 🔴 Inexistente.

| Módulo | Estado |
|---|---|
| Leads | 🟡 Backend sólido, UI incompleta |
| Pipeline | 🟡 Backend sólido, UI mínima |
| Conversaciones | 🟢 Núcleo funcional |
| Automatizaciones | 🟡 Motor real, alcance angosto |
| Tareas | 🟡 Backend completo, UI desconectada |
| Productos | ⚪ Aislado — sin UI ni relaciones |
| Cotizaciones | 🔴 Inexistente |

### Leads

**En pie**
- CRUD completo con validación de pertenencia de contacto/pipeline/etapa
  a la empresa.
- Historial de cambio de etapa (`LeadStageHistory`) escrito en la misma
  transacción que el movimiento.
- Transición a `WON` / `LOST` con `lostReason`.
- Filtros: pipeline, etapa, contacto, responsable, estado, búsqueda por
  título.

**Falta**
- Sin puntaje de lead, sin fuente/canal de origen, sin conversión
  conversación → lead.
- Cualquier agente puede borrar un lead — sin restricción de rol en
  `DELETE`.
- El frontend no tiene vista de detalle ni edición de lead; el cliente
  HTTP ni siquiera expone `createLead`, `updateLead` o `getLeadHistory`.

Pruebas dedicadas: ninguna — solo ramas de aislamiento por empresa en la
spec compartida `multitenant-ownership.spec.ts`.

### Pipeline

**En pie**
- Múltiples pipelines por empresa, etapas personalizadas con color y
  orden propio.
- Reordenar etapas en lote dentro de una transacción.
- Kanban con total de valor y conteo de leads por etapa.

**Falta**
- Cero pantallas para crear pipelines, renombrar o reordenar etapas —
  pese a que el backend ya lo soporta entero.
- Los leads `WON`/`LOST` desaparecen del tablero sin una vista alterna.
- El orden de leads dentro de una columna es solo visual — no se
  persiste server-side.

Pruebas dedicadas: ninguna.

### Conversaciones (WhatsApp)

**En pie**
- Webhook entrante y envío saliente reales contra la Graph API, token
  cifrado por empresa.
- Motor de automatización enganchado a cada mensaje entrante; pausa/
  reanudación del bot.
- Es la parte del sistema con más pruebas reales (webhook, servicio
  WhatsApp, integración, aislamiento de tenant).

**Falta**
- Solo texto plano — sin plantillas ni multimedia/adjuntos, aunque el
  modelo `MessageType` ya las contempla.
- Si el envío falla contra la API, el error se silencia y el mensaje
  queda marcado `SENT` igual.
- No procesa confirmaciones de entrega ni lectura.
- No hay UI de seguimiento robusta (sin vista de estado de conversación
  más allá del hilo, sin bandeja por responsable/prioridad).
- El módulo de Notas existe en el backend y no tiene ni una pantalla en
  el frontend.

Pruebas dedicadas: buenas en las piezas de WhatsApp/webhook; nulas en
`conversations`/`messages` propiamente.

### Tareas

**En pie**
- CRUD, filtro `overdue`, atajo `complete`.
- Vinculación opcional a lead y/o contacto, validada contra la empresa.

**Falta**
- El formulario de creación no ofrece elegir lead, contacto ni
  responsable — toda tarea creada desde la interfaz queda huérfana. No
  hay una vista de cliente accionable para crear/editar tareas
  vinculadas al flujo comercial.
- Sin recordatorios, sin tareas recurrentes, sin vínculo a conversación.
- Los filtros y la búsqueda que ya existen en el backend no están
  expuestos en la UI.

Pruebas dedicadas: ninguna.

### Productos

**En pie**
- CRUD con borrado suave (`isActive`), filtros de categoría y búsqueda.

**Falta**
- Cero pantallas — no existe ni la ruta en el frontend.
- Cero relación con leads, tareas o conversaciones: es el módulo más
  aislado del sistema, sin conexión al flujo comercial.
- Sin variantes, sin moneda explícita, sin historial de stock.
- `findById` no filtra `isActive` aunque `findAll` sí — un producto
  "borrado" sigue siendo accesible por id directo.

Pruebas dedicadas: ninguna.

### Cotizaciones

Confirmado por búsqueda exhaustiva (`quote`, `cotizaci`, `invoice`,
`presupuesto`, `pdf`) en todo el backend y frontend:

- Cero modelos (`Quote`, `Invoice`, línea de cotización) en el esquema
  de Prisma.
- Cero endpoints, cero módulo en el backend.
- Cero librería de generación de PDF en cualquiera de los dos
  `package.json`.
- Cero pantallas en el frontend.

Lo único reutilizable es `Product` y `Lead` como materia prima — pero
falta la pieza que los conecta: hoy un lead no puede tener productos
asociados con cantidad y precio.

## 3. Brechas detectadas

- **Brecha UI/API**: leads, pipeline y tareas tienen backend construido
  y probado que el frontend nunca terminó de cablear (sin vista de
  detalle de lead, sin gestión de pipelines/etapas, sin selector de
  lead/contacto/responsable al crear una tarea).
- **Fiabilidad de conversaciones**: errores de envío de WhatsApp se
  silencian en vez de marcar el mensaje como fallido; no hay
  procesamiento de confirmaciones de entrega/lectura.
- **Productos desconectado**: el catálogo no tiene ni interfaz ni
  relación con ningún otro módulo — es una isla dentro del sistema.
- **Cotizaciones inexistente**: no hay ninguna pieza construida, ni
  siquiera la relación producto-lead que la haría posible.
- **Automatizaciones limitadas al canal WhatsApp**: el motor de reglas
  es genérico en JSON pero solo reacciona a mensajes entrantes, no a
  eventos de negocio (cambio de etapa, tarea vencida, lead ganado).

## 4. Deuda transversal

Afecta a los seis módulos comerciales por igual:

- **0** módulos de negocio (leads, pipeline, conversaciones, tareas,
  productos, automatizaciones) con pruebas unitarias o e2e dedicadas —
  la única cobertura hoy es una spec compartida de aislamiento por
  empresa.
- **0** pruebas de frontend en todo el repositorio.
- **1** de siete módulos con rastro de auditoría de acciones cotidianas
  — `AuditLog` hoy solo cubre acciones de plataforma (soporte,
  SUPER_ADMIN); cambios de tarea o producto no dejan huella.
- **Sin scheduler ni cola** en el backend — cualquier recordatorio,
  tarea recurrente o vencimiento automático de cotización necesita esta
  pieza primero.

## 5. Roadmap por fases

El orden sigue dependencias técnicas reales entre piezas, no prioridad
de negocio:

1. Cerrar brecha UI/API existente
2. Pruebas y auditoría de módulos comerciales
3. Automatizaciones comerciales
4. Productos conectados al flujo comercial
5. Cotizaciones
6. Conversaciones enriquecidas

## 6. Fase 1 — Cerrar brecha UI/API existente

**Esfuerzo: bajo.** Cablear interfaz a capacidad que el backend ya tiene
construida y probada.

- Cliente de leads completo (`createLead`, `updateLead`,
  `changeLeadStatus`, `getLeadHistory`) + vista de detalle de lead.
- Formulario de tarea con selector de lead / contacto / responsable.
- Pantalla mínima de catálogo de productos (listar, crear, editar,
  borrado suave).
- Vista "Ganados / Perdidos" en el pipeline.
- Corregir el silenciamiento de errores de envío de WhatsApp — marcar
  el mensaje como fallido cuando la API falla.

**Por qué primero**: no requiere esquema nuevo ni decisiones de producto
grandes. Es fricción real que un usuario notaría hoy mismo.

## 7. Fase 2 — Pruebas y auditoría de módulos comerciales

**Esfuerzo: medio.** Cubrir con pruebas y auditoría lo que hoy no tiene
ninguna de las dos, antes de construir más encima.

- Specs unitarias y e2e para leads, pipeline, conversaciones, tareas,
  productos y automatizaciones.
- Extender el patrón de auditoría (ya usado en plataforma) a cambio de
  etapa/estado de lead, completar tarea, y cambios de producto.

**Por qué ahora**: cada fase siguiente añade superficie nueva. Construir
cotizaciones o automatizaciones ampliadas sobre esta base sin pruebas
multiplica el costo de cualquier regresión.

## 8. Fase 3 — Automatizaciones comerciales

**Esfuerzo: medio.** El motor ya es genérico en JSON; falta que
reaccione a eventos de negocio, no solo a WhatsApp.

- Nuevos disparadores: cambio de etapa de lead, lead ganado/perdido,
  tarea vencida.
- Nuevas acciones: crear tarea de seguimiento, enviar plantilla,
  notificar al responsable.
- UI mínima de administración de reglas.

**Por qué en este punto**: depende de que leads y tareas ya tengan datos
confiables y auditados — de lo contrario las reglas disparan sobre
información sin garantías.

## 9. Fase 4 — Productos conectados al flujo comercial

**Esfuerzo: medio.** La pieza estructural que falta antes de poder
hablar de cotizaciones.

- Nuevo modelo de línea: lead, producto, cantidad, precio unitario
  congelado, descuento.
- UI para adjuntar productos a un lead desde su vista de detalle
  (construida en la fase 1).

**Por qué antes de cotizaciones**: sin esta pieza, una "cotización"
sería solo un documento con precios sueltos — no trazable a un lead
real.

## 10. Fase 5 — Cotizaciones

**Esfuerzo: alto.** Convertir un lead con productos adjuntos en un
documento formal, de punta a punta.

- Modelos `Quote` + línea de cotización — borrador / enviada / aceptada
  / rechazada / expirada, numeración por empresa.
- Capa de generación de PDF — el stack no tiene ninguna librería hoy; es
  decisión de arquitectura, no solo tarea.
- Flujo: generar desde el lead → enviar → seguimiento de estado →
  aceptar convierte el lead a ganado.
- Frontend completo: constructor de cotización, vista previa/descarga,
  listado con estado.

**Por qué al final**: depende de las fases 1-4 — vista de detalle de
lead, líneas de producto, pruebas, auditoría — para no construirse
sobre una base sin cobertura.

## 11. Fase 6 — Conversaciones enriquecidas

**Esfuerzo: paralelo, no bloqueante.** Cierra huecos de fiabilidad de
WhatsApp que no bloquean el roadmap comercial, pero sí la experiencia
diaria.

- Plantillas y multimedia — el modelo ya lo soporta.
- Procesar confirmaciones de entrega y lectura.
- UI para Notas — el backend ya existe, cero frontend.
- Recordatorios de tareas — requiere el scheduler mencionado en la
  deuda transversal (sección 4).

## 12. Decisiones pendientes del negocio

Requieren una llamada de producto, no de ingeniería:

- ¿`Lead.value` pasa a calcularse desde las líneas de producto en la
  fase 4, o se mantiene como campo manual independiente del catálogo?
- ¿Qué librería de generación de PDF? Opciones típicas: control fino
  desde React (renderizado a PDF) o plantillas HTML convertidas a PDF.
  Ninguna está instalada hoy.
- ¿Las cotizaciones se envían por WhatsApp o solo se descargan? Si se
  envían como adjunto, el tipo de mensaje "documento" necesita
  implementarse antes (la fase 6 lo deja preparado).
- ¿Vale la pena una UI de automatizaciones en la fase 3, o se mantienen
  configurables solo por API mientras el volumen de reglas sea bajo?
- ¿El negocio opera en una sola moneda? El frontend hoy asume pesos
  colombianos (COP) al formatear valores de lead; ni `Product` ni
  `Lead` tienen un campo de moneda explícito.

## 13. Recomendación de siguiente paso

Empezar por la **Fase 1** (cerrar brecha UI/API existente): es el tramo
de menor esfuerzo y mayor impacto inmediato, no requiere ninguna
decisión de producto pendiente de la sección 12, y deja construida la
vista de detalle de lead que las fases 3 y 4 necesitan como base. En
paralelo, arrancar la **Fase 2** sobre los módulos que se toquen en la
Fase 1 evita acumular más deuda de pruebas mientras se avanza.
