# Fase 4 — Catálogo unificado y dinámico

## Concepto

«Catálogo» es el concepto general. Contiene productos, servicios o ambos según
la forma de vender de la empresa (`identity.businessModel`, derivado de
`sellsProducts`/`sellsServices`). Nombres internos que NO cambian: tabla
`Product`, API `/products`, relaciones y migraciones históricas.

## Reglas del backend (fuente: `capabilities.catalog`)

| Modelo | Puede crear | Default si `itemType` se omite | Rechaza |
|---|---|---|---|
| `products` («Solo productos») | `PRODUCT` | `PRODUCT` | `SERVICE` → 400 «Esta empresa vende solo productos…» |
| `services` («Solo servicios») | `SERVICE` | `SERVICE` | `PRODUCT` → 400 «Esta empresa vende solo servicios…» |
| `mixed` o desconocido/legacy | ambos | `PRODUCT` | — |

- `POST /products`, `PATCH /products/:id` (`ProductsService.resolveItemType`):
  validan contra los tipos permitidos de la empresa del token. `itemType: null`
  explícito sigue siendo inválido (`@ValidateIf` del DTO, Fase 2).
- Editar sin tocar `itemType` deja la fila como está, incluida una heredada.
- Importación (`ImportacionDeProductosService`): las reglas del catálogo se
  resuelven una vez por ejecución; una celda con un tipo no permitido marca la
  fila como fallida con el motivo (nunca se convierte en silencio); una celda
  vacía usa el default efectivo al crear y no cambia el tipo al actualizar.
- Filas legacy: `itemType NULL` se expone como `PRODUCT`; un elemento del tipo
  que la empresa ya no crea sigue listándose y editándose. Sin backfill, sin
  ocultar, sin conversión automática (Fase 5).
- Categorías: texto libre acotado (`CATEGORY_LIMITS`), lista por empresa en
  `settings.catalog.categories`. No existe ninguna lista global; los nombres de
  muebles solo aparecen en la plantilla de muebles y en pruebas.

## Frontend (vocabulario por `catalogVocabulary(capabilities.catalog)`)

| Modo | Título | Acción | Selector Producto/Servicio y filtro por tipo | Vacío |
|---|---|---|---|---|
| `products` | Catálogo de productos | Nuevo producto / Editar producto | ocultos | «Todavía no hay productos…» |
| `services` | Catálogo de servicios | Nuevo servicio / Editar servicio | ocultos; sin inventario | «Todavía no hay servicios… No necesitas inventario.» |
| `mixed` | Catálogo | Nuevo elemento / Editar elemento | visibles (Todos / Productos / Servicios) | neutral |

- Badge de tipo siempre (texto, no solo color). Un elemento heredado (tipo no
  permitido hoy) lleva la marca «Heredado» y una explicación: se conserva y se
  edita, no se crean nuevos; al editarlo el tipo se muestra en solo lectura.
- `ProductModal` recibe `allowedItemTypes` y `defaultItemType`; con un solo tipo
  no muestra el selector. El menú «Crear» también pasa las categorías de la
  empresa y el tipo por defecto (antes creaba siempre `PRODUCT` sin categorías).
- Selección de elementos en oportunidades (`AddProductToLeadModal`): mismo
  vocabulario y mismo filtro; placeholders neutrales.
- Importación: la ayuda de «Tipo de elemento» indica los tipos admitidos por
  la empresa y que las filas con otro tipo se reportan como fallidas.
- Textos: sin términos de muebles fuera de la plantilla de muebles (prueba
  dedicada en el frontend). Vocabulario base intacto: Contactos, Oportunidades,
  Pipeline, Tareas.
- Módulo desactivado: `/dashboard/products` muestra la pantalla de módulo
  inactivo (`RequireTenantCapability`), sin consultas al catálogo; la API
  responde `403 MODULE_DISABLED`.

## Cotizaciones y catálogo

Crear una cotización exige elementos del catálogo adjuntos a la oportunidad.
Con cotizaciones activas y catálogo inactivo, la lista de cotizaciones muestra
un aviso (con enlace a Configuración solo para ADMIN/SUPER_ADMIN); las
cotizaciones existentes se consultan y gestionan con normalidad.

## Deuda registrada

- Formato de moneda fijo `es-CO`/`COP` en catálogo, cotizaciones y dashboard
  (previo a la fase): debería usar `regional.currency/locale`. Fase 5.
- Backfill de `itemType` y migración de empresas existentes: Fase 5.
