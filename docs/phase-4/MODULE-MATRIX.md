# Fase 4 — Matriz módulo / configuración / navegación / ruta / API / rol

Leyenda de comportamiento con el módulo **desactivado**: `Oculto` = no aparece;
`403 MODULE_DISABLED` = la API responde ese código estable; `Pantalla` = el
frontend muestra la pantalla de módulo inactivo (ADMIN: explicación + enlace a
Configuración + «Activar módulo»; AGENT/MANAGER: mensaje neutral sin enlaces ni
datos). Legacy = empresa que nunca declaró la bandera (v0 o v1 sin ella).

| Capacidad | Configuración (`settings.commercial`) | Navegación / Crear / Buscador / Dashboard | Ruta frontend | Endpoints backend | Roles | Dependencias | Desactivado | Legacy |
|---|---|---|---|---|---|---|---|---|
| `conversations` | fija (`true`) | Sidebar «Conversaciones»; búsqueda `conversaciones` | `/dashboard/conversations` | `/conversations/**`, `/messages/**` | cualquier rol de empresa | — | n/a | n/a |
| `contacts` | fija | Sidebar «Contactos»; Crear «Contacto»; búsqueda `contactos` | `/dashboard/contacts/**` | `/contacts/**` | cualquier rol | — | n/a | n/a |
| `opportunities` | fija | Crear «Oportunidad»; búsqueda `oportunidades`; métricas del dashboard | (dentro de `/dashboard/pipeline`) | `/leads/**` (salvo `/leads/:id/products`) | cualquier rol | — | n/a | n/a |
| `pipeline` | fija | Sidebar «Pipeline»; widgets Embudo comercial y métricas | `/dashboard/pipeline` | `/pipelines/**` (escrituras ADMIN/SUPER_ADMIN) | lectura: cualquier rol; estructura: ADMIN/SUPER_ADMIN | — | n/a | n/a |
| `catalog` | `usesCatalog` | Sidebar «Catálogo» (Oculto); Crear «Nuevo producto/servicio/elemento» (Oculto); búsqueda `productos` (Oculto y filtrado en servidor) | `/dashboard/products` → Pantalla | `GET/POST /products`, `PATCH/DELETE /products/:id`, `/products/import/**`, `GET/POST/PATCH/DELETE /leads/:leadId/products/**` → 403 MODULE_DISABLED | lectura: cualquier rol; escritura: ADMIN/SUPER_ADMIN (sin cambios) | — (relacionado desde `quotes`) | Oculto + Pantalla + 403; datos intactos | activo |
| `quotes` | `usesQuotes` | Sidebar «Cotizaciones» (Oculto); Crear «Cotización» (Oculto); búsqueda `cotizaciones` (Oculto/filtrado) | `/dashboard/quotes`, `/dashboard/quotes/[id]` → Pantalla | `/quotes/**` → 403 MODULE_DISABLED | cualquier rol de empresa (sin cambios) | `relatedTo: catalog` (crear exige elementos adjuntos; aviso en la UI si el catálogo está inactivo) | Oculto + Pantalla + 403; cotizaciones intactas | activo |
| `tasks` | `usesTasks` | Sidebar «Tareas» (Oculto); Crear «Tarea» (Oculto); dashboard: métrica de tareas y «Agenda de hoy» (Ocultos, sin consultas) | `/dashboard/tasks` → Pantalla | `/tasks/**`, `/task-suggestions/**` → 403 MODULE_DISABLED | cualquier rol; sugerencias según sus roles actuales | — | Oculto + Pantalla + 403; tareas intactas | activo |

## Fuera del guard (siempre accesibles con sesión de empresa)

| Ruta / endpoint | Motivo |
|---|---|
| `GET/PATCH /companies/me/configuration`, `/companies/me/settings`, `PATCH /companies/me`, `POST /companies/me/logo` | Necesarios para reactivar módulos y administrar la empresa. PATCH exige ADMIN/SUPER_ADMIN. |
| `/auth/**`, `/users/**`, `/notifications/**`, `/analytics/**` | Plataforma / perfil / métricas (los widgets del frontend ya no consultan tareas si el módulo está inactivo). |
| `/dashboard/platform/**` y su navegación | SUPER_ADMIN de plataforma (sin empresa): no consulta configuración de tenant. |
| Webhooks, workers, automatizaciones, FlowBot | Procesos internos con `companyId` de confianza; no atienden peticiones de usuario. Sin cambios en esta fase. |

## Controlador → capacidad (backend)

| Controlador | Decorador | Guards |
|---|---|---|
| `ProductsController` (`/products`) | `@RequiresTenantCapability('catalog')` | `AuthGuard('jwt')`, `BusinessTenantGuard`, `RolesGuard`, `TenantCapabilityGuard` |
| `LeadProductsController` (`/leads/:leadId/products`) | `catalog` | `AuthGuard('jwt')`, `BusinessTenantGuard`, `TenantCapabilityGuard` |
| `QuotesController` (`/quotes`) | `quotes` | `AuthGuard('jwt')`, `BusinessTenantGuard`, `TenantCapabilityGuard` |
| `TasksController` (`/tasks`) | `tasks` | `AuthGuard('jwt')`, `BusinessTenantGuard`, `TenantCapabilityGuard` |
| `TaskSuggestionsController` (`/task-suggestions`) | `tasks` | `AuthGuard('jwt')`, `BusinessTenantGuard`, `RolesGuard`, `TenantCapabilityGuard` |
| `SearchController` (`/search`) | — (filtra tipos en el servicio) | `AuthGuard('jwt')`, `BusinessTenantGuard`, `RolesGuard` |

## Frontend → capacidad

| Superficie | Mecanismo |
|---|---|
| Sidebar escritorio y móvil | `lib/navigation.ts` (`capability` por ítem) + `visibleNavItems` con `can()`; opcionales ausentes hasta `isReady` |
| Header «Crear» / paleta | `lib/creacion-rapida.ts` (`capability` por acción) filtrado con `can()`; etiqueta del catálogo por `catalogVocabulary` |
| Buscador | tipos filtrados por capacidad antes de pedir y al pintar |
| Dashboard | métrica de tareas y «Agenda de hoy» condicionadas; consultas con `enabled` |
| Rutas | `RequireTenantCapability` en `products`, `quotes`, `quotes/[id]`, `tasks` |
| Configuración | `TenantConfigurationSection` usa `definitions`, confirma al desactivar, aplica la respuesta canónica con `setQueryData` e invalida `['company-me']` |
| Errores | `mensajeDeError` reconoce `code: MODULE_DISABLED` |
