# Estabilización funcional del CRM TAKTO

Documento vivo. Se actualiza en cada bloque cerrado para que el trabajo pueda
reanudarse sin releer la conversación.

## Punto de partida

| Dato | Valor |
|---|---|
| SHA inicial | `347b95795ef9129436532f52f03779a386b16847` |
| Rama | `feature/takto-functional-hardening`, creada desde `origin/main` |
| `main` vs `origin/main` | Idénticos en `347b957` (sin tocar) |
| Árbol al empezar | Limpio salvo `brand/` sin rastrear (no se toca) |

### Baseline de pruebas (antes de tocar nada)

| Suite | Antes | Después |
|---|---|---|
| Backend unitarias | 116 suites / 1928 | 120 suites / **1999** |
| Backend E2E | 48 suites / 712 | 55 suites / **805** |
| Frontend | 55 archivos / 401 | 58 archivos / **422** |

Todo verde en ambos extremos. Lint, typecheck y build verdes en backend y
frontend.

## Datos reales que NO se tocan

- Los bots de `admin.crm.staging@tehusrattan.com` (`Handoff a asesor`
  archivado, `Auto` y `Captura de datos` en borrador). Intactos.
- La empresa residual **`QA_E2E_TEMP_Co`** de una sesión anterior: **se
  reporta y NO se elimina**, por estar fuera del alcance de este encargo.
- Todas las auditorías y los usuarios reales.
- Staging: no se desplegó, no se migró y no se modificó nada. Verificado por
  `smoke-test.sh` en modo solo lectura, 17/17.

## Hallazgos de la auditoría

Severidad: **C** crítico, **A** alto, **M** medio, **B** bajo.

| # | Sev | Dominio | Defecto | Estado |
|---|---|---|---|---|
| 1 | A | Productos | La importación aceptaba `.xlsm`, el formato **con macros** | **Corregido** |
| 2 | A | Productos | Sin comprobación de firma: un archivo cualquiera renombrado a `.xlsx` entraba al lector | **Corregido** |
| 3 | A | Productos | Inyección de fórmulas: una celda `=cmd|…` entraba tal cual como nombre de producto | **Corregido** |
| 4 | A | Dinero | Todo el dinero en `Float`: totales que no cuadran con la suma de sus partes | **Corregido** |
| 5 | A | Cotizaciones | `generateNextNumber` traía **todas** las cotizaciones de la empresa a memoria | **Corregido** |
| 6 | A | Embudos | Sin traslado de oportunidades: un embudo en uso no se podía retirar | **Corregido** |
| 7 | M | Embudos | `remove` culpaba a las etapas; el impedimento real eran las oportunidades | **Corregido** |
| 8 | M | Contactos | El botón decía «Eliminar» y archivaba. La etiqueta mentía | **Corregido** |
| 9 | M | Contactos | Sin papelera, sin eliminación definitiva, sin vista previa de impacto | **Corregido** |
| 10 | M | Infra | `smoke-test.sh` apuntaba a `localhost`; 15 fallos `000` engañosos contra staging | **Corregido** |
| 11 | B | Contactos | `update`/`block` escribían con `where: { id }` tras validar aparte (TOCTOU) | **Corregido** |
| 12 | M | Navegación | «FlowBot» y «Chatbot» convivían como dos productos para la misma promesa | **Corregido** |
| 13 | M | Productos | El límite de 500 MB **no es alcanzable** hoy: Caddy corta en 55 MB y el archivo se lee entero en memoria | **Documentado, no resuelto** |
| 14 | B | Frontend | `og:image` en staging apunta a `http://localhost:3000` (build sin `NEXT_PUBLIC_APP_URL`) | **Abierto** |
| 15 | B | Pruebas | El botón de borrar embudos no tenía prueba; la que lo parecía ejercitaba una **etapa** | **Corregido** |

## Migraciones

Las dos son **aditivas o conservadoras**, revisadas a mano, con rollback en el
propio archivo. **Ninguna se aplicó en staging.**

### `20260805120000_contacto_anonimizado`
Una columna nueva, opcional, sin valor por defecto y con índice parcial. No
reescribe la tabla. Rollback: `DROP COLUMN "anonymizedAt"`.

### `20260805180000_sugerencias_de_tarea`
Un enum, una tabla y una columna con valor por defecto (`requireTaskApproval`,
`true`). No toca ninguna fila existente. Verificada desde base limpia: el índice
único sobre `createdTaskId` es lo que garantiza en la base que dos aprobaciones
no produzcan dos tareas. Rollback en el propio archivo.

### `20260805140000_dinero_en_decimal`
`double precision` → `numeric(18,4)` en 8 columnas, in situ con `USING`.
Lleva un cheque previo que **aborta** si encuentra importes con más de 4
decimales en vez de redondearlos en silencio.

