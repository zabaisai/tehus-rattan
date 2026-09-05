# Fase 5 — Matriz de pruebas

Solo resultados reales. Lo que no se ha ejecutado dice PENDIENTE.

## Línea base antes de tocar código

| Suite | Resultado |
|---|---|
| Backend unitarias | 158 suites · 2556 pruebas · todo en verde |
| Frontend | 116 ficheros · 1235 pruebas · todo en verde |
| Estado de migraciones Prisma | al día |

## Después de la Fase 5

| Suite | Resultado |
|---|---|
| Backend unitarias | **159 suites · 2575 pruebas · todo en verde** |
| Backend extremo a extremo, Fase 5, base real | **11 pruebas · todo en verde** |
| Frontend | **118 ficheros · 1250 pruebas · todo en verde** |
| Lint backend | sin errores ni avisos |
| Lint frontend | sin errores; dos avisos anteriores y ajenos a esta fase |
| Comprobación de tipos | backend y frontend sin errores |

## A. Relleno del tipo de elemento del catálogo

| # | Qué se comprueba | Prueba | Resultado |
|---|---|---|---|
| A1 | Una fila sin tipo se responde como producto antes y después | e2e Fase 5 | PASA |
| A2 | El catálogo devuelto por la API es idéntico antes y después | e2e Fase 5 | PASA |
| A3 | La fila sin tipo queda escrita como producto | e2e Fase 5 | PASA |
| A4 | Una fila de tipo servicio no se toca jamás | e2e Fase 5 | PASA |
| A5 | La fecha de actualización no cambia | e2e Fase 5 | PASA |
| A6 | El ensayo en seco no escribe nada | e2e Fase 5 | PASA |
| A7 | La segunda ejecución no actualiza ninguna fila | e2e Fase 5 | PASA |
| A8 | La reversión devuelve la fila a sin tipo | e2e Fase 5 | PASA |
| A9 | Las pruebas anteriores de tipo de elemento siguen pasando | suite existente | PASA |

## B. Configuración canónica

| # | Qué se comprueba | Prueba | Resultado |
|---|---|---|---|
| B1 | Una empresa sin configuración conserva sus módulos | unitaria + e2e | PASA |
| B2 | Identidad, región, categorías y pipeline no cambian | e2e Fase 5 | PASA |
| B3 | La versión de almacenamiento pasa de 0 a 2 | e2e Fase 5 | PASA |
| B4 | Los módulos por compatibilidad quedan vacíos | e2e Fase 5 | PASA |
| B5 | Una bandera nunca declarada queda escrita como activa | unitaria + e2e | PASA |
| B6 | Las banderas declaradas se respetan tal cual | unitaria | PASA |
| B7 | Las claves desconocidas sobreviven | unitaria + e2e | PASA |
| B8 | Una empresa ya canónica no se reescribe | unitaria + e2e | PASA |
| B9 | El orden de las claves no provoca reescritura | unitaria | PASA |
| B10 | Vertical y ajustes de pipeline se conservan | unitaria | PASA |
| B11 | Una clave que chocaría con el contrato detiene la migración | unitaria | PASA |
| B12 | Sub-claves de catálogo que se perderían la detienen | unitaria | PASA |
| B13 | Un vertical o unos ajustes malformados la detienen | unitaria | PASA |
| B14 | Categorías que la normalización cambiaría la detienen | unitaria + e2e | PASA |
| B15 | Una empresa que apagó un módulo con datos NO es ambigua | unitaria | PASA |
| B16 | Una empresa ambigua queda intacta y se informa el motivo | e2e Fase 5 | PASA |
| B17 | La auditoría no lleva valores ni nombres | e2e Fase 5 | PASA |
| B18 | La reversión restaura la configuración exacta, incluida la ausencia | e2e Fase 5 | PASA |
| B19 | El alcance acota: una empresa fuera de la lista no se toca | e2e Fase 5 | PASA |
| B20 | Una configuración que no es un objeto se trata como ausencia | unitaria | PASA |

## C. Moneda por empresa

| # | Qué se comprueba | Prueba | Resultado |
|---|---|---|---|
| C1 | Cada moneda produce un texto distinto | unitaria | PASA |
| C2 | Sin región se usa la del producto | unitaria | PASA |
| C3 | Nunca se escribe un número no válido | unitaria | PASA |
| C4 | Una moneda inválida muestra código e importe | unitaria | PASA |
| C5 | Un idioma inválido no lanza | unitaria | PASA |
| C6 | Por debajo del millón no se abrevia | unitaria | PASA |
| C7 | A partir del millón se abrevia con el símbolo correcto | unitaria | PASA |
| C8 | Los negativos conservan el signo al abreviar | unitaria | PASA |
| C9 | El catálogo de una empresa colombiana usa punto de miles | pantalla | PASA |
| C10 | El de una empresa mexicana usa coma | pantalla | PASA |
| C11 | El de una estadounidense muestra dólares | pantalla | PASA |
| C12 | Una moneda guardada inválida no rompe la pantalla | pantalla | PASA |

## Staging

| # | Comprobación | Resultado |
|---|---|---|
| S1 | Respaldo oficial y verificación de la copia | PENDIENTE |
| S2 | Ensayo en seco y revisión del plan | PENDIENTE |
| S3 | Aplicación con confirmación | PENDIENTE |
| S4 | Verificación | PENDIENTE |
| S5 | Segunda ejecución sin cambios | PENDIENTE |
| S6 | Configuración efectiva idéntica empresa por empresa | PENDIENTE |
| S7 | QA por navegador con perfil administrador | PENDIENTE |
| S8 | QA por navegador con perfil asesor | PENDIENTE |
