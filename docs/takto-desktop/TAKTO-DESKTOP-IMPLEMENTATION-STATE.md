# TAKTO Desktop — estado de implementación

> Documento de continuidad. Claude debe actualizarlo al final de cada incremento
> y antes de cualquier pausa larga. Nunca contiene contraseñas, tokens ni datos
> personales reales.

## Última actualización

- Fecha: 13 de agosto de 2026 · America/Bogota
- Rama: `feature/takto-brand-ui-integration`
- HEAD al empezar la fase 0: `3da29143e0ef8b798282f9d19bb0e0cab475139a`
- HEAD al cerrar el incremento 2.1: `a98229d382d6b1df93278213e1aff1839844d6b6`
- Commits de 2.1: `d3b7fee` (fase 0) · `add1717` + `7220bbf` (backend) · `a98229d` (frontend)
- Commits de 2.3 (primer intento, **rechazado visualmente**): `66a3c49` · `716e885`
- SHA que cerró documentalmente aquel intento: `99968cdc057c5de38555d4c48463ff0f660da573`
- Commits de 2.3 (segundo intento): `f9e6992` (contratos) · `e506330` (shell + pantalla)
  · `84772f7` (tres recortes) · `f133e69` (doble desplazamiento) · `1d16fae`
  (empaquetado de la retícula)
