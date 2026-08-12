# TAKTO Desktop — estado de implementación

> Documento de continuidad. Claude debe actualizarlo al final de cada incremento
> y antes de cualquier pausa larga. Nunca contiene contraseñas, tokens ni datos
> personales reales.

## Última actualización

- Fecha: 12 de agosto de 2026 · America/Bogota
- Rama: `feature/takto-brand-ui-integration`
- HEAD local: `3da29143e0ef8b798282f9d19bb0e0cab475139a` (al empezar la fase 0)
- HEAD remoto: idéntico, 0/0
- `main`: `b19217c2e4da69b251285774c1f6585cc29fb765`
- CI del SHA: ✅ Backend `success` · Frontend `success`
- Staging: no tocado
- Producción: fuera de alcance

### Preflight §2 ejecutado

| # | Comprobación | Resultado |
|---|---|---|
| 1 | Master y estado leídos completos | ✅ |
| 2 | Continuidad relacionada leída | ✅ `TAKTO-BRANDING-ESTADO-2026-08-11.md`, `DESIGN-SYSTEM.md`, `TAKTO-PAUSA-Y-REANUDACION-2026-08-10.md` |
| 3 | Raíz, rama, HEAD, remoto, árbol, `index.lock`, CI | ✅ sin lock; árbol solo con el paquete desktop sin versionar |
| 4 | Cambios del usuario preservados; `brand/` sin versionar | ✅ 0 archivos rastreados en `brand/` |
| 5 | 26 mockups y nombres coinciden con el índice | ✅ 26/26, sin faltantes ni sobrantes |
| 6 | Capacidad objetivo auditada | ✅ ver matriz |
| 7 | Pruebas base ejecutadas | ✅ ver baseline |
| 8 | Local aislado de staging/producción y sin efectos externos | ✅ ver abajo |

**Aislamiento comprobado:** `DATABASE_URL` → `localhost:5432/tehus_rattan`; frontend →
`http://localhost:3001/api`; **0** referencias remotas en `.env`; **0** variables
`SMTP_*` (correo = no-op controlado); `httpEnabled` y `aiEnabled` de Pulso a
`false` por defecto; transporte de WhatsApp en modo **`falso`** (`enviaDeVerdad:false`).

> **Ubicación del paquete.** Los documentos y mockups llegaron a `docs/` raíz.
> Se movieron a `docs/takto-desktop/`, que es la ruta que prescribe el propio
> `README.md` del paquete y la que usa el prompt de arranque.

---

## Semáforo general

| Fase | Estado | Evidencia | Bloqueador |
|---|---|---|---|
| 0. Auditoría e inventario | **HECHO** | Este documento, secciones «Inventario real» y «Baseline» | — |
| 1. Fundamentos visuales | **PARCIAL** | 12 primitivas en `components/ui/`; faltan tabla, drawer, tabs, toast, skeleton, forbidden, avatar, swatches, tooltip | — |
| 2. Shell, búsqueda y notificaciones | **EN_CURSO** | Incremento activo 2.1 | — |
| 3. Contactos, conversaciones y perfil 360 | PARCIAL | Listado, papelera, restauración y perfil existen; **fusión FALTANTE** | — |
| 4. Pipeline vertical y tareas | PARCIAL | Kanban, etapas, sugerencias con aprobación; falta pipeline **vertical** del mockup 04 | — |
| 5. Productos e importación | PARCIAL | Wizard de importación completo en API; falta catálogo visual con imágenes | — |
| 6. Cotizaciones y documentos | PARCIAL | Desglose y PDF cuadrados; falta repositorio de documentos del mockup 11 | — |
| 7. TAKTO Pulso y reglas | PARCIAL | 40 endpoints, editor visual, versiones; falta importación JSON del mockup 23 | — |
| 8. WhatsApp, empresa, equipo y datos | PARCIAL | WhatsApp y empresa existen; **equipo/invitaciones sin UI de empresa** | — |
| 9. Acceso y configuración inicial | PARCIAL | Login, recuperación y onboarding existen; faltan sesiones/dispositivos en UI | — |
| 10. QA desktop y gate de integración | PENDIENTE | — | Depende de las fases anteriores |

Estados válidos: `PENDIENTE`, `EN_CURSO`, `BLOQUEADO`, `HECHO`.

---

## Inventario real del repositorio

Verificado contra el código en este SHA, no copiado de informes anteriores.

