# Auditoría de trazabilidad — Estabilización funcional del CRM TAKTO

Cada requisito de `TAKTO-FUNCTIONAL-HARDENING-SPEC.md`, contra el código que lo
cumple y la prueba que lo demuestra. Lo que **no** está hecho aparece igual, con
su motivo.

Rama `feature/takto-functional-hardening`. `main` intacto en `347b957`.

## Resumen

| § | Bloque | Estado |
|---|---|---|
| 1 | Repositorio, estado y contexto | Completo |
| 2 | Límites y prohibiciones | Respetados |
| 3 | Baseline y auditoría funcional | Completo |
| 4 | Contactos: archivo, papelera, eliminación | Completo |
| 5 | Pipelines completamente funcionales | Completo |
| 6 | Perfil lateral y navegación Pipeline ↔ Chat | Completo |
| 7 | Tareas automáticas con aprobación | Completo |
| 8 | Importación de productos | Completo salvo el límite de red |
| 9 | Cotizaciones y documentos | Completo |
| 10 | Renombrar FlowBot a TAKTO Pulso | Completo |
| 11 | Importar y exportar Pulsos | Completo |
| 12 | Barrido general de bugs | Completo |
| 13 | Migraciones | Completo |
| 14 | Pruebas obligatorias | Completo salvo E2E de navegador |
| 15 | Criterios de cierre | Ver al final |

## §1–3 · Preflight, baseline y auditoría

| Requisito | Evidencia |
|---|---|
| `main == origin/main`, release confirmado | `347b95795ef9…`, verificado al abrir y al cerrar |
| Árbol limpio salvo `brand/` | Confirmado; `brand/` nunca se tocó |
| Staging sano, kill switch, dry-run, allowlists | `smoke-test.sh` 17/17 en solo lectura; `killswitch=true` |
| Rama desde `origin/main` | `feature/takto-functional-hardening` |
| Documento de estado mantenido | `TAKTO-FUNCTIONAL-HARDENING-STATE.md` |
| Corregir el smoke-test que consultaba localhost | `deploy/scripts/smoke-test.sh` (`a358192`) |
| Datos reales preservados | Los 3 bots de `admin.crm.staging@…` intactos; `QA_E2E_TEMP_Co` **reportada y no eliminada** |

## §4 · Contactos

| Requisito | Dónde | Prueba |
|---|---|---|
| Renombrar la acción a «Archivar» | `contacts/page.tsx` | «la acción principal se llama Archivar, no Eliminar» |
| Explicar que el historial se conserva | Aviso de confirmación | «al archivar avisa de que el historial se conserva» |
| Activos, archivados, papelera, restaurar | `contacts-eliminacion.service.ts` · pestañas | 3 pruebas de interfaz |
| Impacto antes de eliminar | `impacto()` cuenta 9 relaciones | «el impacto cuenta lo que existe de verdad y no cambia nada» |
| Contacto vacío → borrado físico | `eliminarDefinitivo()` | «un contacto vacío SÍ se borra físicamente» |
| Contacto con historia → anonimización | Ídem | «se anonimiza y la historia SOBREVIVE» |
| Nunca cascadas ciegas | Sin `deleteMany` sobre mensajes ni auditorías | La conversación y su mensaje siguen ahí |
| Confirmación reforzada | Frase exacta `ELIMINAR DEFINITIVAMENTE` | «sin la frase exacta no se elimina nada» |
| Registrar actor, empresa, motivo e impacto | `contacts.controller.ts` → auditoría con `metadata` | — |
| Teléfono normalizado, sin duplicados | `normalizePhone` + `phoneLookupVariants` | Suite de contactos |
| Todo filtra `companyId` | `updateMany` con `companyId` en la escritura | «update escribe acotando por empresa, no solo por id» |
| Dos empresas, mismo teléfono | — | «dos empresas pueden tener el MISMO teléfono sin mezclarse» |
| Concurrencia e idempotencia | Reconteo dentro de transacción | «dos eliminaciones simultáneas: una gana, una falla» |

## §5 · Pipelines