Verificada de tres formas:

| Prueba | Resultado |
|---|---|
| Desde base limpia | `numeric(18,4)` en las 6 columnas comprobadas |
| Sobre el esquema anterior **con datos** | Valores idénticos; igualdad exacta comprobada en SQL; 0 filas perdidas |
| Rollback documentado | Ejecutado; los valores vuelven intactos |

Datos de la prueba: `11700000.55`, `19.99`, `91.19`, `4.35`, `86.84`, `59.97`.

Riesgo: toma `ACCESS EXCLUSIVE` y reescribe las tablas. Con los volúmenes
actuales (miles de filas) es instantáneo; en una base grande habría que hacerlo
por columna nueva + backfill. Está escrito en la propia migración.

## Commits

| SHA | Qué |
|---|---|
| `a358192` | `fix(smoke-test)`: topología real de Caddy + documento de estado |
| `d3bc633` | `feat(contactos)`: archivar, papelera y eliminación definitiva |
| `1045030` | `feat(embudos)`: retiro seguro con traslado de oportunidades |
| `6bc9747` | `refactor(pulso)`: nombre visible y fin de la duplicación con Chatbot |
| `cda5ea3` | `fix(productos)`: rechazar `.xlsm`, aceptar CSV, neutralizar fórmulas |
| `03b07ee` | `fix(dinero)`: importes en Decimal |
| `be789f1` | `chore(lint)`: cerrar los avisos introducidos |
| `dea0642` | `docs`: estado del encargo |
| `a951bf0` | `feat(perfil)`: panel comercial compartido y navegación Pipeline ↔ Chat |
| `0160502` | `feat(tareas)`: un bot propone, una persona decide |
| `39d9d70` | `feat(pulso)`: importar y exportar en `.taktoflow.json` |
| `8cc73bd` | `fix(pulso)`: un campo entrante objeto no puede acabar como `[object Object]` |
| `4b8cda1` | `docs`: §6, §7 y §11 cerrados |
| `515e149` | `feat(cotizaciones)`: impuestos, transporte, descuento por línea y ciclo de vida |
| `b228108` | `chore(deps)`: cerrar las vulnerabilidades que se arreglan sin romper nada |
| `f232f17` | `fix(api)`: los importes salían como `{"s":..}` y el tablero mostraba `$ NaN` |
| `e41ca9e` | `feat(productos)`: importación en streaming con estado durable |

## Secciones del encargo: qué está hecho y qué no

| § | Bloque | Estado |
|---|---|---|
| 1–3 | Preflight, baseline, auditoría | **Completo** |
| 4 | Contactos: archivo, papelera, eliminación | **Completo** |
| 5 | Embudos: CRUD y retiro seguro | **Completo** |
| 10 | Renombrar a TAKTO Pulso | **Completo** |
| 9 | Cotizaciones | **Completo** |
| 12 | Barrido general | **Completo** |
| 8 | Importación de productos | **Completo** salvo el límite de red (Caddy, 55 MB) |
| 6 | Panel lateral y navegación Pipeline ↔ Chat | **Completo** |
| 7 | Tareas con aprobación (`TaskSuggestion`) | **Completo** |
| 11 | Importar/exportar Pulsos | **Completo** |

## Limitaciones conocidas

1. **La importación de 500 MB no es alcanzable hoy** y no se ha fingido que lo
   sea. El techo efectivo es el menor de: el límite configurable
   (`PRODUCT_IMPORT_MAX_MB`, 50 por defecto), el `request_body max_size` de
   Caddy (55 MB) y la memoria del proceso, porque el archivo se lee entero.
   Techo operativo medido: **~50 MB**. Llegar a 500 MB exige carga por
   fragmentos y lectura en streaming.
2. **La comprobación de macros depende de exceljs.** Se rechaza la extensión,
   la firma que no es ZIP y el libro que trae `vbaProject`. Un `.xlsm`
   despojado de su proyecto de VBA pasaría, pero entonces ya no tiene macros.
3. **`og:image` en staging apunta a localhost.** Es un defecto de build
   (`NEXT_PUBLIC_APP_URL` ausente al construir), no de código. No se corrigió
   porque tocarlo implica redesplegar staging, que está fuera de alcance.
4. **Dependencias.** Quedan 2 moderadas en el backend (`uuid`, arrastrada por
   `exceljs`) y 3 altas en el frontend (`sharp`, por `libvips`). Ambas exigen
   `npm audit fix --force`, y en el caso de `sharp` eso subiría Next fuera del
   rango declarado. Todas son **heredadas**: las dependencias declaradas son
   idénticas a las de `main`.
