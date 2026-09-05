# Fase 5 — Análisis de brechas

Base inspeccionada: `origin/main` `ef93a4d` (PR #28 `52289a8` funcional y PR #29
`ef93a4d` documental, ambos ancestros de `main`). Worktree
`../Tehus_Rattan-phase-5`, rama `feat/phase-5-existing-tenant-migration`.
Runtime de staging al empezar: `52289a8`; checkout del VPS: `ef93a4d`.

Línea base de pruebas antes de tocar código: backend 158 suites / 2556
unitarias; frontend 116 ficheros / 1235. Todo en verde.

## Inventario de staging (solo lectura, transacción `read only`)

| Dato | Valor |
|---|---|
| Empresas | 4 |
| Forma de `settings` | 2 sin settings (v0), 2 en forma plana (v1), **ninguna canónica** |
| Claves desconocidas en `settings` | 0 |
| Productos | 3 |
| Productos con `itemType IS NULL` | **3** (todos, activos, de una sola empresa) |
| Empresas con productos nulos | 1 |
| Pipelines | 4 (uno predeterminado por empresa), 23 etapas |
| Región | las 4 empresas en `America/Bogota` · `COP` · `es-CO`; 2 sin país |
| Columna `products.itemType` | `nullable YES`, `DEFAULT 'PRODUCT'` |
| Migraciones aplicadas | 60 |

Las huellas estables de empresas, settings, productos, pipelines, etapas,
usuarios y cotizaciones quedaron guardadas fuera de Git con permisos 600.

## A. Backfill de `Product.itemType`

| # | Requisito | Estado actual | Evidencia | Riesgo | Cambio propuesto | Prueba | Resultado |
|---|---|---|---|---|---|---|---|
| A1 | Inventariar filas `NULL` | 3 filas, 1 empresa | inventario | ninguno | plan por empresa | inventario del dry-run | PENDIENTE |
| A2 | Demostrar que la semántica legacy es `PRODUCT` | `effectiveItemType(stored) = stored ?? 'PRODUCT'`; el filtro `PRODUCT` expande a `OR [PRODUCT, null]`; toda respuesta pasa por `toResponse` | `catalog-item-type.ts:20-45`, `products.service.ts:15-18`, `lead-products.service.ts:185` | ninguno | ninguno: se materializa lo que ya se lee | `catalog-item-type.spec.ts`, e2e de tipo | PENDIENTE |
| A3 | Convertir solo `NULL → PRODUCT` | — | — | tocar filas ya tipadas | `WHERE "itemType" IS NULL` y lista de ids del plan | unitaria + e2e | PENDIENTE |
| A4 | No tocar filas ya tipadas | — | — | — | guarda de conteo exacto | e2e | PENDIENTE |
| A5 | No clasificar por texto | — | — | heurísticas | la regla es solo `IS NULL` | revisión del plan | PENDIENTE |
| A6-A7 | Idempotencia | — | — | doble ejecución | plan vacío en la segunda | e2e doble ejecución | PENDIENTE |
| A8 | Cero `NULL` en staging | 3 hoy | inventario | — | apply | verify | PENDIENTE |
| A9 | Mismo tipo observable antes y después | idéntico por A2 | — | — | — | comparación por API | PENDIENTE |
| A10 | No ocultar elementos por capacidades | el listado filtra por empresa y `isActive`, nunca por capacidades | `products.service.ts:findAll` | — | — | QA | PENDIENTE |
| A11 | Inventario, dry-run, manifiesto, guardas y verificación | no existe | — | escritura a ciegas | herramienta versionada | e2e | PENDIENTE |

**Conclusión del análisis A.** No existe ninguna ruta del producto en la que
una fila con `itemType NULL` se comporte distinto de una fila `PRODUCT`: la
respuesta de la API es idéntica byte a byte, el filtro las agrupa y ninguna
consulta de cotizaciones, búsqueda, importación o borrado lee la columna. Las
únicas diferencias observables están en aserciones de pruebas que leen la
columna cruda, y esas pruebas **crean su propia fila nula en tiempo de
ejecución**, de modo que un backfill puntual no las afecta.

**Decisión sobre `NOT NULL`.** No se aplica en esta fase. Motivos: producción
no se migra y puede conservar filas legacy; una prueba de extremo a extremo
exige que una fila creada con `itemType: null` **siga siendo nula** tras pasar
por la API (`tenant-capabilities.e2e-spec.ts`), lo que documenta que la
compatibilidad de lectura es parte del contrato actual. Todas las rutas de
escritura ya producen un tipo explícito y la columna tiene `DEFAULT 'PRODUCT'`,
así que no pueden nacer filas nulas nuevas por la aplicación.

## B. Configuración canónica de empresas existentes