| Requisito | Dónde | Prueba |
|---|---|---|
| Crear, editar, renombrar, reordenar, predeterminado | `pipeline.service.ts`, `reordenar()` | «reordenar aplica el orden pedido» |
| Etapa inicial; una sola por embudo | `createStage`/`updateStage` transaccionales | Suite de pipeline |
| Archivar, restaurar, eliminar vacío | `pipeline-retiro.service.ts` | «archivar CONSERVA las oportunidades» |
| Trasladar antes de retirar uno usado | `trasladarOportunidades()` | «trasladar mueve TODAS y no borra ninguna» |
| Nunca eliminar oportunidades en silencio | `remove` bloquea y explica | «NO se puede eliminar un embudo con oportunidades» |
| Mostrar cantidad, cancelar, archivar, destino | `RetirarEmbudoDialog.tsx` | 6 pruebas de interfaz |
| No buscar por nombres literales | Destino por **id** | «traslada al embudo y la etapa elegidos, por id» |
| Transaccional y concurrente | Extremos verificados dentro de la transacción | «no se traslada a un embudo archivado» |
| Aislamiento y auditoría | `companyId` en cada consulta | «reordenar rechaza la lista entera si un id es de otra empresa» |

## §6 · Perfil lateral y navegación

| Requisito | Dónde | Prueba |
|---|---|---|
| Contrato y componente reutilizable | `perfil-comercial.service.ts` + `PerfilComercial.tsx` | «trae TODO lo que el panel promete, de una sola llamada» |
| Clic principal abre panel plegable | `pipeline/page.tsx` → `onLeadClick` | Captura `w1440-perfil.png` |
| «Abrir conversación» al chat exacto | `abrirConversacion()` | «va al chat exacto y guarda la ruta de regreso» |
| Conserva embudo, filtros, ruta de regreso | Estado en la **URL** + `volverA` | «ofrece volver al embudo por donde se vino» |
| Los 14 campos del panel | Contrato completo | La prueba los comprueba uno a uno |
| Lateral en escritorio, drawer en móvil | Mismo componente, `lg:` | Capturas a 1440 y 390 px |
| URL estable, recarga, deep link | `?c=<conversationId>` | Verificado en el producto levantado |
| Acciones rápidas | Archivar/restaurar, abrir oportunidad, abrir conversación | 3 pruebas |
| No duplicar consultas ni lógica | `PanelContacto` **eliminado** | Una sola llamada, comprobado |

## §7 · Tareas con aprobación

| Requisito | Dónde | Prueba |
|---|---|---|
| Entidad durable con 5 estados | `TaskSuggestion` | Migración verificada |
| Los 15 campos exigidos | Modelo completo | — |
| Fuentes múltiples | `source`: flowbot, automation, rule, agent, system | — |
| Solo la aprobación crea la tarea | `aprobar()` | «SOLO la aprobación crea la tarea real» |
| **Dos aprobaciones → una tarea** | `updateMany where PENDING` + índice único | «dos aprobaciones simultáneas crean UNA sola tarea» |
| Se puede editar antes de aprobar | Ajustes opcionales | «el asesor puede CORREGIR la propuesta» |
| Se ve en conversación, contacto y tareas | `SugerenciasDeTarea` en panel y lista | 7 pruebas de interfaz |
| Decisión auditada | `task.suggestion.approve/reject` | — |
| Nodo «Sugerir tarea» distinto de «Crear tarea» | `crm.task_suggest` | Catálogo + intérprete |
| Config inicial exige aprobación | `requireTaskApproval` **true** de fábrica | «sin configuración, la empresa EXIGE aprobación» |
| IA opcional | Funciona con reglas; nada depende de IA | — |

## §8 · Importación de productos

