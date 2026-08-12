# TAKTO Desktop — estado de implementación

> Documento de continuidad. Claude debe actualizarlo al final de cada incremento
> y antes de cualquier pausa larga. Nunca contiene contraseñas, tokens ni datos
> personales reales.

## Última actualización

- Fecha: 12 de agosto de 2026 · America/Bogota
- Rama: `feature/takto-brand-ui-integration`
- HEAD al empezar la fase 0: `3da29143e0ef8b798282f9d19bb0e0cab475139a`
- HEAD al cerrar el incremento 2.1: `a98229d382d6b1df93278213e1aff1839844d6b6`
- Commits del incremento: `d3b7fee` (fase 0) · `add1717` + `7220bbf` (backend) · `a98229d` (frontend)
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
| 2. Shell, búsqueda y notificaciones | **EN_CURSO** | **2.1 y 2.2 HECHOS** (mockup 16 completo). Falta el inicio del mockup 01 | — |
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
| Búsqueda / notificaciones | **HECHO** (mockup 16) | Notificaciones completas. Búsqueda global + paleta Ctrl+K + creación rápida + recientes (incrementos 2.1 y 2.2) |

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

## Incremento cerrado: 2.1 — Búsqueda global tenant-wide

**Estado: HECHO.** Mockup 16. Sin migraciones.

### Qué se entregó

| Capa | Archivos |
|---|---|
| Contrato | `apps/backend/src/modules/search/dto/search-query.dto.ts` |
| Backend | `search.service.ts`, `search.controller.ts`, `search.module.ts`, registro en `app.module.ts` |
| Frontend | `apps/frontend/src/lib/busqueda.ts`, `components/busqueda/PaletaDeBusqueda.tsx`, disparador en `layout/Header.tsx` |
| Enlace profundo nuevo | `?abrir=` en `app/dashboard/products/page.tsx` |

### Flujo observable

Desde cualquier pantalla: `Ctrl/⌘+K` (o el botón «Buscar…») abre la paleta →
se escribe → resultados agrupados por tipo → `↑↓` navega, `Enter` abre el
objeto exacto, `Esc` cierra. Filtros por tipo y «Incluir papelera».

### Cómo se cumple cada punto del §9

| # | Criterio | Evidencia |
|---|---|---|
| 1 | Flujo observable completo | QA desktop: escribir → 14 resultados reales → `Enter` → `/dashboard/pipeline?perfil=…` |
| 2 | Datos reales y relaciones | Consulta las 5 entidades vivas; los resultados traen `contactoId` |
| 3 | Tenant, permisos, auditoría | `companyId` en el `where` de las 5 consultas; e2e con dos empresas de texto idéntico; SUPER_ADMIN sin empresa → 403; `companyId` por query → 400. **Sin auditoría a propósito**: leer no se audita en este repositorio, y registrar cada tecleo crearía un historial de lo que la gente busca |
| 4 | Estados alternos | Mínimo de caracteres, cargando, vacío (con atajo a la papelera), error con `role="alert"` |
| 5 | Pruebas y CI | 14 unitarias + 17 e2e backend; 22 frontend. CI: ver abajo |
| 6 | Cuatro anchos desktop | 1920/1440/1280/1024, sin desbordes |
| 7 | No degrada ni deja datos | Suite completa verde; no se creó dato QA nuevo |
| 8 | Documentado con límites | Esta sección |
| 9 | Reanudable | «Próximo comando seguro» |
| 10 | No depende de staging | QA local en 3010/3011 |

### Decisiones técnicas

- **La API no devuelve URLs.** Devuelve `tipo` e `id`; la ruta la arma el
  frontend. Si las construyera el backend, mover una pantalla obligaría a
  desplegar la API para arreglar un enlace.
- **Las conversaciones se encuentran por su contacto, no por el texto de los
  mensajes.** Recorrer el histórico completo es caro y expondría en una lista
  lo que alguien escribió en un chat.
- **Mínimo dos caracteres y cinco resultados por tipo.** Es una paleta, no un
  listado.
- **Sin `@Roles`.** Los cinco listados que consulta ya son legibles por
  cualquier usuario de la empresa; restringir aquí escondería resultados
  visibles entrando a la pantalla y sugeriría una protección inexistente.

### Limitaciones honestas

- **No busca dentro de los mensajes** (ver arriba). Si se pide, es un
  incremento propio con su decisión de privacidad.