| Capacidad | Estado | Evidencia/ruta |
|---|---|---|
| Design system y tokens | **PARCIAL** | `app/globals.css` (`@theme` completo, 3 tokens derivados documentados); 12 primitivas en `components/ui/`. Faltan tabla, drawer, tabs, toast, skeleton, forbidden, avatar de iniciales, swatches, tooltip |
| Dashboard | **PARCIAL** | `app/dashboard/page.tsx` + `analytics` (6 endpoints reales: `overview`, `leads-by-stage`, `agent-performance`, `tasks-overdue`, `conversations-pending`, `lost-reasons`). Sin actividad reciente ni próximos pasos del mockup 01 |
| Contactos / papelera / fusión | **PARCIAL** | 11 endpoints: `GET /contacts`, `papelera/listado`, `:id/restore`, `:id/impacto`, `:id/perfil`, `:id/definitivo`. **Fusión: FALTANTE** (sin endpoint ni UI) |
| Conversaciones / perfil lateral | **HECHO** (funcional) | 15 endpoints incluidos `inbox`, `inbox/counters`, `:id/messages`, `handoff`, `pause/resume`, `read/unread`, `bulk`. `PerfilComercial` montado en conversaciones y pipeline |
| Pipeline y colores | **PARCIAL** | 16 endpoints (`:id/kanban`, etapas, reordenar, archivar, trasladar). Kanban **horizontal**; el mockup 04 pide vertical. Colores por hex, no swatches |
| Tareas y sugerencias | **PARCIAL** | 9 endpoints con `:id/aprobar` y `:id/rechazar`; `SugerenciasDeTarea` en frontend. Falta la vista del mockup 07 con pendientes/completadas/sugeridas separadas |
| Productos / imágenes / importación | **PARCIAL** | 14 endpoints con wizard completo (`import`, `mapping`, `preview`, `start`, `cancel`, `report`, `limits`). Catálogo sin imágenes; falta UI del wizard (mockup 09) |
| Cotizaciones / PDF / documentos | **PARCIAL** | 11 endpoints, `from-lead/:leadId`, `:id/pdf`, ciclo enviar/aceptar/rechazar. `documents/` con 13 componentes. Falta repositorio filtrable del mockup 11 |
| Pulso / editor / importación JSON | **PARCIAL** | 40 endpoints, editor visual, versiones, disparadores, simulador, métricas, kill switch. **Importación JSON: FALTANTE** en UI |
| Automatizaciones / reglas | **PARCIAL** | 6 endpoints + `AutomationEditor`, `AutomationRuns` |
| WhatsApp multi-número | **PARCIAL** | 12 endpoints en `whatsapp-integration`; 1 integración por empresa en el esquema. Multi-número del mockup 13 por verificar |
| Empresa / equipo / datos | **PARCIAL** | `settings/company`, `settings/data`, `compliance` (12 endpoints). **Equipo e invitaciones sin UI de empresa**: `admin/invitation-codes` solo existe en el panel de plataforma |
| Acceso / onboarding | **PARCIAL** | Login, recuperación, restablecimiento y onboarding de 8 pasos. `sessions` existe en backend; **sin UI de dispositivos** |
| Búsqueda / notificaciones | **PARCIAL** | Notificaciones completas (6 endpoints + centro + campana). **Búsqueda global: FALTANTE** — no hay endpoint ni UI; solo filtros `search`/`q` por módulo |

### Mapa de entidades y enlaces existentes

Verificado en `schema.prisma`. Las relaciones del §4 **ya existen** casi por completo:

- `Contact` → conversaciones, leads, tareas, notas, campos personalizados e historial.
- `Conversation` → contacto, integración de WhatsApp, mensajes, handoff, lecturas.
- `Lead` → contacto, pipeline, etapa, responsable, productos (`LeadProduct`), cotizaciones.
- `Task` → contacto y, opcionalmente, lead; estados y sugerencias con aprobación.
- `Quote` → lead, contacto, líneas, economía en Decimal, estados.
- `AuditLog` → `actorUserId`, `affectedCompanyId`, acción, entidad, metadatos.

**No hace falta crear tablas para el incremento activo.** La búsqueda global se
resuelve consultando lo existente.

### Inventario de reutilizables

- **Guards**: `AuthGuard('jwt')` + `BusinessTenantGuard` + `RolesGuard`, aplicados a nivel de controlador.
- **Tenant**: `req.user.companyId` y `where: { companyId }` **en la consulta**, nunca filtrado en memoria.
- **Primitivas**: `Button` (7 variantes), `Badge`, `Field`/`Input`/`Select`/`Textarea`, `Card`, `Modal`, `ConfirmDialog`, `ListState`, `EmptyState`, `TaktoLogo`, `useDialogoModal`.
- **Diálogos**: `useDialogoModal` da fondo bloqueado, Escape, foco atrapado, foco devuelto y pila para anidados.
- **Estado de listas**: `ListState` distingue cargando / error / vacío, y `mensajeDeError` traduce 401/403.

---

## Baseline de pruebas y deuda

| Métrica | Valor en este SHA |
|---|---|
| Pruebas frontend | 490 en 63 archivos |
| Pruebas unitarias backend | **2105 en 127 suites** (`npx jest`, 49 s) |
| Archivos e2e backend | 57 |
| Migraciones | 56 aplicadas, 0 pendientes (local) |
| CI del SHA | verde |

**Deuda heredada verificada:**

1. `src/lib/axios.test.ts` es **intermitente bajo carga** (timeouts de 5 s). Aislada pasa siempre.
2. `EstadoTransporte.test.tsx` tiene un warning de lint previo (`NOMBRE_PULSO` sin usar).
3. Iconos del brand pack **sin integrar** por decisión: 68 iconos lucide a trazo 2 frente a 20 oficiales a 1,75; el manual prohíbe mezclar familias.
4. Los tres tonos derivados (`status-error-hover`, `status-success-strong`, `status-warning-strong`) están aprobados como tokens semánticos pero **sin visado de marca**.

