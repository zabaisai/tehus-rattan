# Fase 4 — Matriz de pruebas

Línea base tomada antes de tocar código (2026-09-04, worktree de la fase):
backend 147 suites / 2415 unitarias y 70 suites / 1039 e2e; frontend 107
ficheros / 1081 pruebas. Todo en verde.

## Regresión completa (mismos comandos que el CI)

| Ámbito | Comprobación | Resultado |
| --- | --- | --- |
| Backend | `npx prisma validate` | OK |
| Backend | `npm run typecheck` | OK — 0 errores |
| Backend | `npx eslint "{src,apps,libs,test}/**/*.ts" --no-fix` | OK — 0 errores, 0 avisos |
| Backend | `npm test -- --runInBand` | **153 suites / 2473 pruebas** |
| Backend | `npm run build` (`nest build`) | OK |
| Backend | `npm run test:e2e -- --runInBand` (PostgreSQL y Redis reales) | **72 suites / 1065 pruebas** |
| Frontend | `npx tsc --noEmit` | OK — 0 errores |
| Frontend | `npx eslint src` | 0 errores (2 avisos anteriores a la fase) |
| Frontend | `npx vitest run` | **113 ficheros / 1183 pruebas** |
| Frontend | `npx next build` | OK |
| Prisma | Migraciones nuevas | **ninguna** |

## Requisito → prueba

| Requisito | Pruebas |
| --- | --- |
| Registro canónico de capacidades (forma, vocabulario, vista pública) | `tenant-capabilities.spec.ts` |
| Regla legacy: lo no declarado sigue activo (v0, v1 parcial, v2) | `tenant-capabilities.spec.ts`, `tenant-configuration.capabilities.spec.ts`, `tenant-configuration.spec.ts`, `tenant-configuration.service.spec.ts`, e2e `tenant-capabilities` y `tenant-configuration` |
| Desactivar un módulo no apaga los otros en una empresa legacy | `tenant-configuration.capabilities.spec.ts`, e2e `tenant-capabilities` |
| Caché de capacidades: aislada por empresa, expira, se invalida al escribir | `tenant-configuration.capabilities.spec.ts` |
| Contrato publicado con `capabilities` | `tenant-configuration.contract.spec.ts` (AJV contra el esquema) |
| Guard de módulo: metadato, empresa del token, error estable, clave desconocida | `tenant-capability.guard.spec.ts`, e2e `tenant-capabilities` |
| API bloqueada (catálogo, elementos de oportunidad, cotizaciones, tareas) para ADMIN y AGENT | e2e `tenant-capabilities` |
| La configuración sigue accesible con el módulo desactivado | e2e `tenant-capabilities` |
| Desactivar no borra; reactivar recupera los mismos datos | e2e `tenant-capabilities` |
| AGENT no configura módulos; `companyId` en el cuerpo y claves desconocidas → 400 | e2e `tenant-capabilities` |
| Búsqueda sin los tipos de módulos inactivos, aunque se pidan | `search.capabilities.spec.ts`, e2e `tenant-capabilities` |
| Tipo de catálogo por modelo comercial (crear, editar, omitir, heredado) | `products.item-type-by-model.spec.ts`, e2e `tenant-capabilities`, `products-item-type` |
| Importación: tipo no permitido → fila fallida; vacío → default efectivo | `importacion-item-type.e2e-spec.ts`, `importacion-catalogo.e2e-spec.ts` |
| Aislamiento multiempresa (producto, pipeline, configuración, caché) | e2e `tenant-capabilities`, `pipeline-gestion`, `search-tenant-isolation`, `multitenant-ownership.spec.ts` |
| Invariantes de pipeline (cierre único, «nunca peor», nombres, tope) | `pipeline.invariantes.spec.ts`, e2e `pipeline-gestion` |
| Reordenamiento completo y contiguo | `pipeline.invariantes.spec.ts`, e2e `pipeline-gestion` |
| Concurrencia: dos predeterminados, dos etapas de cierre | e2e `pipeline-gestion` |
| No borrar pipelines ni etapas con oportunidades | `pipeline.service.spec.ts`, `pipeline.invariantes.spec.ts`, e2e `pipeline-gestion`, `pipeline-retiro` |
| AGENT no modifica la estructura del pipeline | e2e `pipeline-gestion` |
| Auditoría de pipelines sin valores sensibles | e2e `pipeline-gestion` |
| Proveedor de capacidades, estados de carga y error | `RequireTenantCapability.test.tsx`, `navigation.test.ts` |
| Navegación filtrada (sidebar, móvil, plataforma) | `navigation.test.ts`, `Sidebar.test.tsx`, `layout.test.tsx` |
| Menú «Crear» y buscador filtrados | `creacion-rapida.test.ts`, `CreacionRapida.test.tsx`, `busqueda.test.ts`, `PaletaDeBusqueda.test.tsx` |
| Dashboard sin widgets ni consultas de módulos inactivos | `dashboard/page.test.tsx` |
| Route guard: ADMIN activa, AGENT respuesta neutral | `RequireTenantCapability.test.tsx`, `tasks/page.test.tsx` |
| Administración de módulos: descripciones, aviso legacy, confirmación, respuesta canónica | `TenantConfigurationSection.test.tsx` |
| Catálogo adaptativo, elementos heredados, categorías del tenant | `products/page.test.tsx`, `page.item-type.test.tsx`, `ProductModal.test.tsx`, `AddProductToLeadModal.test.tsx` |
| Sin términos de muebles en un tenant no relacionado | `lib/__tests__/no-furniture-terms.test.tsx` |
| Pipeline: reordenamiento completo, etiquetas de tipo, límites, errores del servidor | `pipeline.test.ts`, `AdminPipelines.test.tsx` |
| `MODULE_DISABLED` en los mensajes de error | `ListState.test.tsx` |