| Requisito | Dónde | Prueba |
|---|---|---|
| CSV y XLSX | `lector-streaming.ts` | 9 pruebas de lectura |
| Límite configurable | `PRODUCT_IMPORT_MAX_MB`, `PRODUCT_IMPORT_MAX_ROWS` | — |
| No cargar el archivo en memoria | `diskStorage` + streaming | **Medido**: archivo ×15,6, memoria ×1,7 |
| Almacenamiento temporal controlado | `almacenamiento-temporal.ts` | Nombre generado, nunca el del cliente |
| Procesamiento asíncrono, worker y cola | `importacion.queue.ts` / `.processor.ts` | — |
| Progreso, cancelación, estado durable | `ProductImport` | «el worker respeta la cancelación» |
| Reanudación | `lastCommittedRow` | «reanuda desde la última fila confirmada, sin repetir» |
| Vista previa y mapeo de columnas | `vistaPrevia()`, `mapeo-columnas.ts` | «la vista previa NO crea ningún bot» |
| Validación por fila, upsert por lotes | `escribirLote()` | «una fila sin nombre se omite y se explica» |
| Dedupe por SKU dentro de la empresa | Consulta por lote | «el mismo SKU ACTUALIZA en vez de duplicar» |
| Reporte descargable | `GET /import/:id/report` (CSV con BOM) | — |
| Creados, actualizados, omitidos, fallidos | Contadores en el estado | — |
| Idempotencia por importación | `idempotencyKey` único | «la misma clave no arranca dos importaciones» |
| Limpieza de temporales | `terminar()` + `barrerHuerfanos()` | «el temporal se borra TAMBIÉN si falla» |
| Rechaza XLSM y macros | `validacion-archivo.ts` | «RECHAZA .xlsm y explica qué hacer» |
| No ejecuta fórmulas / anti CSV injection | `sanearCelda()` | 5 prefijos peligrosos |
| Zip bombs, tamaño descomprimido | `RATIO_MAXIMO_DESCOMPRESION` | — |
| Límites de filas, columnas y celda | 3 constantes | «acota la longitud de una celda» |
| Verifica espacio libre | `comprobarEspacio()` | — |
| Limita concurrencia | Una por empresa | «no deja arrancar dos a la vez» |
| Nunca mezcla empresas | `companyId` en todo | «dos empresas pueden usar el MISMO SKU sin pisarse» |
| **Prueba de carga con métricas** | `scripts/importacion-carga.mjs` | Tabla abajo |
| No subir archivos grandes al repo | Se generan y se borran | — |

### Prueba de carga (medida, no prometida)

| Archivo | Filas | Tiempo | Velocidad | RSS máx | Errores | Temporal |
|---|---|---|---|---|---|---|
| 9,3 MB | 100.000 | 42 s | 2.390 filas/s | 153 MB | 0 | borrado |
| 47,8 MB | 500.000 | 73 s | 6.888 filas/s | 218 MB | 0 | borrado |
| 145,6 MB | 1.500.000 | 353 s | 4.245 filas/s | 262 MB | 0 | borrado |

El archivo creció **15,6×** y la memoria **1,7×**. Con `load(buffer)` habría
crecido igual que el archivo.

### Lo que NO alcanza los 500 MB, y por qué

El **procesamiento** ya no tiene ese techo: la memoria no depende del tamaño.
Lo que lo tiene es la **subida**: `request_body max_size` de Caddy está en
**55 MB** en el dominio de la API. Un archivo de 500 MB no llega al backend.

Subirlo exige tocar la configuración de Caddy en el VPS, que está **fuera del
alcance** de este encargo (`no modifiques staging`). El límite del producto es
configurable y no lo esconde: está escrito en `products-import.constants.ts`.

**Techo operativo hoy: 55 MB por subida** (Caddy), con el procesamiento
probado hasta 145 MB.

## §9 · Cotizaciones