5. **La QA responsive se rehizo contra el producto levantado en local**: 39
   capturas, 5 anchos, 0 desbordamientos, 0 errores de consola, 0 controles sin
   nombre. No se repitió contra staging, que no se ha tocado.

## Hallazgos añadidos en esta sesión

| # | Sev | Dominio | Defecto | Estado |
|---|---|---|---|---|
| 16 | A | Pulso | El bot creaba tareas humanas directamente, sin que nadie las aceptara | **Corregido** |
| 17 | M | Perfil | Conversaciones armaba su panel con 4 consultas sueltas; el Pipeline no tenía ninguno | **Corregido** |
| 18 | M | Navegación | La conversación abierta vivía en estado local: sin deep link, y recargar perdía el chat | **Corregido** |
| 19 | A | Pulso | El analizador de importación convertía con `String(valor)`: un campo objeto habría entrado como `[object Object]` | **Corregido** |
| 20 | B | Perfil | Un campo personalizado numérico habría salido como `[object Object]` si el tipo se aflojaba | **Corregido** |
| 21 | **A** | API | Los importes salían por HTTP como `{"s":1,"e":6,"d":[...]}` y el tablero mostraba **`$ NaN`** | **Corregido** |
| 22 | M | Productos | Los botones de editar y retirar eran iconos sin nombre accesible | **Corregido** |
| 23 | M | QA | El arnés de QA daba 39 capturas «verdes» de la pantalla de error del navegador | **Corregido** |

### El hallazgo 21, en detalle

`ClassSerializerInterceptor` usa `instanceToPlain`, que enumera las propiedades
**propias** del objeto en vez de llamar a su `toJSON`. Las de un `Decimal` son
`s`, `e` y `d`. Al migrar el dinero a `Decimal`, cada importe empezó a salir por
la API como su representación interna, que en el navegador es `NaN`.

**Ninguna prueba lo detectó, y no por descuido**: todas comprueban el servicio,
donde el valor sigue siendo un `Decimal` correcto. El fallo solo existe al otro
lado de HTTP. Apareció al levantar el producto y mirar el tablero.

## Estado final

**Las doce secciones están cerradas.** La auditoría de trazabilidad, requisito
por requisito y con la prueba que lo demuestra, está en
`TAKTO-FUNCTIONAL-HARDENING-AUDIT.md`.

Sobre los 500 MB: **el motor de importación los procesa**, y está demostrado
—524.288.338 bytes, 1.524.918 filas, 568 s, con el RSS en un pico de 262,9 MB,
la mitad del archivo, porque se lee en streaming—. El techo operativo real lo
pone `request_body max_size` de Caddy, que en staging corta en **55 MB**.

Por eso el producto **no promete 500 MB**: `GET /api/products/import/limits`
devuelve el menor entre el límite del producto y el del proxy y avisa cuál
manda, y la interfaz muestra ese número. Subir el techo del proxy exige tocar la
configuración del VPS, fuera del alcance de este encargo.

## Gate final de release

Ejecutado sobre `a5db833`. El detalle completo —evidencia, medidas y
bloqueadores— está en `TAKTO-FINAL-RELEASE-GATE.md`.

Tres bloqueadores encontrados:

1. **`brand/` versionado por error** en `d3bc633`. Desrastreado en `7165d0e`;
   diff neto de 329 a 122 archivos. Sin reescribir la historia: la rama está
   publicada y el force push está prohibido.
2. **El PDF de una cotización devolvía HTTP 500**, por culpa de mi propio
   `DecimalInterceptor`, que reconstruía el `StreamableFile` y le quitaba el
   prototipo. Corregido en `172beee` y verificado contra el producto vivo: 200,
   2.118 bytes, `%PDF-1.3`.
3. **CI remoto en rojo** en el trabajo de backend, fallando en «Set up job»
   antes de ejecutar código del repositorio. Corregido en `a5db833` —imágenes
   de servicio desde un espejo sin cupo anónimo—, **sin confirmación remota
   todavía**.

**Decisión: NO APTO PARA FUSIÓN A MAIN**, por un único bloqueador: no hay una
ejecución de CI remota verde confirmada sobre el SHA de HEAD. Todo lo demás está
demostrado y verde. Para pasar a APTO basta con esa confirmación.

No se fusionó, no se desplegó y no se tocó staging.

## Reanudación

```bash
git -C C:/Users/Usuario/Desktop/Tehus_Rattan checkout feature/takto-functional-hardening
git -C C:/Users/Usuario/Desktop/Tehus_Rattan pull --ff-only
```

Lo único pendiente es comprobar el CI remoto de `a5db833`:

```bash
curl -s "https://api.github.com/repos/zabaisai/tehus-rattan/actions/runs?head_sha=a5db833"
```