## QA local con el producto levantado (Chrome headless + CDP, 2026-09-04)

Backend `node dist/src/main` y frontend `next start` con el build de
producción, base local; sin mocks. Cuatro empresas temporales
`QA_PHASE4_<stamp>_{A,B,C,D}` con ADMIN y AGENT cada una, borradas por ID al
final. **172 comprobaciones, 0 fallos, 0 errores de consola.**

| Empresa (ancho) | Configuración | Verificado |
| --- | --- | --- |
| A — Mueblería (1440) | mixta; catálogo, cotizaciones y tareas | Navegación completa; «Catálogo», «Nuevo elemento»; dashboard con Agenda de hoy; pipeline de 7 etapas |
| B — Veterinaria y pet shop (390) | mixta; **sin cotizaciones** | Sin «Cotizaciones» en navegación ni en «Crear»; `/dashboard/quotes` muestra la pantalla de módulo inactivo; API `403 MODULE_DISABLED`; tareas y catálogo intactos; sin términos de muebles |
| C — Software y tecnología (1024) | **solo servicios** | «Catálogo de servicios», «Nuevo servicio», sin selector ni filtro de tipo; la API crea SERVICE al omitir el tipo y rechaza PRODUCT con motivo; pipeline con Descubrimiento |
| D — Genérica (320) | **sin catálogo**, solo productos | Sin «Catálogo» en navegación; ruta directa bloqueada (ADMIN ve explicación, enlace y «Activar módulo»; AGENT mensaje neutral); API 403; búsqueda sin productos |
| D — activar y desactivar | ADMIN | «Activar módulo» muestra el catálogo **sin volver a iniciar sesión**, con el producto que ya existía; desactivar desde Configuración pide confirmación («no borra nada»), la navegación se actualiza y la ruta vuelve a bloquearse |
| ADMIN vs AGENT (4 empresas) | — | El asesor ve los mismos módulos, no ve acciones administrativas y no puede configurar (`403`) |
| Anchos 320 / 390 / 768 / 1024 / 1280 / 1440 | A, ADMIN | 0 scroll horizontal, 0 controles sin nombre, navegación móvil utilizable |
| API | 4 empresas | 403 `MODULE_DISABLED` por módulo y rol; `companyId` en el cuerpo → 400; producto o pipeline de otra empresa → 404; segunda etapa ganada → 400; reordenamiento parcial → 400 y completo → 200; renombrar con el propio nombre → 200 y con uno existente → 400; borrar la única etapa ganada → 400 |
| Verificación en base | 4 empresas | Módulos, categorías, pipelines y tipos correctos; la empresa de servicios sin un solo PRODUCT; la genérica conserva su producto con el catálogo desactivado; auditoría sin secretos |
| Consola / red | — | 0 errores; las únicas respuestas ≥400 son `401 /api/auth/refresh` del arranque anónimo (previo a la fase) y las peticiones en vuelo al cerrar sesión |
| Limpieza | — | 4 empresas, 8 usuarios, 4 pipelines, 25 etapas, 12 productos, 3 tareas, 15 auditorías, 45 sesiones y 45 eventos de login borrados por ID; **0 residuos**; empresas ajenas idénticas (13 empresas, 27 productos, 16 pipelines, 21 usuarios antes y después) |

## Deuda registrada

- `401 /api/auth/refresh` en el arranque anónimo: anterior a la fase.
- Formato de moneda fijo `es-CO`/`COP` en catálogo, cotizaciones y dashboard.
- Backfill de `itemType` y migración de empresas existentes (Fase 5).
- Las e2e del backend en paralelo comparten base; el CI y estas ejecuciones
  usan `--runInBand`, como en fases anteriores.