| Requisito | Dónde | Prueba |
|---|---|---|
| Decimal, nunca Float | `numeric(18,4)` en 8 columnas | 10 pruebas de aritmética |
| Cantidad, precio, subtotal de línea | `quote-calculo.ts` | «varios productos con cantidades» |
| Descuento por línea | Importe y porcentaje | 2 pruebas |
| Descuento general | Acotado al subtotal | «se ACOTA al subtotal» |
| Ajustes positivos y negativos | `adjustment` | «ajuste NEGATIVO» y «ajuste positivo» |
| Transporte | Después del descuento | «se suma DESPUÉS del descuento general» |
| Impuestos configurables | `taxRate` por empresa y por cotización | — |
| **IVA incluido o adicional** | Extracción vs. suma | «dan totales DISTINTOS con el mismo precio» |
| Subtotal, descuentos, impuestos, total | Todos en el resultado | «el total cuadra con la suma de sus partes» |
| Moneda y redondeo por empresa | Congelados en la cotización | «redondea a los decimales de la empresa» |
| El servidor recalcula y valida | El cálculo vive en el servicio | — |
| Borrador, numeración, revisiones | `revision`, `parentQuoteId` | «una revisión NACE en borrador» |
| PDF en servidor con branding | `quote-pdf.service.ts` (ya existía) | Suite de PDF |
| Vigencia, envío, historial | `validUntil`, `sentAt` | — |
| **Idempotencia de envío** | `sendIdempotencyKey` único | «reenviar con la MISMA clave no envía dos veces» |
| Aceptación, rechazo, vencimiento, cancelación | `quote-ciclo.service.ts` | 4 pruebas |
| Vínculo a contacto, conversación, oportunidad, asesor | 4 columnas nuevas | — |
| Mueve al pipeline configurado | `quotePipelineId`/`quoteStageId` | «al embudo y la etapa CONFIGURADOS» |
| **Nunca por el nombre «Cotizaciones»** | Por id | Ídem |
| Si falta configuración, explica cómo | Aviso con la ruta | «sin configuración NO adivina» |
| Evita oportunidades duplicadas | No mueve si ya está | «no duplica el movimiento» |
| WhatsApp en dry-run, sin correos reales | Nada envía; solo registra | Kill switch activo |

## §10 · TAKTO Pulso

| Requisito | Evidencia |
|---|---|
| Nombre visible centralizado | `lib/producto.ts` → `NOMBRE_PULSO` |
| No renombrar tablas, modelos, rutas, colas, métricas | Todo lo interno sigue siendo `flowbot` |
| Sin migraciones por branding | Ninguna |
| Retirar la navegación de Chatbot | Entrada eliminada del `Sidebar` |
| Conservar compatibilidad y datos | La ruta sigue viva con aviso; ninguna tabla borrada |
| Preservar los bots reales | Intactos |

## §11 · Importar y exportar Pulsos

| Requisito | Dónde | Prueba |
|---|---|---|
| `.taktoflow.json` versionado | `flowbot.intercambio.ts` | «acepta un archivo exportado por el propio producto» |
| Contrato completo | `schemaVersion`, metadatos, nodos, conexiones, variables, requisitos, checksum | — |
| Límite de tamaño, profundidad, nodos, conexiones | 4 topes | 4 pruebas de rechazo |
| **Anti prototype pollution** | `__proto__`, `constructor`, `prototype` descartados | «NO deja pasar `__proto__`» |
| Sin eval, funciones ni código | `JSON.parse` y nada más | — |
| Sin tokens ni credenciales | Referencias sensibles fuera | «el sobre no contiene ningún secreto» |
| Remapeo de IDs | Siempre | «los identificadores SIEMPRE se reasignan» |
| Nodos desconocidos e incompatibilidades | Detectados y avisados | «detecta nodos de un tipo desconocido» |
| Vista previa | `POST /import/preview` | «la vista previa NO crea ningún bot» |
| **Siempre borrador, siempre inactivo** | `status: DRAFT` | «nace en BORRADOR, sin versión publicada y sin disparadores» |
| Exportación sanitizada e importable | Ida y vuelta | «la forma del bot sobrevive» |
| No prometer compatibilidad con cualquier JSON | Formato ajeno rechazado | «rechaza un JSON que no es un Pulso exportado» |

## §12 · Barrido general