| # | Requisito | Estado actual | Evidencia | Riesgo | Cambio propuesto | Prueba | Resultado |
|---|---|---|---|---|---|---|---|
| B1 | Leer la configuración original | `parseCompanySettings` con tres ramas | `company-settings.ts:231` | — | reutilizarlo tal cual | unitaria | PENDIENTE |
| B2 | Calcular la efectiva con las reglas reales | `resolveEffectiveCapabilities` y `resolveEffectiveCommercial` | `tenant-capabilities.ts:302,337` | — | reutilizarlos | unitaria | PENDIENTE |
| B3 | Generar el canónico equivalente | `buildCompanySettingsV2` ya lo hace y el motor lo usa | `company-settings.ts:289`, `tenant-configuration.service.ts:287-330` | — | misma función, misma base de fusión | unitaria | PENDIENTE |
| B4 | Conservar identidad, vertical, categorías, módulos, región, `pipelineDefaults` y claves desconocidas | `extra` se preserva; región vive en columnas, no en el JSON | informe de settings | perder sub-claves de `catalog` o un `vertical` malformado | guarda de ambigüedad que aborta si algo se perdería | unitaria + e2e | PENDIENTE |
| B5 | Las v0 conservan sus módulos por compatibilidad | hoy activos por `legacyDefault` | `tenant-capabilities.ts:302-314` | apagar módulos con datos | escribir las banderas **efectivas**, no las normalizadas | unitaria + e2e | PENDIENTE |
| B6 | Ningún módulo con datos desaparece | — | — | pérdida de acceso | comprobación explícita módulo↔datos en el plan | e2e | PENDIENTE |
| B7-B8 | Pipeline predeterminado y etapas intactos | ambas cascadas son relacionales y no leen el JSON | `tenant-configuration.service.ts:382`, `lead-settings.service.ts:87-157` | ninguno | no se tocan pipelines | comparación de huellas | PENDIENTE |
| B9-B11 | No renombrar empresas; Tehus sigue siendo un tenant; TAKTO la plataforma | — | — | — | la migración solo toca `settings` | huella de empresas sin settings | PENDIENTE |
| B12 | Idempotencia | — | — | — | comparación semántica del canónico | e2e doble ejecución | PENDIENTE |
| B13 | Mantener lectores legacy | `parseCompanySettings` conserva v0/v1 | — | romper producción | no se elimina compatibilidad | suite existente | PENDIENTE |

**Único cambio observable esperado.** Tras canonicalizar, las empresas que hoy
son v0 dejan de tener módulos «activos por compatibilidad» y pasan a tenerlos
declarados: `storageVersion` pasa de 0 a 2 y `capabilities.legacyDefaultsApplied`
pasa de `["catalog","quotes","tasks"]` a `[]`. Los módulos efectivos, el modelo
comercial, los tipos de catálogo permitidos, la región, las categorías y el
pipeline **no cambian**. Ese es exactamente el propósito de la fase y se
verifica campo por campo.

## C. Regionalización monetaria

Inventario: **trece** formateadores de moneda repartidos por la interfaz, los
trece con el mismo literal fijo en pesos colombianos, más una abreviatura en
millones que concatenaba el símbolo de dólar a mano. No existía ningún ayudante
central. El backend, en cambio, **ya** formateaba por empresa en el documento de
cotización, así que la pantalla y el PDF podían discrepar.

| # | Requisito | Estado actual | Riesgo | Cambio propuesto | Prueba | Resultado |
|---|---|---|---|---|---|---|
| C1 | Formato centralizado | no existía | duplicación | un único módulo de formato | unitaria | HECHO |
| C2 | Moneda e idioma de la empresa | fijos | moneda equivocada | se leen de la región del inquilino | pantalla en tres monedas | HECHO |
| C3 | Catálogo, cotizaciones y panel de inicio | fijos | — | los tres usan el formato de la empresa | pantalla + suite | HECHO |
| C4 | Sin tocar importes guardados | — | corrupción de datos | solo presentación; ningún cálculo se deriva de texto | revisión + suite | HECHO |
| C5 | Paridad pantalla y PDF | podían discrepar | desconfianza | misma fuente que el backend | revisión | HECHO |
| C6 | Moneda inválida no rompe | no contemplado | pantalla en blanco | respaldo con código e importe | unitaria | HECHO |
| C7 | Sin abreviaturas con símbolo fijo | símbolo de dólar a mano | moneda equivocada | notación compacta del idioma | unitaria | HECHO |

**Decisión sobre la moneda de una cotización.** El frontend usa la moneda
**actual de la empresa**, que es la misma que ya usa el PDF del backend. Así
pantalla y documento coinciden siempre. Que una cotización congele su moneda al
crearse y el PDF no la respete es una discrepancia anterior a esta fase; queda
registrada como deuda y no se cambia aquí, porque tocarlo alteraría el PDF.

## Deudas detectadas que NO se corrigen en esta fase

1. `platform-companies.service.ts` crea empresas **sin** `settings`, así que
   una empresa nueva vuelve a nacer v0. La migración de hoy no evita que
   aparezcan nuevas empresas legacy.
2. `scripts/demo-socio.ts` restablece la empresa de demostración a `DbNull`, lo
   que la devuelve a v0 y deshace su migración.
3. La caché de capacidades es por proceso y no se entera de escrituras hechas
   por SQL directo; expira en cinco segundos.
4. Una cotización congela su moneda al crearse, pero el PDF y ahora también la
   pantalla la muestran en la moneda actual de la empresa. Si una empresa
   cambiara de moneda, las cotizaciones antiguas se verían en la nueva.
5. El despliegue comprueba la salud del backend sin reintento mientras el
   contenedor arranca, y falla de forma intermitente en ese paso.

Sin secretos, IDs completos, correos ni nombres de clientes en este documento.