- **SHA de implementación de 2.3 aprobado por revisión humana: `1d16fae460f04fcaa4b87befcc1bee7f9cb2ba15`**
- **CI de ese SHA: verde — run [`31746787438`](https://github.com/zabaisai/tehus-rattan/actions/runs/31746787438)**
- Aprobación humana: **13 de agosto de 2026**
- `main`: `b19217c2e4da69b251285774c1f6585cc29fb765`
- Staging: no tocado
- Producción: fuera de alcance

> **Corrección de una discrepancia del propio documento.** La versión anterior
> declaraba «HEAD al cerrar el incremento 2.3: `716e885`», que es el último
> commit de *código*, no el HEAD: el cierre documental fue `99968cd`, un commit
> posterior que este archivo no registraba. En consecuencia, su línea «CI del
> SHA: ✅» se refería a `716e885` y no al HEAD real. Se verificó aparte que
> `99968cd` también estaba en verde (Backend y Frontend `success`). A partir de
> ahora el SHA de cierre se anota **después** de publicar, no antes.

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
| 1. Fundamentos visuales | **PARCIAL** | Primitivas en `components/ui/`; entraron skeleton, forbidden, avatar, metric-card, panel y sparkline con consumidor real; faltan tabla, drawer, tabs, toast, swatches, tooltip | — |
| 2. Shell, búsqueda y notificaciones | **HECHO** | 2.1 y 2.2 aprobados (mockup 16) y **2.3 aprobado el 13-ago-2026** sobre `1d16fae` (mockup 01) | — |
| 3. Contactos, conversaciones y perfil 360 | PARCIAL | Listado, papelera, restauración y perfil existen. **Fusión de duplicados (3.x): entregada de extremo a extremo, EN REVISIÓN HUMANA** | Revisión humana de 3.x |
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
| Dashboard | **HECHO** (mockup 01) | `app/dashboard/page.tsx` + `analytics` (8 endpoints reales: los 6 anteriores más `sales-trend` y `activity`). Hero, cuatro métricas con enlace, embudo, conversaciones sin responder, agenda, tendencia, rendimiento y actividad reciente. Aprobado el 13-ago-2026 (incremento 2.3) |
| Contactos / papelera / fusión | **PARCIAL** | 11 endpoints previos más 7 de fusión (`:id/duplicados`, `:id/canonico`, `fusion/comparar`, `fusion/descartar`, `fusion/ejecutar`, `fusion/:id/deshacer`, `fusion/:id/estado`) y el flujo del mockup 22 en `components/contacts/FusionDeDuplicados.tsx`. **Fusión: entregada, en revisión humana** |
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
| ~~Fusión de contactos~~ | **RESUELTO** el 13-ago-2026: gana el campo que elija la persona, uno a uno, con el valor del principal preseleccionado; el absorbido queda como alias interno. Implementado en 3.x |
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

## Incremento cerrado: 2.3 — Inicio accionable (mockup 01)

**Estado: HECHO / APROBADO.** Aprobado por revisión humana el **13 de agosto de
2026**. El primer intento (`66a3c49` + `716e885`, cerrado documentalmente en
`99968cd`) pasó pruebas y CI pero **la revisión humana lo rechazó
visualmente**; esta sección documenta la reentrega, que sí quedó aprobada. La
sección siguiente conserva el registro de aquel primer intento, que sigue
siendo cierto en lo que afirma.

**Commits de la reentrega:** `f9e6992` (contratos) · `e506330` (shell + pantalla)
· `84772f7` (tres recortes) · `f133e69` (doble desplazamiento) · `1d16fae`
(empaquetado de la retícula)

### Aprobación humana — 13 de agosto de 2026

| Dato | Valor |
|---|---|
| SHA de implementación aprobado | **`1d16fae460f04fcaa4b87befcc1bee7f9cb2ba15`** |
| CI de ese SHA | **verde**, run [`31746787438`](https://github.com/zabaisai/tehus-rattan/actions/runs/31746787438) — Frontend y Backend `success`, incluidos «Typecheck (incluye tests)» y E2E |
| Rama | `feature/takto-brand-ui-integration`, árbol limpio y sincronizado |
| Veredicto | «Se ve bien, me gusta y todo está correcto» |

**Criterios comprobados en la revisión:**

| # | Criterio | Resultado |
|---|---|---|
| 1 | Revisión visual del Inicio contra el mockup 01 | ✅ aprobado |
| 2 | Todas las acciones y enlaces profundos visibles, probados uno a uno | ✅ funcionan |
| 3 | Una sola barra de desplazamiento vertical | ✅ |
| 4 | Paleta de búsqueda sin saltos de posición al abrir y cerrar | ✅ |
| 5 | Retícula sin huecos excesivos | ✅ |
| 6 | 2.1 y 2.2 siguen aprobados y sin regresión | ✅ |
| 7 | Ningún dato modificado durante la revisión | ✅ |

Con esto la **fase 2 queda HECHA**: mockups 16 (2.1 y 2.2) y 01 (2.3).

> El SHA de **este cierre documental** no se anota aquí a propósito: se lee del
> historial de la rama. Anotarlo antes de publicar es justo el error que
> corrigió la nota de «Última actualización».

### Segunda ronda de revisión humana: dos barras de desplazamiento

**Hallazgo reproducible.** En `/dashboard` aparecían dos barras verticales —una
del contenido y otra del documento— y al bajar del todo quedaba un blanco enorme
por debajo del shell. Capturado en pantalla física de 1920 px con el navegador
al 100 %, que en este equipo son **1536 px CSS** (Windows al 125 %).

**Causa exacta, medida y no deducida.** Un `overflow` distinto de `visible` solo
recorta a un descendiente absoluto si además es su **bloque contenedor**. `main`
era `position: static`, así que no lo era: cualquier descendiente
`position: absolute` resolvía contra el bloque contenedor inicial —el viewport—,
quedaba fuera del recorte de `main`, y su posición estática, que cae dentro del
contenido ya desplazado, pasaba a contar como desbordamiento **del documento**.

Lo disparaba `sr-only`, que es `position: absolute`: el `<caption>` de la tabla
equivalente en texto de «Tendencia de ventas» —la que existe para el lector de
pantalla— se quedaba a 1083 px y estiraba el documento a 1083 frente a los 695
del viewport. **El elemento que rompía la pantalla es el que la hace accesible**,
y por eso no se veía leyendo el código.

Hay un segundo `<caption class="sr-only">` en «Rendimiento por asesor». Hoy no
se monta porque en la vista previa ninguna oportunidad tiene responsable y el
panel enseña su estado honesto; en cuanto haya uno asignado habría escapado
también. El arreglo cubre los dos y los que vengan.

**Qué NO se hizo.** No se puso `overflow: hidden` en `html` ni en `body`: eso
habría escondido el síntoma dejando la trampa puesta. Tampoco se arregló solo
aquel `<caption>`, por lo mismo.

**Corrección.** `main` pasa a `relative`, con lo que el recorte lo hace el mismo
elemento que ya era la única zona desplazable. El shell pasa de `h-screen` a
`h-dvh`: en escritorio miden lo mismo —695,2 px las dos, medido— así que hoy no
mueve nada; existe para el navegador con barra dinámica, donde `100vh` es la
altura del viewport largo y deja el shell más alto que la pantalla.

**Efecto secundario que se corrige solo.** El bloqueo de fondo de los diálogos
hace `body { overflow: hidden }`. Con la barra del documento presente, abrir la
paleta o cualquier modal la retiraba y el ancho útil saltaba de 1521 a 1536 px:
cabecera y contenido se movían 15 px en cada apertura y cada cierre. Sin barra
de documento no hay nada que retirar, y el salto medido es **0**.

**Lo que este arreglo NO toca, y conviene que la revisión sepa.** El fondo nunca
estuvo bloqueado de verdad: `body { overflow: hidden }` frenaba la barra del
documento, no la de `main`, así que con un diálogo abierto el contenido de
detrás siempre se ha podido desplazar. Sigue igual —no es una regresión de este
cambio, y arreglarlo toca `useDialogoModal`, que usan todas las pantallas—. Se
anota como deuda, no se corrige aquí.

### Tercera ronda de revisión humana: huecos de la retícula

Aprobado el doble desplazamiento y probadas todas las acciones y enlaces
profundos del Inicio, quedaba un defecto visual: **«Embudo comercial» es más
alto que «Conversaciones» y «Agenda», y como los tres compartían fila, la
segunda fila esperaba al Embudo y dejaba una franja de fondo vacío bajo los
paneles cortos.**

**Causa exacta.** En una retícula la fila entera mide lo que su elemento más
alto. `items-start` ya impedía que los paneles se estirasen —eso se arregló en
la reentrega— pero no impide que la fila siguiente espere. Medido a 1536 px:
Embudo 422 px, Conversaciones 165 y Agenda 246; la segunda fila arrancaba a
438 px del techo de la primera, así que quedaban **273 px** de fondo bajo
Conversaciones y **192 px** bajo Agenda.

A 1024 era peor por otro motivo: «Tendencia de ventas» ocupaba `col-span-12`,
así que no cabía junto a la Agenda y dejaba **media fila entera vacía**. Hueco
medido: **535 px**.

Segundo defecto en el mismo sitio: la fila de abajo iba **5/4/3** contra el
**4/4/4** de la de arriba, de modo que ningún panel inferior quedaba alineado
con el superior. Medido a 1536: Embudo empezaba en x=264 y Tendencia también,
pero Conversaciones en 680 contra Rendimiento en 784, y Agenda en 1097 contra
Actividad en 1201.

**Corrección.** Cada pareja se agrupa en su **columna**, para que Tendencia
suba pegada al Embudo, Rendimiento a Conversaciones y Actividad a la Agenda.
Eso pide dos disposiciones —seis elementos sueltos por debajo de `xl`, tres
columnas a partir de `xl`— y **`display: contents`** las da con un solo DOM:
por debajo de `xl` el envoltorio no genera caja y sus paneles participan en la
retícula como si no existiera; a partir de `xl` se convierte en columna
flexible. Ni componentes duplicados, ni dos dashboards, ni alturas fijas. Las
tres columnas pasan a `col-span-4`, así que ahora sí se alinean.

**Qué se descartó.** `grid-template-rows: masonry` no está disponible de forma
estable. Las columnas CSS (`columns-*`) empaquetan igual de bien pero reparten
los paneles por equilibrado de altura, y entonces la pareja de cada columna
deja de ser la del mockup, que es justo lo que pedía la revisión.

**La primera columna es entera de administración**, así que para el resto de
roles no se monta ni el envoltorio: reservar un tercio de pantalla a nada sería
cambiar un hueco por otro.

### Qué rechazó la revisión, y cómo se resolvió

| # | Hallazgo | Resolución |
|---|---|---|
| 1 | Shell blanco, sin logo TAKTO, navegación navy, selector de empresa ni acción global Crear | Barra navy con `TaktoLogo` en negativo, bloque propio de empresa, activo con barra naranja y `aria-current`; «Crear» en la cabecera abre la paleta que ya contiene «Crear rápidamente» |
| 2 | Hero sin la composición aprobada; CTA de cotización no era una acción de creación | Degradado navy del mockup, saludo por primer nombre, CTA que reutiliza la definición de `creacion-rapida` (al embudo, con su aviso) |
| 3 | Métricas planas | Curva y comparación reales desde `sales-trend`; nota honesta en las dos que no tienen serie |
| 4 | Faltaba «Tendencia de ventas» | Panel nuevo con dos series reales + tabla equivalente en texto |
| 5 | Embudo sin jerarquía | Orden, nombre, conteo, valor, barra y total; sin códigos técnicos; sin filtrar etapas reales |
| 6 | Conversaciones sin prioridad, tiempos ni estados legibles | Orden por espera, insignia de tiempo, estado traducido, canal y acción «Responder» |
| 7 | Agenda sin densidad, prioridad ni enlaces profundos | Prioridad real, hora, vencida marcada y `?abrir=<id>` (añadido a Tareas) |
| 8 | Rendimiento sin jerarquía y con todo a cero | Tabla comparativa; con todo sin asignar, estado honesto y enlace para asignar |
| 9 | Actividad reciente vacía | Diagnóstico: se leía `notifications` (bandeja personal) y la empresa tenía 0; ahora lee la auditoría por `analytics/activity` |
| 10 | Alturas rígidas y huecos | `items-start`; los paneles de administración no se montan para otros roles |
| 11 | Falta movimiento útil | Tokens `--duration-rapida/media/lenta` (140/180/220 ms), apagados por `prefers-reduced-motion` |
| 12 | No romper 2.1 y 2.2 | Ctrl/⌘+K, filtros, teclado, creación rápida, Escape por capas y recientes en memoria: sin cambios y con sus pruebas en verde |

### Contratos

| Contrato | Estado |
|---|---|
| `analytics/overview`, `leads-by-stage`, `agent-performance`, `tasks-overdue` | **reutilizados**, sin cambios |
| `conversations/inbox?unread=true`, `tasks` | **reutilizados**, sin cambios |
| `analytics/sales-trend` | **nuevo** — serie diaria + ventana previa |
| `analytics/activity` | **nuevo** — auditoría de la empresa, sin campos sensibles |
| `notifications` | ya no alimenta el panel de actividad; sigue intacto para la campana y su pantalla |

Sin migraciones. Ambos endpoints van dentro del controlador de `analytics`, que
ya exige `AuthGuard('jwt') + BusinessTenantGuard + RolesGuard` y
`@Roles('ADMIN','SUPER_ADMIN')`.

### Evidencia de pruebas

```
apps/backend   2137 pruebas en 129 suites · verde   (+16 unitarias de analytics)
               6 e2e contra PostgreSQL real (analytics-inicio)
apps/frontend  619 pruebas en 68 archivos · verde   (+39)
typecheck      limpio en los dos
lint           0 errores · 1 aviso preexistente (EstadoTransporte.test.tsx)
build          OK en los dos
```

Secuencia ejecutada en el orden del CI y **después del último archivo tocado**,
según la lección de `49f2141`.

### Diferencias deliberadas con el mockup 01

| Mockup | Implementación | Motivo |
|---|---|---|
| «Proyectado» en la tendencia | Solo series reales: abiertas y ganadas | Proyectar exige un pronóstico ponderado que el producto no calcula |
| «+14 % vs. ayer» en las cuatro métricas | Comparación solo donde hay serie; nota en las otras dos | Conversión es un acumulado y «tareas vencidas» es una foto del presente |
| Fotografías de personas | Iniciales | §3.1 del master lo prohíbe |
| Casilla para completar tareas en la agenda | No está | Completar es una escritura; este incremento es visual |
| Selector de empresa desplegable | Bloque que abre la configuración, solo para quien administra | Un usuario pertenece a una sola empresa: no hay entre qué elegir |
| Botón «Ver reporte completo» en rendimiento | No está | No existe pantalla de informes a la que llevar |

### Limitaciones honestas

- **La QA de anchos cubre los cuatro del plan: 1920, 1440, 1280 y 1024**, más
  1536, que es el ancho real de la captura de la revisión en este equipo. 1920
  px CSS se mide por CDP con `deviceScaleFactor: 1`; ver «QA visual desktop».
- **El fondo de los diálogos no está bloqueado de verdad.** `useDialogoModal`
  hace `body { overflow: hidden }`, que nunca frenó la zona desplazable real
  —`main`—, solo la barra del documento. Es anterior a este trabajo y sigue
  igual; arreglarlo toca un hook que usan todas las pantallas y merece su
  propio incremento.
- **Un dato de la vista previa cambió durante la sesión y no fue por este
  trabajo.** `PREVIEW_BRANDING_Comedor para restaurante`
  (`cmsoy6eos001kv2fs2smcoia2`) pasó de `OPEN` a `WON` el 13 de agosto a las
  19:21 UTC. Las cinco oportunidades siguen existiendo con sus IDs; solo cambió
  el estado de una. Este incremento únicamente lee, y no hay registro de quién
  lo hizo porque **el cambio de estado de una oportunidad no se audita** en
  este repositorio: solo quedó el `updatedAt`. Se anota aquí para que nadie
  interprete después que el Inicio movió datos, y como argumento para auditar
  ese cambio en su momento.
- Con los datos de la vista previa, la curva de tendencia es un pico en un solo
  día: las cinco oportunidades se crearon la misma tarde. Es el dato real.
- «Rendimiento por asesor» enseña el estado de «sin asignar» porque en la vista
  previa ninguna oportunidad tiene responsable. No se sembró ninguno.
- La actividad reciente no lleva enlace por fila: la auditoría no devuelve
  `entityId` a propósito, así que no hay a dónde llevar.

---

## Registro del primer intento de 2.3 (rechazado visualmente)

**Commits:** `66a3c49` (fundamentos visuales + pantalla) · `716e885`
(conversaciones sin responder + retícula del mockup)

### Fundamentos de fase 1 que entraron aquí, y por qué solo esos

El objetivo pedía completar «los fundamentos visuales de la fase 1 que la
pantalla realmente necesita», sin cerrar la fase con componentes sin
consumidor. Entraron cuatro, cada uno con su consumidor dentro del Inicio:

| Primitiva | Consumidor real | Por qué existe |
|---|---|---|
| `ui/Skeleton` | `MetricCard`, `Panel` | El esqueleto va `aria-hidden`; lo que anuncia la carga es `aria-busy` en la región |
| `ui/ForbiddenState` | Métricas y dos paneles | Un 403 no invita a reintentar: no lleva botón ni `role=alert` |
| `ui/Avatar` | Rendimiento y conversaciones | Iniciales y color derivado del nombre. **Nunca una fotografía** (§3.1 del master) |
| `ui/MetricCard` | Las cuatro métricas | `href` obligatorio: una cifra que no lleva a su listado solo informa |
| `ui/Panel` | Los cinco bloques | Cabecera + cuatro ramas de estado en un sitio, no cinco copias |

**No entraron** tabla, drawer, tabs, tooltip ni swatches: el Inicio no los usa
y construirlos aquí sería exactamente lo que el objetivo prohíbe.

**`MetricCard` no tiene variante «con tendencia».** El mockup dibuja una curva
y un «+14 % vs. ayer», pero `analytics` no expone series temporales. Pintar una
tendencia inventada es peor que no pintarla, porque la gente decide mirando esa
flecha. Por lo mismo falta el panel «Tendencia de ventas» del mockup.

### Qué muestra el Inicio, y de dónde sale cada dato

| Bloque | Contrato | Rol | Enlace profundo |
|---|---|---|---|
| Oportunidades abiertas | `analytics/leads-by-stage` (suma) | ADMIN/SUPER_ADMIN | `/dashboard/pipeline` |
| Valor abierto · Conversión | `analytics/overview` | ADMIN/SUPER_ADMIN | `/dashboard/pipeline` |
| Tareas vencidas | `analytics/overdue-tasks-count` | ADMIN/SUPER_ADMIN | `/dashboard/tasks` |
| Embudo comercial | `analytics/leads-by-stage` | ADMIN/SUPER_ADMIN | `/dashboard/pipeline?etapa=<id>` |
| Conversaciones que requieren respuesta | `conversations/inbox?unread=true&limit=5` | cualquiera | `/dashboard/conversations?c=<id>` |
| Agenda de hoy | `tasks` (pendientes, por vencimiento) | cualquiera | `/dashboard/tasks` |
| Rendimiento por asesor | `analytics/agent-performance` | ADMIN/SUPER_ADMIN | — |
| Actividad reciente | `notifications?limit=6` | cualquiera | el `actionUrl` que ya trae cada aviso |

**Ningún contrato nuevo.** La actividad reciente se apoya en notificaciones
porque ya están acotadas por empresa y ya llevan enlace profundo; construir un
feed aparte habría duplicado eso. Las conversaciones sin responder son la
bandeja de siempre con `unread`, que el backend deriva comparando la marca de
lectura **de quien mira** con los mensajes entrantes: la lista dice lo mismo en
el Inicio que en Conversaciones.

### Permisos: no se pide lo que se sabe que va a dar 403

`analytics` es ADMIN/SUPER_ADMIN entero. Para los demás roles las cuatro
consultas van con `enabled:false`: pedirlas para recibir un 403 llena la
consola de errores y hace parpadear la pantalla antes de enseñar el estado
correcto. Verificado en el navegador con un usuario AGENT real: **cero**
peticiones a `/analytics/`, cero respuestas `>=400`, cero `role=alert`.

En `Panel`, `sinPermiso` se evalúa **antes** que `error` a propósito: un 403
llega como error de red y tratarlo como avería invita a reintentar algo que
nunca va a funcionar.

### Consolidación

`timeAgo` vivía dentro de `ConversationList`. Salió a `lib/tiempo` junto con
`antiguedadEnPalabras`, que es lo que oye un lector de pantalla. Dos copias de
una regla de redondeo son dos sitios donde el mismo hilo puede decir «59m» en
una pantalla y «1h» en la otra. Se borró `components/dashboard/StatCard.tsx`,
que `MetricCard` sustituye.

### Evidencia de pruebas

```
apps/frontend: 580 pruebas en 68 archivos · verde
  page.test.tsx        20  (identidad, métricas, permisos, agenda,
                            conversaciones sin responder, estados)
  MetricCard.test.tsx  17  (MetricCard, Avatar, ForbiddenState, Panel)
  tiempo.test.ts        6
typecheck  limpio
lint       0 errores · 1 aviso preexistente (EstadoTransporte.test.tsx)
build      OK
```

Secuencia ejecutada en el orden del CI y **después del último archivo tocado**,
según la lección de `49f2141`.

### QA desktop (navegador real, `:3010` contra el backend local)

| Comprobación | 1920 | 1440 | 1280 | 1024 |
|---|---|---|---|---|
| Sin desborde horizontal | ✅ | ✅ | ✅ | ✅ |
| Cuatro métricas, todas enlazando | ✅ | ✅ | ✅ | ✅ |
| Ninguna cifra cortada | ✅ | ✅ | ✅ | ✅ |
| Sin colores genéricos de Tailwind | ✅ | ✅ | ✅ | ✅ |
| Sin controles sin nombre accesible | ✅ | ✅ | ✅ | ✅ |

Además, a 1440:

| Comprobación | Resultado |
|---|---|
| Cinco regiones con nombre en el árbol de accesibilidad | ✅ Embudo · Conversaciones · Agenda · Rendimiento · Actividad |
| Tabulación con anillo de foco visible en todo el recorrido | ✅ |
| Enter sobre «Tareas vencidas» navega a `/dashboard/tasks` | ✅ |
| `prefers-reduced-motion: reduce` → 0 animaciones y 0 transiciones | ✅ |
| Cargando: `aria-busy=true`, esqueletos `aria-hidden`, sin cifras falsas | ✅ |
| Vacío: mensaje que orienta, no bloque en blanco | ✅ |
| Error (500 forzado en red): `role=alert`, `aria-busy` limpio | ✅ |
| Sin permiso (AGENT real): `ForbiddenState`, sin `role=alert` | ✅ |
| Hosts contactados | ✅ solo `localhost:3001` y `:3010` |

**El error tarda ~7 s en aparecer.** No es un fallo de la pantalla: react-query
reintenta tres veces con retroceso antes de dar la consulta por fallida, y
mientras tanto la región sigue anunciando «ocupado», que es lo correcto. Se
anota porque una QA con menos espera lo lee como «el estado de error no
funciona».

### Diferencias deliberadas con el mockup 01

| Mockup | Implementación | Motivo |
|---|---|---|
| Curvas de tendencia y «+14 % vs. ayer» | No están | La API no expone series temporales |
| Panel «Tendencia de ventas» | No está | Ídem |
| Fotografías de personas | Iniciales | §3.1 del master lo prohíbe |
| Cifras en sans | Cifras en `font-mono` | `DESIGN-SYSTEM.md` §tipografía: cifras y montos en IBM Plex Mono |
| Botón «Responder» por conversación | Toda la fila es el enlace | Responder ocurre dentro del hilo; un botón que solo navega promete más de lo que hace |

### Limitaciones honestas

- El Inicio de un AGENT enseña tres paneles útiles y dos avisos de «sin
  permiso». Es correcto, pero deja la fila de abajo medio vacía para ese rol.
- «Agenda de hoy» enlaza a `/dashboard/tasks` sin abrir la tarea concreta: no
  existe todavía un parámetro de apertura por id en esa pantalla.
- «Rendimiento por asesor» no tiene acción de cabecera porque no hay pantalla
  de informes a la que llevar.

### Siguiente paso

Ya resuelto: la reentrega de 2.3 **fue aprobada el 13 de agosto de 2026** sobre
`1d16fae`. Ver «Aprobación humana» en la sección del incremento y «Próximo
incremento seguro» al final del documento.

---

## Incremento 3.x — Fusión segura de contactos duplicados (mockup 22) · **EN REVISIÓN HUMANA**

**Estado: entregado de extremo a extremo. Pendiente de revisión visual.**

**Commits:** `1582848` (esquema, contrato y backend) · `b05b319` (interfaz)
· `7e6383f` (pruebas de frontend) · el de este cierre documental.

### Preflight §2

Ejecutado y en verde antes de escribir nada: HEAD local = remoto =
`c5ee5e13e2a9fbd74b6d3c17dfc6d0995c5ca316`, árbol limpio, sin `index.lock`,
`brand/` sin rastrear, 26/26 mockups coincidiendo con el índice y CI de ese SHA
verde (run `31747629546`). Línea base de pruebas de las áreas afectadas antes de
tocar comportamiento: 127/127.

### Caracterización dirigida

Lo que se encontró, contra el esquema y el código, no contra informes:

| Área | Hallazgo |
|---|---|
| Relaciones con `contactId` | **Siete**, todas con `companyId`: `Conversation`, `Lead`, `Task`, `TaskSuggestion`, `Quote`, `FlowBotExecution`, `CustomFieldValue` |
| Mensajes y notas | **No cuelgan del contacto**: `Message` cuelga de la conversación y `Note` de la oportunidad o la conversación. Viajan solos y no hay que moverlos |
| Restricción crítica | `contacts.@@unique([phone, companyId])` y `custom_field_values.@@unique([definitionId, contactId])`. Las dos condicionan el diseño entero |
| Normalización | Existe `common/phone/e164.util` (`normalizePhone`, `isSamePhone`, `phoneLookupVariants`). **Se reutiliza**; no se escribió otra. De correo no había ninguna: se añadió recorte + minúsculas |
| Archivo/papelera | `archivedAt`; borrado definitivo separado con anonimización. El alias es un tercer estado distinto de ambos |
| Permisos | Controlador con `AuthGuard('jwt') + BusinessTenantGuard + RolesGuard`. `BusinessTenantGuard` ya corta al SUPER_ADMIN sin empresa |
| Auditoría | `PlatformAuditLogService.record(writer, …)`, aceptando el cliente de transacción |
| Resolución por identidad | **Tres** sitios: entrada de WhatsApp, adaptador de CRM de Pulso y búsqueda global. Los tres tuvieron que aprender a seguir el alias |

### Política aprobada, y cómo quedó implementada

| # | Política | Implementación |
|---|---|---|
| 1 | El usuario elige el principal | `principalId` es entrada del contrato; la vista previa se puede pedir en cualquier orden |
| 2 | Campo por campo, sin sobrescribir en silencio | `elecciones.campos`; por defecto gana el principal y la vista previa marca `requiereDecision` |
| 3 | Teléfonos y correos alternativos | `altPhones` / `altEmails` normalizados; la búsqueda global los consulta |
| 4 | Etiquetas y fuentes sin duplicados | `unirSinDuplicados` sobre `tags` |
| 5 | Campos personalizados campo por campo | `elecciones.camposPersonalizados` por `definitionId` |
| 6 | Todo en una transacción | `$transaction`; rollback probado con un fallo real inyectado en la base |
| 7 | Conversaciones intactas | Solo cambia `contactId`; ids, canal y mensajes no se tocan. Probado |
| 8 | Alias interno | `mergedIntoId`; fuera de activos, papelera y búsqueda; sin cadenas; no restaurable |
| 9 | Detección | Teléfono/correo normalizados = **alta**; nombre = **sugerida**. Nunca automática |
| 10 | «No son duplicados» | `contact_merge_dismissals`, pareja ordenada, idempotente |
| 11 | Deshacer 10 min y solo si es seguro | Ventana fija + comprobación de que nada cambió después; si no, 409 explicando |
| 12 | Permisos | ADMIN y MANAGER sí; AGENT no; SUPER_ADMIN sin empresa ni entra |
| 13 | Auditoría sin PII | `contact.merge`, `contact.merge.dismiss`, `contact.merge.undo` con ids, claves y recuentos |
| 14 | Sin efectos | No mueve etapas, no envía nada, no dispara automatizaciones |

### Mapa de relaciones trasladadas

`Conversation`, `Lead`, `Task`, `TaskSuggestion`, `Quote`, `FlowBotExecution` se
mueven por `contactId`. `CustomFieldValue` **no se mueve a ciegas**: se resuelve
por definición y el valor perdedor se guarda entero en el snapshot antes de
borrarse, porque el índice único no admite dos valores del mismo campo.
`Message` y `Note` viajan solas. Los alias que apuntaban al absorbido se
reapuntan al principal para que nunca haya cadenas.

### Contratos

Siete, todos bajo `/contacts` y con rutas de dos segmentos para no chocar con
`GET /contacts/:id`: `:id/duplicados`, `:id/canonico`, `fusion/comparar`,
`fusion/descartar`, `fusion/ejecutar`, `fusion/:mergeId/deshacer` y
`fusion/:mergeId/estado`.

### Pruebas

- **24 e2e contra PostgreSQL real** (`test/contact-fusion.e2e-spec.ts`).
- Caracterización previa de los tres puntos de resolución por identidad.
- Unitarias de permisos y de auditoría sin PII.
- Backend completo: **2149/2149 en 131 suites**; typecheck y lint limpios.

### Interfaz (mockup 22)

| Capa | Archivo |
|---|---|
| Consumidor tipado | `apps/frontend/src/lib/fusion.ts` |
| Flujo completo | `apps/frontend/src/components/contacts/FusionDeDuplicados.tsx` |
| Integración | `apps/frontend/src/app/dashboard/contacts/page.tsx` |

Cuatro pasos: elegir con quién —candidatos con nivel y razón, selección manual
cuando no hay ninguno, «No son duplicados»—, comparar con posibilidad de
invertir el principal, resolver campo por campo y confirmar. Modal encima de
Contactos; ni se rediseña la pantalla ni se duplica el perfil.

**Decisiones de la interfaz:**

- **La cuenta atrás sale de `deshacerHasta`, la marca del servidor.** Restar
  diez minutos desde el navegador enseñaría tiempo restante después de que la
  ventana hubiera vencido. Una marca ilegible se trata como vencida.
- **La selección vive en la URL** (`?fusionar=` y `?con=`): una recarga a mitad
  de la comparación vuelve a la misma pareja.
- **Un enlace a un contacto absorbido se reescribe por el canónico** contra
  `/:id/canonico`, con `replace` para no dejar la ruta muerta en el historial.
  La condición `canonicoId !== id` corta el bucle.
- **Invertir el principal descarta las decisiones ya tomadas**: se tomaron
  respecto al principal y arrastrarlas sería aplicar algo que nadie eligió.
- **El alias y la redirección se enseñan como garantías, no como
  interruptores.** El backend no ofrece apagarlos. Solo «conservar identidades
  alternativas» es una casilla, porque `conservarAlternativas` sí existe.
- **No se enseñan consentimientos** ni se promete restaurar desde Auditoría.

### Pruebas de frontend

**667 en 71 archivos** (+40). 36 nuevas: cuenta atrás del servidor, traducción
de 409, roles, flujo de cuatro pasos, cambio de principal, decisiones campo por
campo, identidades alternativas, etiquetas, campos personalizados, «no son
duplicados», confirmación explícita, éxito y URL canónica, deshacer disponible,
vencido y bloqueado, foco, Escape y aviso antes de perder elecciones. En la
pantalla: acción visible para ADMIN y no para AGENT, enlace absorbido
reescrito, y un id no absorbido que **no** provoca redirección.

Escribirlas encontró dos defectos de producto, corregidos: un mensaje de
reversión bloqueada que se enseñaba dos veces y una etiqueta de campo que el
lector de pantalla leía tres veces.

### QA de navegador

Contra el build de producción, con el arnés CDP y `deviceScaleFactor: 1`.

| Ancho | Desborde horizontal | Del diálogo | Zonas de desplazamiento | Consola |
|---|---|---|---|---|
| 1920 | 0 | 0 | 0 | sin errores ni avisos |
| 1440 | 0 | 0 | 0 | sin errores ni avisos |
| 1280 | 0 | 0 | 0 | sin errores ni avisos |
| 1024 | 0 | 0 | 0 | sin errores ni avisos |

Medido en los cuatro pasos del flujo, no solo al abrir. **El documento nunca
desplaza**: `html` no aparece como zona en ninguna medición.

**Zoom 200 %** (viewport de 960 y 640 px, que es 1920 y 1280 al doble):
desborde horizontal 0, y tres zonas de desplazamiento **independientes y
correctas** —el menú lateral, el contenido de la página y el cuerpo del
diálogo—. No son dos barras compitiendo por lo mismo: el documento sigue sin
desplazarse y la acción principal queda visible en el pie fijo del diálogo.

**La QA no fusionó nada**: recorre los cuatro pasos y cancela.

### Datos QA para la revisión

Creados **solo** en la empresa de la vista previa
(`cmsoy6e7l0008v2fsvfa1xiur`), con prefijo `QA_MERGE_` y datos íntegramente
ficticios: teléfonos de rango de pruebas y correos en `example.invalid`, que la
RFC 2606 reserva para que nunca resuelvan. Sin integración de WhatsApp, sin
envíos, sin bots.

| Objeto | Id |
|---|---|
| Contacto principal (activo) | `cmss4x9a50003v2v0ndielk7d` |
| Contacto duplicado (archivado) | `cmss4x9af0005v2v0y1jb80ik` |
| Definición de campo personalizado | `cmss4x99v0001v2v0xe608z6k` |
| Valor del principal | `cmss4x9am0007v2v0wlsv9hpg` |
| Valor del duplicado | `cmss4x9au0009v2v0omcdqsh1` |
| Conversación | `cmss4x9az000bv2v06kp0yizx` |
| Mensajes | `cmss4x9b7000dv2v0fglfvmi4`, `cmss4x9bg000fv2v0ymtt32z4`, `cmss4x9bl000hv2v0m23wnsc1` |
| Oportunidad | `cmss4x9br000jv2v0amjs3oww` |
| Tarea | `cmss4x9c1000lv2v0ko0bk7sk` |
| Cotización (la relación documental real) | `cmss4x9c9000nv2v0gmecmyyp` |
| Nota | `cmss4x9ci000pv2v0g3t0q1tn` |
| Auditoría del archivado | `cmss4x9cq000rv2v07yb0e8lf` |

Diferencias controladas: el duplicado lleva **el mismo número escrito de otra
forma** (`300 111 0101` frente a `+573001110101`), lo que da coincidencia
fuerte y una fila «Coincide · Mismo número en formato E.164»; correo distinto,
una etiqueta compartida y otra propia, y un campo personalizado con valor
distinto que obliga a decidir.

**No hay modelo `Document` en el repositorio**: el documento real del producto
es el PDF de una cotización, así que la relación documental que se sembró es la
cotización.

**La pareja NO está fusionada**: `contact_merges` = 0,
`contact_merge_dismissals` = 0 y ningún contacto con `mergedIntoId`. Queda
lista para recorrerla.

**Ruta para empezar la revisión:**
`http://localhost:3000/dashboard/contacts?fusionar=cmss4x9a50003v2v0ndielk7d`

Los cinco contactos `PREVIEW_BRANDING_` y los objetos `sd`, `sfg`, `daa` y
Fernanda quedaron intactos.

### Limitaciones honestas de lo entregado

- **El teléfono principal se puede intercambiar, y eso mueve el número del
  duplicado.** Es correcto —ambas fichas son la misma persona y ningún número
  se pierde—, pero conviene saberlo: tras elegir el teléfono del duplicado, el
  alias se queda con el del principal.
- **La ventana de deshacer no se puede ampliar.** El mockup promete además que
  «después, un administrador podrá restaurarla desde Auditoría»: eso **no
  existe** y la interfaz no debe prometerlo.
- **`snapshot` conserva los valores escalares previos** mientras viva la fila
  de `contact_merges`. Es lo que hace posible deshacer; no se purga al vencer
  la ventana, y eso es una decisión de retención que conviene revisar.
- **Los candidatos se calculan sobre 500 contactos como mucho**, comparando en
  memoria por forma canónica. Suficiente para el volumen actual; con carteras
  grandes habrá que medirlo.

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
| `20260813221223_fusion_contactos_duplicados` | ✅ | ✅ | ❌ | no hace falta | forward-only; revertir exigiría una migración nueva |

La de 3.x se probó en base **limpia** (57 migraciones desde cero) y sobre una
**copia representativa** restaurada de un respaldo `pg_dump` tomado antes de
aplicarla: 19 contactos, 11 conversaciones, 26 mensajes, 18 oportunidades, 14
tareas, 12 cotizaciones y 349 auditorías idénticos antes y después, 0 arrays en
NULL y los 5 contactos `PREVIEW_BRANDING_` intactos. Sin `migrate reset`, sin
`db push`, sin seed.

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
| 2026-08-12 | 2.2 | CI sobre `821da8d` | ❌ **Frontend falló** en «Typecheck (incluye tests)» |
| 2026-08-12 | 2.2 | CI sobre `199bcac` | ver «Cierre del incremento» |
| 2026-08-13 | 2.3 | CI sobre `25cf639` | Backend y Frontend `success` |
| 2026-08-13 | 2.3 (doble scroll) | `vitest run` (frontend completo) | **623/623** en 69 archivos (+4, +1 archivo) |
| 2026-08-13 | 2.3 (doble scroll) | `npm run typecheck` + `npm run lint` + `npm run build` | sin errores (1 warning previo) |
| 2026-08-13 | 2.3 (doble scroll) | backend `tsc --noEmit` + `npx jest` | **2137/2137** en 129 suites, sin cambios |
| 2026-08-13 | 2.3 (doble scroll) | Mediciones DOM 1920/1536/1440/1280/1024 | una sola zona desplazable en los cinco |
| 2026-08-13 | 2.3 (doble scroll) | CI sobre `f133e69` | Backend y Frontend `success` |
| 2026-08-13 | 2.3 (retícula) | `vitest run` (frontend completo) | **627/627** en 69 archivos (+4) |
| 2026-08-13 | 2.3 (retícula) | `typecheck` + `lint` + `build` | sin errores (1 warning previo) |
| 2026-08-13 | 2.3 (retícula) | Huecos 1920/1536/1440/1280/1024 | 273 → 16 px; 535 → 67 px a 1024 |
| 2026-08-13 | 2.3 (retícula) | Estados: escaso, carga y seis paneles en error | sin huecos, solapes ni desbordes |
| 2026-08-13 | 2.3 | CI sobre `1d16fae` | **run `31746787438`** — Backend y Frontend `success` |
| 2026-08-13 | 2.3 | **Revisión humana sobre `1d16fae`** | **APROBADO** — ver «Aprobación humana» |
| 2026-08-13 | 3.x | `npx jest` (backend completo) | **2149/2149 en 131 suites** (+12, +2 suites) |
| 2026-08-13 | 3.x | `npx jest --config test/jest-e2e.json contact-fusion` | **24/24 contra PostgreSQL real** |
| 2026-08-13 | 3.x | `tsc --noEmit` + `eslint` backend | sin errores |
| 2026-08-13 | 3.x | Migración en base limpia y en copia representativa | sin pérdida; conteos idénticos |
| 2026-08-13 | 3.x | CI sobre `6a1be9e` | Backend y Frontend `success` (run 31750534144) |
| 2026-08-13 | 3.x | `vitest run` (frontend completo) | **667/667** en 71 archivos (+40) |
| 2026-08-13 | 3.x | `typecheck` + `lint` + `build` frontend | sin errores (1 warning previo) |
| 2026-08-13 | 3.x | QA de navegador 1920/1440/1280/1024 y zoom 200 % | sin desbordes ni errores de consola |

---

## QA visual desktop

| Pantalla | 1920 | 1440 | 1280 | 1024 | Teclado | Consola | Estado |
|---|---:|---:|---:|---:|---:|---:|---|
| Búsqueda global (paleta) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **HECHO** |
| Crear rápidamente + recientes | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **HECHO** |
| Inicio (mockup 01, incremento 2.3) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **HECHO** · aprobado 13-ago-2026 |
| Fusión de duplicados (mockup 22, 3.x) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **EN REVISIÓN HUMANA** |
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

> **QA de anchos del Inicio: tres de cuatro, y conviene decir por qué falta uno.**
> Medido en navegador real contra el build de producción, no deducido del
> código:
>
> | Comprobación | 1440 | 1280 | 1024 | 1536* |
> |---|---|---|---|---|
> | Desborde horizontal del documento | ✅ | ✅ | ✅ | ✅ |
> | Cifras cortadas | ✅ | ✅ | ✅ | ✅ |
> | Titulares o celdas cortadas | ✅ | ✅ | ✅ | ✅ |
> | Controles sin nombre accesible | ✅ | ✅ | ✅ | ✅ |
> | Clases de color genéricas en el DOM | ✅ | ✅ | ✅ | ✅ |
> | Regiones con nombre (7) | ✅ | ✅ | ✅ | ✅ |
> | `role=alert` / `aria-busy` colgados | ✅ | ✅ | ✅ | ✅ |
>
> \* 1536 px es el ancho **más amplio alcanzable redimensionando la ventana en
> este equipo**. La pantalla es de 1920 px físicos con escalado de Windows al
> 125 %, así que el viewport CSS máximo de una ventana normal es 1536.
>
> **1920 px CSS ya está medido, y sin tocar el escalado del equipo.** Lo que
> faltaba no era la pantalla sino el método: se levanta Chrome con
> `--force-device-scale-factor=1` y se fija el viewport exacto por CDP con
> `Emulation.setDeviceMetricsOverride`, que es lo que usa el panel de
> dispositivos de DevTools. No instala nada —Node 24 ya trae `WebSocket`— y da
> los cinco anchos con las mismas cifras que el navegador real allí donde ambos
> llegan: a 1536 los dos dan cabecera de 1296 px, una sola zona desplazable y
> documento sin desbordar. El arnés vive fuera del repositorio, en el
> directorio temporal de la sesión; no es código de producto.
>
> **El barrido encontró tres recortes reales** (`84772f7`), todos invisibles
> leyendo el código: la cifra de la métrica a 1280, el titular del panel de
> conversaciones a 1280 y el saludo del hero a 1024. El ancho más apretado
> resultó ser **1280**, no 1024, porque es donde `xl` mete las cuatro tarjetas
> en una fila.

> **Doble barra de desplazamiento: antes y después.** Viewport de 1000 px de
> alto en los cinco anchos. «Barra doc.» es `innerWidth − clientWidth`, es
> decir, los píxeles que se comía la segunda barra.
>
> | Ancho CSS | Exceso vertical del documento | Barra doc. | Zonas desplazables | Absolutos fugados de `main` |
> |---|---|---|---|---|
> | 1920 | 67 → **0** | 15 → **0** | 2 → **1** | `caption.sr-only` → **ninguno** |
> | 1536 | 85 → **0** | 15 → **0** | 2 → **1** | `caption.sr-only` → **ninguno** |
> | 1440 | 85 → **0** | 15 → **0** | 2 → **1** | `caption.sr-only` → **ninguno** |
> | 1280 | 85 → **0** | 15 → **0** | 2 → **1** | `caption.sr-only` → **ninguno** |
> | 1024 | 532 → **0** | 15 → **0** | 2 → **1** | `caption.sr-only` → **ninguno** |
>
> En los cinco: desbordamiento horizontal **0** antes y después, y el contenido
> del Inicio se recorre hasta el final dentro de la única zona que queda. El
> exceso crece a 1024 porque la retícula se apila y la tabla equivalente baja.
> En el navegador real a 1536 —con barras clásicas y ventana maximizada— el
> mismo defecto medía **388 px** de exceso con el viewport a 695 px de alto.
>
> **Apertura y cierre de la paleta y de los modales, a 1536:** ancho útil,
> cabecera y contenido quedan en 1536/1296/1296 px con la paleta abierta,
> cerrada y antes de abrirla; salto medido **0 px** en las tres medidas, y la
> posición de desplazamiento de `main` se conserva. Antes, abrir la paleta
> movía cabecera y contenido de 1281 a 1296 px.
>
> **Ninguna otra pantalla cambia.** Comprobadas a 1536 px con el mismo arnés:
> pipeline, conversaciones, tareas, contactos, productos, cotizaciones, bots y
> empresa. Cero desbordamiento vertical y horizontal del documento y cero
> absolutos fugados en todas.

> **Huecos de la retícula: antes y después.** «Hueco» es la distancia del fondo
> de un panel al techo del panel más cercano que quede por debajo y solape
> horizontalmente con él, aunque no compartan borde izquierdo. El separador
> legítimo de la retícula es 16 px; todo lo que exceda es fondo vacío.
>
> | Ancho CSS | Hueco máximo | Dónde estaba | Alto del contenido |
> |---|---|---|---|
> | 1920 | 273 → **16** | bajo Conversaciones | 1118 → 1118 |
> | 1536 | 273 → **16** | bajo Conversaciones (y 192 bajo Agenda) | 1136 → 1136 |
> | 1440 | 273 → **16** | ídem | 1136 → 1136 |
> | 1280 | 254 → **16** | ídem | 1136 → 1136 |
> | 1024 | 535 → **67** | media fila vacía junto a la Agenda | 1892 → **1472** |
>
> De 1280 en adelante no queda ningún hueco por encima del separador. A 1024 el
> resto son **51, 49 y 46 px** de diferencia natural entre los dos paneles que
> comparten fila en una disposición de dos columnas: con tres columnas a ese
> ancho cada una se quedaría en 234 px y no cabrían ni la tabla de rendimiento
> ni las filas del embudo. Además el contenido se acorta 420 px, que es
> desplazamiento que el usuario ya no hace.
>
> En los cinco anchos, antes y después: **cero solapamientos**, **cero
> desbordamiento horizontal**, y sigue habiendo **una sola zona desplazable**
> (`main`).
>
> **Estados comprobados.** Contenido escaso, que es el de la vista previa: una
> conversación, tres tareas, cuatro registros de actividad y «Rendimiento por
> asesor» ya en su estado honesto de «sin responsable». Carga con esqueletos, y
> los **seis paneles en error a la vez** (bloqueando `analytics`,
> `conversations/inbox` y `tasks` en la red): los seis quedan a 146 px a 1536 y
> a 166 px a 1024, con separación de 16 px, sin solapes ni desbordes. El caso
> «sin permiso» se fija en las pruebas, no en el navegador: para un rol sin
> métricas el Inicio ni siquiera consulta `analytics`, así que lo que hay que
> garantizar es estructural —que no se reserve la columna vacía— y eso es
> exactamente lo que comprueba la prueba nueva.

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

## Una lección del CI que conviene no repetir

El CI falló en `821da8d` con las 539 pruebas en verde. El paso que cayó fue
**«Typecheck (incluye tests)»**: un `vi.fn` tipado como `(...a: unknown[])` con
`a as []` hace que TypeScript deduzca una tupla de longitud **cero**, y
entonces `mock.calls[0][0]` no existe.

**Por qué se escapó en local.** Tras crear el último archivo de prueba se
ejecutaron `vitest`, `eslint` y `next build` —ninguno comprueba los tipos de
los archivos de prueba— pero no `npm run typecheck`, que es exactamente el paso
que lo ve.

**Regla para los próximos incrementos:** antes de publicar, reproducir la
secuencia del CI **en su orden y con sus comandos**:

```bash
cd apps/frontend
npm test && npm run typecheck && npm run lint && npm run build
```

No basta con `npx tsc --noEmit` a mitad del trabajo: hay que volver a
ejecutarlo **después del último archivo tocado**, incluidos los de prueba.

---

## Próximo incremento seguro: `3.x — Fusión de contactos duplicados`

**Registrado, no iniciado.** Mockup 22. Es el **único FALTANTE puro** del
semáforo —no existe ni endpoint ni UI— y el resto de la fase 3 (listado,
papelera, restauración y perfil) ya está.

Antes de escribir una línea hay que resolver el gap que ya figura en «Gaps que
requieren decisión de producto»: **qué campo gana ante conflicto y si el
contacto absorbido queda como alias o desaparece**. El §4.1 del master exige
además vista previa, elección del valor por campo, traslado transaccional de
las relaciones, alias/redirección y auditoría, y prohíbe borrar conversaciones
para «limpiar» un contacto.

Su diseño y su implementación **no se redactan aquí**: se abren cuando se
arranque el incremento, con su propio preflight §2.

---

## Próximo comando seguro

```bash
# Desde la raíz del repositorio:
git status --short --branch
git rev-parse HEAD
git rev-parse origin/feature/takto-brand-ui-integration
# 2.1, 2.2 y 2.3 estan APROBADOS: la fase 2 esta HECHA.
# 3.x - Fusion de contactos duplicados: ENTREGADO, EN REVISION HUMANA.
# No abrir el incremento siguiente hasta que haya veredicto.
#
# Ruta para revisar el flujo con los datos QA_MERGE_:
#   http://localhost:3000/dashboard/contacts?fusionar=cmss4x9a50003v2v0ndielk7d
#
# La pareja QA_MERGE_ NO esta fusionada. Tras la aprobacion se limpia SOLO por
# id (ver la seccion de datos QA), conservando las auditorias.
#
# Vista previa local (worker apagado, transporte falso, sin efectos externos):
#   cd apps/backend  && node dist/src/main        # :3001, con las variables
#   cd apps/frontend && npx next start -p 3000    # :3000
```