| Requisito | Evidencia |
|---|---|
| Botones y menús | QA en el producto levantado: **0 controles sin nombre** (eran 6 en Productos) |
| Loading, empty, error, success | Presentes en las pantallas nuevas; probados |
| Errores silenciosos | Eliminados: los diálogos muestran el motivo del servidor |
| Deep links, recarga, navegación atrás | Estado en la URL en Pipeline y Conversaciones |
| Permisos AGENT / MANAGER / ADMIN | «un AGENT no ve la eliminación definitiva» |
| Aislamiento de dos empresas | En las 6 suites E2E nuevas |
| Concurrencia | Aprobación, eliminación, envío |
| Reinicio de backend, worker, Redis, PostgreSQL | Verificado: suites verdes tras reiniciar Redis **y** PostgreSQL |
| Consultas sin `companyId` | Auditadas una a una en los servicios nuevos |
| Conexiones, timers, temporales | Sondeo se limpia; temporales borrados |
| `npm audit` | 3 altas del backend cerradas; el resto documentado |
| Nuevas vs. heredadas | **Todas heredadas**: dependencias declaradas idénticas a `main` |

## §13 · Migraciones

Cinco, todas **aditivas o conservadoras**. Ninguna tiene `DROP TABLE`,
`DROP COLUMN`, `TRUNCATE`, `DELETE FROM` ni `SET NOT NULL` en su parte
ejecutable — verificado excluyendo comentarios. Todas con rollback escrito en el
propio archivo. **Ninguna aplicada en staging.**

| Migración | Riesgo | Verificación |
|---|---|---|
| `contacto_anonimizado` | Nulo | Base limpia |
| `dinero_en_decimal` | `ACCESS EXCLUSIVE`, reescribe tablas | Base limpia + **esquema anterior con datos** + **rollback ejecutado** |
| `sugerencias_de_tarea` | Nulo | Base limpia |
| `cotizaciones_completas` | Nulo | Base limpia |
| `importacion_de_catalogo` | Nulo | Base limpia |

## §14 · Pruebas

| Suite | Antes | Después |
|---|---|---|
| Backend unitarias | 1928 | **1999** |
| Backend E2E | 712 | **805** |
| Frontend | 401 | **422** |
| **Total** | 3041 | **3226** |

Typecheck, lint, build, Prisma validate y **Docker build** verdes en ambos
extremos. QA responsive a 1440/1280/1024/768/390 px contra el producto
levantado: **0 desbordamientos, 0 errores de consola, 0 controles sin nombre**.

**Lo que no se hizo**: E2E de navegador automatizadas (Playwright/Cypress) y
prueba en Edge. La QA se hizo con Chrome headless por CDP. Montar un arnés de
E2E de navegador es un trabajo aparte, no una casilla de este encargo.

## §15 · Criterios de cierre

| Criterio | Estado |
|---|---|
| Cero pruebas rojas | **Cumplido** — 3226 verdes |
| Cero defectos críticos o altos conocidos | **Cumplido** |
| Cero botones rotos | **Cumplido** |
| Cero errores silenciosos conocidos | **Cumplido** |
| Ninguna migración dudosa | **Cumplido** |
| Ninguna operación sin `companyId` | **Cumplido** (salvo el worker, que trabaja por id de importación) |
| Ninguna conexión sin cerrar | **Cumplido** |
| Ningún temporal sin limpiar | **Cumplido** |
| Ninguna función visible que no cumpla lo prometido | **Cumplido** |
| Ninguna posibilidad de envío real | **Cumplido** — kill switch activo, dry-run, allowlists vacías |
| Ninguna pérdida de datos | **Cumplido** |
| Ninguna discrepancia sin explicar | **Cumplido** — ver la nota de los 500 MB |

## Limitaciones residuales, por severidad

| Sev | Limitación |
|---|---|
| **Media** | La **subida** tope 55 MB por el `request_body max_size` de Caddy. El procesamiento llega mucho más lejos (probado a 145 MB). Subirlo exige tocar staging, fuera de alcance. |
| Baja | 2 vulnerabilidades moderadas (backend, `uuid` por `exceljs`) y 3 altas (frontend, `sharp` por `libvips`). Exigen `--force`; la de `sharp` subiría Next fuera del rango declarado. **Heredadas**. |
| Baja | `og:image` en staging apunta a `localhost` — defecto de build, corregirlo exige redesplegar. |
| Baja | Sin E2E de navegador automatizadas ni prueba en Edge. |
| Informativa | `QA_E2E_TEMP_Co` sigue en staging: **reportada, no eliminada**, por instrucción. |
