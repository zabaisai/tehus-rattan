# Roadmap del CRM — Tehus-first

> Reenfoque del roadmap comercial — 2026-07-09, sobre `main @ 6b23140`.
>
> Este documento reemplaza al roadmap SaaS-first del mismo día como guía
> de trabajo activa. Describe lo que el código hace hoy, verificado
> archivo por archivo, priorizado desde una pregunta distinta a la del
> documento anterior: no "¿qué tan vendible es esto a otras empresas?",
> sino "¿qué le falta a Tehus Rattan Medellín para operar su propia venta
> real con este sistema, mañana?".

## 1. Resumen ejecutivo

El objetivo cambió de orden, no de fondo. Antes se pensaba cerrar el CRM
como producto comercializable/multiempresa primero. Ahora la prioridad es
terminar el CRM como herramienta operativa **interna** de Tehus Rattan
Medellín, probarlo en operación real, y solo después retomar la
comercialización — con datos reales de haberlo usado, no con supuestos.

Nada de lo ya construido se descarta. El aislamiento multiempresa
(`companyId` + `BusinessTenantGuard`), el rol `SUPER_ADMIN` de plataforma,
la auditoría (`AuditLog`) y el modo soporte siguen siendo la base técnica
del sistema — simplemente dejan de ser lo primero que se termina, porque
Tehus no los necesita para vender mañana. Lo que sí es indispensable ya
está parcialmente resuelto: el bloque de Leads (crear, ver detalle,
editar, cambiar etapa, marcar ganado/perdido) se completó recientemente y
es hoy el activo más sólido del sistema para una operación de ventas real
de una sola empresa.

Quedan dos huecos reales que impiden que el flujo completo de Tehus
funcione de punta a punta: **las tareas no se pueden vincular a un
lead/contacto/responsable desde la interfaz** (el paso de "seguimiento"
no es real todavía), y **las cotizaciones no existen** (el ciclo se corta
justo antes de cerrar la venta). Todo lo demás — multi-pipeline,
automatizaciones ampliadas, WhatsApp con plantillas — es mejora, no
bloqueo, para que Tehus empiece a operar.

## 2. Flujo comercial objetivo de Tehus

```
WhatsApp/contacto → lead → asesor → seguimiento → cotización → venta
```

Estado de cada paso hoy:

| Paso | Estado |
|---|---|
| WhatsApp / contacto | ✅ funciona |
| Lead | ✅ funciona |
| Asesor asignado | ✅ funciona |
| Seguimiento | ⚠️ falta interfaz |
| Cotización | ❌ no existe |
| Venta (marcar ganado) | ✅ funciona |

Cuatro de los seis pasos ya existen y funcionan. Los dos huecos
(seguimiento y cotización) son exactamente los que ordenan el resto de
este roadmap: no tiene sentido construir cotizaciones sin poder primero
decir qué productos quiere un lead, y no tiene sentido pedirle a Tehus
que use el sistema para seguimiento real si las tareas no se pueden
vincular a un lead.

## 3. Qué ya funciona

- **Base multiempresa**: aislamiento por `companyId` en todos los
  módulos de negocio, vía `BusinessTenantGuard` y filtrado explícito en
  cada consulta de Prisma.
- **SUPER_ADMIN / Plataforma**: gestión de empresas, creación de
  SUPER_ADMIN por script, guard dedicado (`PlatformGuard`).
- **Auditoría**: `AuditLog` para acciones de plataforma y modo soporte
  (ver limitación en la sección 4).
- **Modo soporte**: sesiones de soporte auditadas con acceso de solo
  lectura a conversaciones de una empresa, documentado en
  [`SUPPORT_MODE.md`](./SUPPORT_MODE.md).
- **Leads** — completado recientemente, con pruebas y el bug de borrado
  ya corregido:
  - crear lead
  - abrir detalle
  - editar (título, valor, fecha de cierre esperada, responsable)
  - cambiar etapa
  - marcar ganado / marcar perdido con motivo
- **Pipeline base**: un pipeline con etapas personalizadas por color y
  orden es suficiente para operar; kanban con drag-and-drop funcional.
- **Contactos**: alta manual o automática por WhatsApp, edición y
  borrado.
- **Conversaciones base**: envío y recepción de WhatsApp en dos vías,
  hilo de mensajes, pausa/reanudación del bot.
- **Tareas base**: CRUD, filtro de vencidas, atajo de completar — el
  backend ya acepta vincularlas a lead/contacto/responsable (ver hueco
  en la sección 4).
- **Dashboard gerencial**: ya existe y funciona — KPIs (leads del mes,
  valor abierto/ganado, tasa de conversión, tareas vencidas,
  conversaciones pendientes), leads por etapa, rendimiento por asesor y
  motivos de pérdida, todo alimentado por datos reales.

## 4. Huecos reales para Tehus

- **Tareas/seguimientos quedan huérfanos desde el frontend**: el
  formulario de creación no tiene selector de lead, contacto ni
  responsable, aunque el backend ya lo soporta (`leadId`, `contactId`,
  `assignedTo` en `CreateTaskDto`). Toda tarea creada hoy desde la
  interfaz queda sin vincular a nada.