---

## Gaps que requieren decisión de producto

| Gap | Por qué necesita decisión |
|---|---|
| Fusión de contactos | Qué campo gana ante conflicto, y si el absorbido queda como alias o desaparece |
| Pipeline vertical | Cambia la interacción de arrastre ya probada; conviene confirmar antes de reescribir |
| WhatsApp multi-número | El esquema hoy asume una integración por empresa; ampliarlo es cambio de modelo |
| Eliminación definitiva | Ya existe `:id/definitivo` con frase de confirmación; falta política de retención visible |

---

## Incremento activo

- **ID:** `2.1 — Búsqueda global tenant-wide`
- **Fase:** 2 · **Mockup:** `16-busqueda-y-crear.png`
- **Por qué este:** es el hueco **FALTANTE** más claro y autocontenido, y es vertical de verdad (contrato, backend, UI, permisos, aislamiento, pruebas y QA). No requiere migraciones ni cambia comportamiento existente.
- **Objetivo observable:** desde cualquier pantalla, abrir la paleta con `Ctrl/⌘+K`, escribir, ver resultados agrupados por tipo y abrir el objeto exacto con teclado o ratón.

**Alcance de este incremento**

- Backend: `GET /search` acotado por `companyId` sobre contactos, conversaciones, oportunidades, productos y cotizaciones.
- Frontend: paleta de comandos en el shell, pestañas por tipo, navegación con teclado, enlaces profundos y estados de carga/vacío/error.
- Filtro «incluir papelera» para contactos archivados.
- Pruebas: unitarias de servicio, e2e de aislamiento multiempresa y de rol, y pruebas de componente.
- QA desktop en 1920/1440/1280/1024.

**Fuera de alcance, a propósito (queda como incremento 2.2)**

- Panel «Crear rápidamente» del mockup.
- Lista de «Recientes».
- Lenguaje natural («crear tarea para Laura mañana a las 9:00»).

---

## Decisiones adoptadas durante la implementación

| Fecha | Decisión | Motivo | Consecuencia |
|---|---|---|---|
| 2026-08-12 | El paquete desktop vive en `docs/takto-desktop/` | Es la ruta que prescribe su propio README y la que usa el prompt de arranque | Las rutas del objetivo resuelven |
| 2026-08-12 | Primer incremento = búsqueda global, no primitivas de fase 1 | Un incremento de solo primitivas no es vertical: no tiene contrato ni backend, así que no puede satisfacer el §9 | La fase 1 se completa por demanda, con cada incremento que necesite una primitiva nueva |

---

## Migraciones

| Migración | Aditiva | Local | Staging | Backfill | Rollback |
|---|---:|---:|---:|---|---|
| Ninguna en el incremento 2.1 | — | — | ❌ | — | — |

---

## Evidencia de pruebas

| Fecha | Incremento | Comando/gate | Resultado |
|---|---|---|---|
| 2026-08-12 | Fase 0 | `vitest run` (frontend) | 490/490 en el SHA base |
| 2026-08-12 | Fase 0 | `npx jest` (backend) | **2105/2105 en 127 suites** |
| 2026-08-12 | Fase 0 | CI remoto sobre `3da2914` | Backend y Frontend `success` |

---

## QA visual desktop

| Pantalla | 1920 | 1440 | 1280 | 1024 | Teclado | Consola | Estado |
|---|---:|---:|---:|---:|---:|---:|---|
| Búsqueda global |  |  |  |  |  |  | EN_CURSO |
| Inicio |  |  |  |  |  |  | PENDIENTE |
| Contactos |  |  |  |  |  |  | PENDIENTE |
| Conversaciones |  |  |  |  |  |  | PENDIENTE |
| Pipeline |  |  |  |  |  |  | PENDIENTE |
| TAKTO Pulso |  |  |  |  |  |  | PENDIENTE |
| Tareas |  |  |  |  |  |  | PENDIENTE |
| Productos |  |  |  |  |  |  | PENDIENTE |
| Cotizaciones |  |  |  |  |  |  | PENDIENTE |
| Documentos |  |  |  |  |  |  | PENDIENTE |
| Automatizaciones |  |  |  |  |  |  | PENDIENTE |
| WhatsApp |  |  |  |  |  |  | PENDIENTE |
| Empresa/Datos/Equipo |  |  |  |  |  |  | PENDIENTE |

> Nota: la QA anterior de esta rama se hizo en 1440/1280/1024/768/390. El plan
> desktop pide **1920** y retira 768/390, así que 1920 hay que rehacerlo.

---

## Deuda y limitaciones conocidas

Ver «Baseline de pruebas y deuda». Las deudas históricas se verificaron contra el
código de este SHA antes de anotarse.

---

## Próximo comando seguro

```bash
# Desde la raíz del repositorio:
git status --short --branch
git rev-parse HEAD
git rev-parse origin/feature/takto-brand-ui-integration
# Continuar el incremento 2.1 (búsqueda global) desde la sección «Incremento activo».
```
