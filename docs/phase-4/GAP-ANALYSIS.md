# Fase 4 — Análisis de brechas

Base inspeccionada: `origin/main` `b01a2ec` (2026-09-04; incluye los merges de
los PR #24 y #25). Worktree `../Tehus_Rattan-phase-4`, rama
`feat/phase-4-dynamic-crm`. Línea base de pruebas antes de tocar código:
backend 147 suites / 2415 unitarias y 70 suites / 1039 e2e (PostgreSQL y Redis
reales, en serie); frontend 107 ficheros / 1081 pruebas. Todo en verde.

Estados: `HECHO` (ya cumple), `PARCIAL` (existe pero incompleto o solo visual),
`FALTANTE` (no existe), `FUERA DE FASE` (documentado como deuda).

## 1. Cómo se representan hoy los módulos, el catálogo y los pipelines

- **Configuración**: `Company.settings` (JSON v0 = sin settings, v1 = banderas
  planas, v2 = `{version, commercial, catalog, vertical?, pipelineDefaults?}`) se
  normaliza en `company-settings.ts#parseCompanySettings` y se expone como
  `TenantConfigurationV1` (`tenant-configuration.ts`) a través de
  `TenantConfigurationService` (`GET/PATCH /companies/me/configuration`,
  transacción con `FOR UPDATE`, auditoría `company.configuration.update`).
- **Módulos**: `modules.{conversations,contacts,opportunities,pipeline}` son
  literales `true`; `modules.{catalog,quotes,tasks}` derivan de
  `commercial.uses{Catalog,Quotes,Tasks}`. `DEFAULT_COMMERCIAL` pone las cinco
  banderas en `false`, así que una empresa **v0 (sin settings) hoy aparece sin
  catálogo, sin cotizaciones y sin tareas** aunque tenga productos, cotizaciones
  y tareas reales (en staging: la empresa demo; en local: todas las empresas
  anteriores a la Fase 1). Nada consume esas banderas fuera de
  `companies/` y `onboarding/`: ningún controlador ni pantalla las aplica.
- **Catálogo**: tabla `Product`, API `/products`, `itemType` nullable
  (`NULL` → `PRODUCT` vía `effectiveItemType`). El backend no comprueba el
  modelo comercial: una empresa «solo servicios» puede crear `PRODUCT`. No hay
  lista global de categorías (las de muebles solo existen en pruebas); las
  categorías son texto libre y la lista por empresa vive en
  `settings.catalog.categories`.
- **Pipelines**: módulo `pipeline/` con CRUD de pipelines y etapas, default con
  transacción + índice parcial único `pipelines_one_default_per_company`,
  archivar/restaurar/reordenar, traslado de oportunidades y bloqueo de borrado
  con leads. Las invariantes de etapas (≥1 OPEN, exactamente 1 WON y 1 LOST,
  nombres únicos, longitud) solo se aplican en el onboarding
  (`validateTypedStages`), no en `PipelineService`. El pipeline efectivo se
  resuelve por `CompanyLeadSettings.defaultPipelineId` → `isDefault` → primero
  activo; no hay IDs globales ni de Tehus en el código.
- **Frontend**: `Sidebar.tsx` con lista estática, «Crear» y buscador comparten
  `PaletaDeBusqueda` con acciones estáticas por rol (`creacion-rapida.ts`),
  dashboard con widgets fijos; `useTenantConfiguration` solo se usa en la
  página de productos y en la sección de configuración. Sin route guards por
  módulo, sin código de error `MODULE_DISABLED`.

## 2. Matriz requisito → estado → brecha → acción → prueba

| # | Requisito (prompt) | Estado en `main` | Evidencia | Brecha | Acción Fase 4 | Prueba |
|---|---|---|---|---|---|---|
| 1 | Registro canónico de capacidades (`resolveEffectiveTenantCapabilities`) | FALTANTE | `deriveModules` solo mapea banderas; sin registro con rutas/API/nav/dependencias | Comprobaciones dispersas serían inevitables | `companies/tenant-capabilities.ts`: `CAPABILITY_REGISTRY` tipado + `resolveEffectiveCapabilities(settings)`; `TenantConfigurationV1.capabilities` | unit `tenant-capabilities.spec.ts`, contrato JSON |
| 2 | Defaults legacy que no hagan desaparecer módulos | FALTANTE | `DEFAULT_COMMERCIAL` todo `false`; staging demo v0 con 3 productos/2 cotizaciones/3 tareas | Una v0 perdería catálogo, cotizaciones y tareas al activar los guards | v0 → módulos opcionales activos; v1 sin bandera → activo; v2 respeta lo guardado; el PATCH fusiona sobre los flags **efectivos** para no apagar módulos por accidente | unit + e2e `capabilities-legacy` |
| 3 | Navegación solo con módulos disponibles (sidebar, móvil, Crear, buscador, dashboard, atajos) | FALTANTE | `Sidebar.tsx:96-136` estático; `creacion-rapida.ts` por rol; `TIPOS_BUSCABLES` fijo; dashboard con `AgendaDeHoy` siempre | Módulos inactivos visibles y consultados | `lib/navigation.ts` + `TenantCapabilitiesProvider` + `useTenantCapabilities`; filtrar acciones, tipos de búsqueda y widgets; sin parpadeo (opcionales ocultos hasta tener configuración) | Vitest shell/palette/dashboard |
| 4 | Ruta directa bloqueada en frontend (ADMIN con enlace a configuración; AGENT respuesta segura) | FALTANTE | Páginas `products`, `quotes`, `quotes/[id]`, `tasks` sin guard | Deep link muestra el módulo | `RequireTenantCapability` en esas páginas; sin queries del módulo mientras no haya capacidad; estados loading/error | Vitest ADMIN/AGENT |
| 5 | API bloqueada por capacidad, error estable, `companyId` del JWT | FALTANTE | Sin guard de módulo; `products`, `quotes`, `tasks`, `leads/:id/products`, `search` abiertos | Manipular el frontend evita la restricción | `@RequiresTenantCapability` + `TenantCapabilityGuard` (403 `code: MODULE_DISABLED`, `module`), matriz en `MODULE-MATRIX.md`; búsqueda filtra tipos; configuración excluida | e2e `module-guard` |
| 6 | Administración de módulos por ADMIN (activar/desactivar, dependencias, confirmación, auditoría, sin borrar datos) | PARCIAL | `TenantConfigurationSection` ya alterna `catalog/quotes/tasks`; auditoría existe | Sin descripciones/dependencias, sin confirmación de impacto, sin actualización canónica inmediata de la navegación | Registro con descripciones; `setQueryData` con la respuesta del servidor; confirmación al desactivar; dependencia catálogo↔cotizaciones (ver §3) | Vitest settings + e2e preservación de datos |
| 7 | Catálogo unificado: productos / servicios / mixto; tipo permitido validado en backend | PARCIAL | `itemType` existe; UI muestra «Nuevo elemento» siempre; backend no valida modelo comercial; `CreacionRapida` crea sin `itemType` ni categorías | Empresa «solo servicios» puede crear `PRODUCT` | Backend: tipos permitidos = f(businessModel) (`services`→SERVICE, `products`→PRODUCT, mixto/desconocido→ambos), default efectivo; validación en crear/editar/importar; frontend: etiquetas, selector, filtros y vacíos según modelo; elementos heredados visibles con aviso | unit products, e2e `catalog-item-type-by-model`, Vitest |
| 8 | `itemType: null` explícito inválido; omitido → default efectivo | HECHO/PARCIAL | `@ValidateIf` rechaza `null`; default fijo `PRODUCT` | Default debería ser SERVICE en «solo servicios» | Default efectivo desde capacidades | e2e |
| 9 | Categorías por empresa en todas las superficies | HECHO (mayormente) | Sin lista global; página de productos y `AddProductToLeadModal` usan `useCompanySettings` | `CreacionRapida`→`ProductModal` sin categorías; categoría heredada no marcada | Pasar categorías al modal de creación rápida; distinguir «heredada» en filtros/badges | Vitest |
| 10 | Pipeline del onboarding es el real; sin defaults de Tehus | HECHO | `findPipeline` por `isDefault` → orden; `lead-settings.service` en cascada; grep sin IDs | `CreacionRapida` usa `embudos[0]` en vez del default | Usar el pipeline `isDefault` (o primero determinista) | Vitest |
| 11 | Selector de pipeline tenant-scoped | HECHO | `PipelineSelector` + URL `embudo`; fallback default→primero | — | Sin cambios funcionales; documentar | existente |
| 12 | Gestión de pipelines: listar/crear/renombrar/default/etapas/reordenar/archivar | PARCIAL | `PipelineService` + `AdminPipelines.tsx` | Sin invariantes (WON/LOST únicos, ≥1 OPEN, nombres únicos, longitud, orden continuo y completo), sin auditoría de etapas, sin bloqueo por concurrencia de orden, DTOs sin `MaxLength`/`IsNotEmpty` | Invariantes «nunca peor que antes» (no quitar el último WON/LOST/OPEN, no duplicar WON/LOST), nombres únicos sin distinguir mayúsculas, reordenamiento completo y contiguo con bloqueo de fila, 409 en carrera de default, auditoría `pipeline.*`/`pipeline.stage.*` sin payloads | unit + e2e `pipeline-invariantes` |
| 13 | No eliminar pipelines/etapas con leads; sin migración masiva | HECHO | `remove`/`removeStage` bloquean con conteo; `retiro` explica | — | Conservar; cubrir en e2e | existente + e2e |
| 14 | AGENT no modifica módulos ni estructura de pipeline | HECHO | `@Roles('ADMIN','SUPER_ADMIN')` en PATCH configuración y escrituras de pipeline | — | Cubrir en e2e de la fase | e2e |
| 15 | Formularios, ejemplos y estados vacíos pertinentes | PARCIAL | `LeadFormModal` placeholder «Venta de muebles de rattan»; vacíos genéricos | Texto de muebles fuera de su plantilla | Textos por modelo/vertical desde la configuración; vocabulario base intacto | Vitest «sin términos de muebles» |
| 16 | Dashboard y «Crear» dinámicos | FALTANTE | Métrica/widget de tareas y acciones fijas | Widgets de módulos inactivos | Ocultar `AgendaDeHoy`, métrica de tareas y acciones según capacidades; sin consultas de módulos inactivos | Vitest dashboard |
| 17 | Aislamiento multiempresa | HECHO | Guards + `where companyId` + e2e existentes | — | Añadir casos con módulos e IDs ajenos | e2e |
| 18 | Tehus y empresas legacy operan igual | RIESGO | Tehus staging v1 con las tres banderas `true`; demo v0 | Sin la regla legacy, la demo perdería módulos | Regla legacy + evidencia antes/después en staging (lectura) | e2e legacy + staging |
| 19 | Migraciones | HECHO | El modelo ya soporta todo | Ninguna necesaria | Sin migración | `prisma validate`, `migrate status` |
| 20 | Caché de configuración | FALTANTE | Sin caché; una consulta por petición | Coste por petición del guard | Caché en memoria por `companyId` (TTL corto) invalidada al escribir, con pruebas | unit |
| 21 | SUPER_ADMIN de plataforma conserva su navegación | HECHO | `isPlatformSuperAdmin` en layout y sidebar | — | No consultar configuración de tenant para plataforma | Vitest |
| 22 | Formato de moneda por región (`es-CO`/`COP` fijos en productos, cotizaciones, dashboard) | FUERA DE FASE | Hardcode en 4 pantallas | Presentación regional | Deuda registrada (Fase 5 / regional) | — |
| 23 | Backfill `itemType`, migración de empresas, editor de plantillas, billing, automatizaciones por etapa | FUERA DE FASE | — | — | Documentado en `README.md` | — |

## 3. Dependencias entre módulos según el modelo real

- `QuotesService.createFromLead` exige `LeadProduct` en la oportunidad
  (`quotes.service.ts:118-130`): **crear** una cotización necesita elementos
  del catálogo adjuntos a la oportunidad. Leer, enviar, aceptar o rechazar
  cotizaciones existentes no necesita el catálogo.
- Las plantillas v3 `services`, `interior_design`, `consulting`, `agency` y
  `projects` activan `quotes` con `catalog: false` a propósito. Por tanto la
  dependencia **no es dura**: no se rechaza esa combinación. Se modela como
  dependencia de creación: el registro declara `quotes.relatedTo: ['catalog']`,
  la UI de cotizaciones avisa cuando el catálogo está inactivo, y el endpoint
  `leads/:leadId/products` queda gobernado por `catalog`.
- `tasks` no depende de nada; `catalog` no depende de nada.

## 4. Decisiones de diseño

1. **Efectivo ≠ guardado**: `resolveEffectiveCapabilities` aplica la regla
   legacy (v0 → opcionales activos; v1 con bandera ausente → activo; v2 tal
   cual) y la expone en `TenantConfigurationV1.modules` y `.capabilities`
   (`legacyDefaultsApplied`, tipos de catálogo permitidos y por defecto,
   relaciones). El PATCH fusiona sobre los flags efectivos.
2. **Guard central**: `TenantCapabilityGuard` lee `companyId` solo de
   `req.user`, resuelve la configuración (caché corta por empresa) y responde
   `403 { code: 'MODULE_DISABLED', module }`. Se aplica a `products` (incluida
   importación), `quotes`, `tasks` (+ sugerencias), `leads/:leadId/products`;
   la búsqueda filtra tipos. Configuración, auth, empresa y plataforma quedan
   fuera.
3. **Catálogo**: tipo permitido derivado del modelo comercial; filas heredadas
   siempre visibles.
4. **Pipelines**: invariantes «nunca peor que antes», bloqueo de fila en
   reordenamientos, 409 en carreras de default, auditoría de etapas.
5. **Frontend**: un proveedor de capacidades, un módulo de navegación
   declarativo, `RequireTenantCapability` y helpers de etiquetas por modelo.

Sin secretos en este documento.