- **`contains` sin índice de texto completo.** Correcto y suficiente para el
  volumen actual; con catálogos grandes habrá que medir y quizá pasar a
  búsqueda de texto completo de PostgreSQL.
- **Los contactos abren su perfil sobre el embudo** (`/dashboard/pipeline?perfil=`)
  porque no existe una ruta `/dashboard/contacts/[id]`. Es el destino real hoy.
- **Panel «Crear rápidamente» y «Recientes» del mockup 16: fuera de alcance**,
  declarado desde el inicio. Van en el incremento 2.2.

### Próximo incremento propuesto: `2.2 — Crear rápidamente y recientes`

Completa el mockup 16: panel de creación rápida (contacto, oportunidad, tarea,
cotización, producto, bot) y lista de recientes. Reutiliza los modales que ya
existen; no necesita endpoints nuevos salvo, quizá, uno de «recientes».

---

## Incremento cerrado: 2.2 — Creación rápida y recientes

**Estado: HECHO.** Mockup 16 queda completo. Sin migraciones, sin endpoints nuevos.

### Qué se entregó

| Capa | Archivos |
|---|---|
| Contrato/permisos | `apps/frontend/src/lib/creacion-rapida.ts` |
| UI | `components/busqueda/CreacionRapida.tsx`; paleta a dos columnas en `PaletaDeBusqueda.tsx` |
| Sesión | `olvidarRecientes()` al cerrar sesión, en `layout/Header.tsx` |

### Reutilización, que era el requisito

**No se escribió ni un formulario nuevo.** El panel abre `ContactModal`,
`LeadFormModal`, `TaskModal` y `ProductModal` tal cual. Duplicarlos habría
dejado dos sitios donde arreglar cada validación.

### Permisos, espejados del backend

| Acción | Roles | Endpoint |
|---|---|---|
| Contacto, oportunidad, tarea | cualquiera de la empresa | `POST /contacts`, `/leads`, `/tasks` |
| **Producto** | `ADMIN`, `SUPER_ADMIN` | `POST /products` |
| **Bot** | `ADMIN`, `MANAGER`, `SUPER_ADMIN` | `POST /flowbots` |

La protección real vive en los guardas del servidor. Filtrar aquí evita ofrecer
un botón que devolvería 403: enseñar una acción prohibida y fallar al pulsarla
es peor que no enseñarla, porque el usuario cree que le falta algo suyo.

### Dos acciones navegan en vez de abrir formulario

Una cotización pertenece **siempre** a una oportunidad
(`POST /quotes/from-lead/:leadId`), así que sin elegirla antes no hay nada que
crear: lleva al embudo. Un bot se edita en su pantalla. Ambas lo avisan debajo
del botón, y hay una prueba que exige que ese aviso exista.

### Recientes: en memoria, no en disco

El nombre de un contacto es un dato personal. Este producto guarda el token
**solo en memoria** justamente para no dejar rastro en disco; escribir ahí una
lista de clientes contradiría esa decisión. Además, un navegador compartido
filtraría entre usuarios —y entre empresas— lo que cada uno estuvo mirando.

La lista está atada a `empresa+usuario`: si cambia la sesión se descarta entera,
y al cerrar sesión se vacía.

**Limitación, verificada en el navegador:** se pierde al recargar la página.
Medido explícitamente — sin recargar la lista funciona y respeta el orden; tras
`F5` queda vacía. Persistirla exige decidir antes dónde y con qué retención;
queda como decisión de producto pendiente.

### Defecto de 2.1 corregido aquí

El manejador de teclas colgaba del campo, así que pulsar un chip de filtro con
el ratón dejaba el foco en el chip y a partir de ahí las flechas no movían la
selección y Enter reactivaba el chip. Ahora las teclas se escuchan en el panel
y elegir un filtro devuelve el foco al campo. Hay una prueba que fija el camino
mixto que fallaba.

### QA desktop — 1920 / 1440 / 1280 / 1024

| Comprobación | Resultado |
|---|---|
| 6 acciones visibles para ADMIN | ✅ en los 4 anchos |
| Abre el modal reutilizado de contactos (3 campos) | ✅ |
| Foco dentro del modal, fondo bloqueado | ✅ |
| Escape cierra el modal y **deja la paleta abierta** | ✅ |
| Recientes tras abrir un resultado | ✅ con su tipo |
| Desbordes, botones sin nombre, colores genéricos | ✅ ninguno |
| Hosts contactados | ✅ solo `localhost:3001` y `:3010` |