- **WhatsApp puede silenciar errores de envío**: si el envío falla
  contra la API de WhatsApp, el error solo se registra en el log del
  servidor — el mensaje queda marcado `SENT` igual, y el asesor nunca se
  entera de que el cliente no recibió nada. Es el único hallazgo de esta
  lista con riesgo directo de perder una venta por un fallo silencioso.
- **Productos no tienen frontend operativo**: el backend tiene CRUD
  completo con borrado suave, pero cero pantallas — hoy solo se puede
  cargar un producto llamando a la API directamente.
- **Productos no se conectan a leads**: no existe una tabla de línea que
  permita decir "este lead quiere estos productos, en esta cantidad, a
  este precio" — es la pieza estructural que falta antes de cotizaciones.
- **Cotizaciones no existen**: cero modelo, cero endpoint, cero UI, cero
  librería de generación de PDF en el stack.
- **Dashboard comercial todavía no está orientado a operación real**: los
  datos que muestra son correctos, pero `lostReason` es texto libre — sin
  una lista controlada de motivos de pérdida, el bloque correspondiente
  del dashboard se va a fragmentar en pocas semanas de uso real
  ("precio alto" vs "Precio muy alto" cuentan como cosas distintas).

## 5. Nuevo roadmap por prioridad

### Fase 1 — Operación Tehus inmediata

- Vincular tareas a lead/contacto/responsable.
- Corregir errores silenciosos de WhatsApp (marcar el mensaje como
  fallido cuando la API rechaza el envío).
- Ajustar el pipeline real de Tehus (etapas del proceso de venta real,
  no las genéricas usadas en pruebas).
- Mejorar el seguimiento comercial apoyado en lo anterior.

### Fase 2 — Productos para Tehus

- Pantalla mínima de catálogo (listar, crear, editar, borrado suave) —
  el backend ya lo soporta por completo.
- Categorías reales: salas, comedores, sillas, lámparas, accesorios.
- Precio base, medidas, materiales.
- Productos activos/inactivos.

### Fase 3 — Productos conectados a ventas

- Adjuntar productos a un lead.
- Registrar el interés del cliente (qué productos, qué cantidad).
- Preparar la base de datos que va a alimentar la cotización.

### Fase 4 — Cotizaciones MVP

- Crear cotización desde un lead.
- Ítems manuales o tomados del catálogo de productos.
- Precio, descuento, anticipo, saldo.
- Estado de la cotización (borrador / enviada / aceptada / rechazada /
  expirada).
- Versión imprimible/PDF o formato enviable por WhatsApp.

### Fase 5 — WhatsApp operativo

- Mejor control de errores (además del fix de la fase 1).
- Responder directamente desde el CRM sin salir de la conversación.
- Plantillas de mensaje.
- Pausar/reanudar el bot (ya existe, mantener y reforzar).
- Seguimientos automáticos disparados por eventos comerciales.

### Fase 6 — Dashboard gerencial

- Leads por etapa (ya existe).
- Cotizaciones enviadas (nuevo, depende de la fase 4).
- Ventas ganadas/perdidas (ya existe).
- Seguimientos vencidos (ya existe vía tareas vencidas).
- Rendimiento por asesor (ya existe).

### Fase 7 — Comercialización futura

- Onboarding SaaS.
- Planes.
- Límites.
- Billing.
- Plantillas por industria.
- Demo comercial.

## 6. Top 5 commits recomendados

1. `feat(frontend): link tasks to leads, contacts and assignees`
2. `fix(whatsapp): surface outbound send failures`
3. `feat(frontend): add products catalog page`
4. `feat(leads): attach products to leads`
5. `feat(quotes): add quotes MVP`

## 7. Primer commit recomendado

**`feat(frontend): link tasks to leads, contacts and assignees`**

- **Bajo riesgo**: es cableado de interfaz sobre un contrato que ya
  existe, sin tocar modelos ni endpoints.
- **El backend ya soporta `leadId`, `contactId` y `assignedTo`** en
  `CreateTaskDto` — no hace falta ninguna migración ni cambio de
  esquema.
- **El frontend no lo expone todavía** — `TaskModal` no tiene selector
  de lead, contacto ni responsable, y el cliente HTTP (`lib/tasks.ts`)
  ni siquiera incluye esos campos en el tipo del payload.
- **Cierra el paso "seguimiento"** del flujo comercial de Tehus — hoy es
  el único de los seis pasos que no es real en la práctica pese a tener
  soporte de backend completo.
- **Tehus lo puede usar desde mañana**: no depende de ninguna decisión
  de producto pendiente ni de ningún otro commit de esta lista.

## 8. Qué queda explícitamente fuera por ahora

- Billing.
- Planes.
- Límites de uso.
- Onboarding SaaS.
- Comercialización activa a otras empresas.
- Marketplace.
- Soporte multiindustria / plantillas por rubro.

Todo esto vuelve a la mesa después de que Tehus haya operado con el
sistema el tiempo suficiente para saber qué de todo esto realmente le
sirvió a un cliente real.