### Limitaciones honestas

- **Recientes se pierden al recargar** (ver arriba).
- El panel se **oculta por debajo de `lg`**: este trabajo es desktop primero y
  el plan pide no improvisar móvil.
- «Nueva cotización» y «Nuevo bot» navegan; no crean desde la paleta.
- A 1440 px y menos, los chips de filtro ocupan dos líneas. Cabe y no desborda,
  pero es el punto más apretado de la paleta.

### Próximo incremento propuesto: `2.3 — Inicio accionable (mockup 01)`

Cierra la fase 2: actividad reciente, métricas que lleven a su listado y
próximos pasos. `analytics` ya expone seis endpoints reales, así que es
sobre todo UI y enlaces profundos.

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
| 2026-08-12 | 2.1 | `npx jest src/modules/search` | **14/14** |
| 2026-08-12 | 2.1 | `npx jest --config test/jest-e2e.json search-` | **17/17** (4 contra Postgres real) |
| 2026-08-12 | 2.1 | `vitest run` (frontend completo) | **512/512** en 64 archivos (+22) |
| 2026-08-12 | 2.1 | `tsc --noEmit` backend y frontend | sin errores |
| 2026-08-12 | 2.1 | `eslint` backend y frontend | 0 errores (1 warning previo) |
| 2026-08-12 | 2.1 | `next build` | compila |
| 2026-08-12 | 2.1 | QA desktop 1920/1440/1280/1024 | **sin hallazgos**; 14 resultados reales por ancho |
| 2026-08-12 | 2.2 | `vitest run` (frontend completo) | **539/539** en 66 archivos (+27) |
| 2026-08-12 | 2.2 | `tsc --noEmit` + `eslint` | sin errores (1 warning previo) |
| 2026-08-12 | 2.2 | `next build` | compila |
| 2026-08-12 | 2.2 | QA desktop 1920/1440/1280/1024 | **sin hallazgos** |
| 2026-08-12 | 2.2 | Recientes con y sin recarga | funciona sin recargar; vacío tras `F5` (limitación documentada) |

---

## QA visual desktop

| Pantalla | 1920 | 1440 | 1280 | 1024 | Teclado | Consola | Estado |
|---|---:|---:|---:|---:|---:|---:|---|
| Búsqueda global (paleta) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **HECHO** |
| Crear rápidamente + recientes | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **HECHO** |
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
> desktop pide **1920** y retira 768/390, así que las pantallas ya migradas
> siguen sin verificarse a 1920. La búsqueda global sí se probó en los cuatro.

**Cómo se ejecutó la QA sin romper la vista previa del usuario.** Había una
vista previa en `:3000`/`:3001` que el usuario está revisando y que no debía
detenerse. El servidor standalone lee de `.next`, y recompilar lo habría roto,
así que se copió a `%TEMP%	akto-preview-standalone` y se reinició desde ahí:
queda independiente del directorio de build. La QA usó `:3010`/`:3011`, con
`CSRF_ALLOWED_ORIGINS=http://localhost:3010` en el proceso de QA —variable de
entorno, no cambio de configuración—. Hosts contactados durante la QA:
`localhost:3010` y `localhost:3011`, ninguno más.

---

## Deuda y limitaciones conocidas

Ver «Baseline de pruebas y deuda» y las limitaciones del incremento 2.1.

Añadido en este incremento:

- La búsqueda usa `contains` sin índice de texto completo. Correcto para el
  volumen actual; con catálogos grandes habrá que medirlo.
- Los contactos abren su perfil sobre el embudo porque no existe
  `/dashboard/contacts/[id]`. Cuando exista, cambia una línea en
  `rutaDelResultado`.
- La búsqueda **no** se audita, a propósito: leer no se audita en este
  repositorio y registrar cada tecleo crearía un historial de lo que la gente
  busca.
- Los **recientes se pierden al recargar**: viven en memoria para no escribir
  nombres de clientes en el disco. Persistirlos es una decisión de producto.
- El panel de creación rápida **no se muestra por debajo de `lg`**.

---

## Próximo comando seguro

```bash
# Desde la raíz del repositorio:
git status --short --branch
git rev-parse HEAD
git rev-parse origin/feature/takto-brand-ui-integration
# Los incrementos 2.1 y 2.2 estan CERRADOS: el mockup 16 queda completo.
# El siguiente es 2.3 (inicio accionable, mockup 01), descrito al final de la
# seccion «Incremento cerrado: 2.2».
```
