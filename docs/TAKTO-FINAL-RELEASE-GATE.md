# Gate final independiente de release

Verificación de `feature/takto-functional-hardening` **desde el repositorio y
los resultados reales**, sin dar por buenas las conclusiones del informe
anterior. No se fusiona, no se despliega y no se toca staging.

## 1. Preflight

- [x] `HEAD == origin/feature/takto-functional-hardening`
- [x] `main == origin/main`, SHA real confirmado
- [x] Árbol limpio salvo `brand/` **sin rastrear**
- [x] Sin `.git/index.lock`
- [x] Leídos: SPEC, STATE y matriz de trazabilidad

## 2. CI remoto

- [ ] GitHub Actions consultado para el SHA exacto
- [ ] `frontend` en `success`
- [ ] `backend` en `success`
- No basta con las pruebas locales.

## 3. Auditoría del diff `origin/main...HEAD`

Se revisa: archivos modificados, secretos, credenciales, datos personales,
cambios ajenos, dependencias, migraciones, operaciones destructivas, aislamiento
por `companyId`, operaciones de eliminación, archivos temporales, conexiones a
Redis, workers, timers, errores silenciosos, logs con PII y rutas sin permisos.

Además, específicamente: **que ninguna migración ni backfill modifique los bots
reales existentes**.

## 4. Importación de 500 MB

El informe anterior solo demuestra hasta ~145,6 MB. Hay que cerrar **una** de
las dos, con honestidad:

**A.** Probar un archivo generado temporalmente cercano a 500 MB, sin subirlo a
Git, registrando tamaño exacto, formato, filas, tiempo, RSS
inicial/máximo/final, disco temporal, progreso, cancelación, limpieza,
resultados, reinicio del worker e idempotencia.

**B.** Si el equipo o el VPS no lo soportan de forma segura: determinar el
límite operativo con evidencia, mantener el límite de protocolo configurable,
**mostrar en la interfaz el límite operativo real**, no prometer 500 MB,
documentar por qué y **probar que los archivos superiores se rechazan antes de
ocupar recursos**.

No se declara soporte operativo para 500 MB solo porque una constante lo
permita.

## 5. QA real de navegador

Chrome **y Microsoft Edge**, a 1440 / 1280 / 1024 / 768 / 390 px.

Flujos mínimos: contactos activos, archivar, papelera, restaurar, eliminación
segura, pipelines, traslado de oportunidades, perfil lateral, pipeline →
conversación, conversación → pipeline, sugerencias de tareas, aprobar, rechazar,
importación de productos, progreso y cancelación, cotización y cálculos, PDF,
asociación al pipeline, TAKTO Pulso, importación/exportación y simulación
dry-run.

Se comprueba: contenido real de la aplicación —**no páginas de error**—, HTTP
correcto, cero errores de consola, cero excepciones, cero overflow, controles
con nombre accesible, teclado, apertura y cierre de paneles, recarga y deep
links.

## 6. Cotizaciones

Con evidencia **visual y E2E**, no solo servicios de backend: formulario,
líneas, cantidades, descuentos, ajustes negativos, transporte, impuestos, total,
Decimal en backend, PDF descargable, historial, envío en dry-run, asociación al
pipeline configurado y reintento sin duplicar.

## 7. Verificación completa

Backend unit, backend E2E, frontend, typecheck con specs, lint, build, Prisma
validate, migraciones desde cero, migraciones sobre esquema anterior, Docker
build de backend y de frontend, prueba de worker, prueba de Redis, cero claves
QA residuales, cero temporales, cero llamadas reales a Meta y kill switch
intacto.

## 8. Resultado

Si aparece un faltante: corregirlo, probarlo y añadir commits en la misma rama.
Actualizar `TAKTO-FUNCTIONAL-HARDENING-STATE.md`. Publicar únicamente
`feature/takto-functional-hardening`.

Decisión explícita: **APTO PARA FUSIÓN A MAIN** o **NO APTO**, con los
bloqueadores exactos. No se fusiona ni se despliega aunque todo quede verde.

---

# Resultados

## Bloqueador 1 — `brand/` versionado por error · CORREGIDO

El encargo original decía «no modifiques `brand/`» y que el árbol debía quedar
limpio **salvo `brand/` sin rastrear**. En `d3bc633` entró entero —208 archivos,
4,4 MB— por un `git add -A` sin revisar.

No se reescribió la historia: la rama está publicada y el force push está
prohibido. Se desrastreó en `7165d0e` y se añadió a `.gitignore`, de modo que el
árbol final de la rama vuelve a coincidir con el de `main` en ese punto.

Efecto en el diff neto: **de 329 archivos a 122**.

## Bloqueador 2 — El PDF de una cotización devolvía HTTP 500 · CORREGIDO

Lo introduje yo. El `DecimalInterceptor` de `f232f17` reconstruía **cualquier**
objeto de la respuesta para sustituir los `Decimal`. El PDF se devuelve como
`StreamableFile`; al rehacerlo se copiaban sus propiedades pero se perdía el
prototipo, y Nest recibía un objeto plano donde esperaba un flujo:

    Cannot read properties of undefined (reading 'destroyed')

Ninguna prueba lo vio: todas comprueban el **servicio**, donde el Buffer todavía
está intacto. Solo apareció pidiendo el PDF al producto vivo.

Corregido en `172beee` con un guardián `esObjetoPlano()` —solo se reconstruyen
objetos planos y listas; todo lo demás pasa por referencia— y dos pruebas de
regresión que fallan con la versión anterior.

Verificado contra el producto en ejecución: **HTTP 200, 2.118 bytes, cabecera
`%PDF-1.3`**.

## Bloqueador 3 — CI remoto en rojo · CAUSA IDENTIFICADA, FUERA DE LA RAMA

El trabajo de **backend** falla; el de **frontend** pasa siempre. Durante un
rato di por buena una hipótesis equivocada —cupo de descarga anónima de Docker
Hub al levantar los contenedores de servicio— y llegué a cambiar las imágenes a
un espejo en `a5db833`.

**Era falsa.** Las anotaciones del check dan el motivo literal:

> `The job was not acquired by Runner of type hosted even after multiple attempts`

El trabajo **nunca consiguió un runner**. No llegó a ejecutar ni «Set up job»:
la API devuelve el trabajo con **cero pasos** y 15 minutos entre inicio y
cancelación, con el tiempo de espera del propio trabajo fijado en 25. Las
imágenes de servicio ni siquiera se descargaron, así que el registro del que
venían no podía influir.

Por eso **deshice el cambio del workflow**: el archivo vuelve a ser idéntico al
original, byte a byte. Una modificación cuya única justificación resultó ser
falsa no se queda «porque tampoco hace daño».

Por qué el backend y no el frontend: es el trabajo caro —contenedores de
servicio, 25 minutos de tiempo máximo—, así que necesita un runner con más
holgura y es el primero en quedarse sin asignación cuando la capacidad de
GitHub aprieta.

El historial encaja con una limitación de capacidad, no con el código:

| SHA | Resultado | Hora (UTC) |
|---|---|---|
| `4b8cda1` | fallo | 05/08 23:49 |
| `2270e30` | **éxito** | 06/08 00:43 |
| `ec78724` | fallo | 06/08 16:12 |
| `d89170b` | fallo | 06/08 16:32 |
| `638c3b8` | fallo | 06/08 16:51 |
| `c497c85` | fallo | 06/08 17:36 |

`2270e30` pasó con **más** código que `4b8cda1`, que había fallado. Y todos los
fallos se agrupan en la misma ventana de hora y media de hoy.

**Esto no se corrige desde la rama.** El remedio de una asignación fallida de
runner es volver a lanzarla; no hay cambio de código que la evite. Los registros
del trabajo devuelven **403** con las credenciales disponibles, así que el
diagnóstico se apoya en las anotaciones del check, que sí son legibles y dan el
mensaje exacto.

### Y después dejó de programarse nada

El commit correctivo `1954755` llegó al remoto —`git ls-remote` devuelve el
mismo SHA que HEAD— y **GitHub no creó ninguna ejecución**. El workflow no tiene
filtro de rutas y la rama encaja con `feature/**`, así que debía dispararse.

Lo que sí se pudo comprobar, y descarta las explicaciones fáciles:

| Comprobación | Resultado |
|---|---|
| Estado del workflow | `active` |
| Repositorio | **público** → minutos de Actions gratuitos e ilimitados |
| `archived` / `disabled` | `false` / `false` |
| HEAD remoto == HEAD local | sí (`1954755`) |
| Filtro de rutas en el disparador | ninguno |

Es decir: **no es facturación ni minutos agotados** —lo di por posible antes de
comprobarlo y era falso— ni un workflow apagado ni un push que no llegó. Los
repositorios públicos tiran del grupo compartido de runners alojados, que es
exactamente lo que nombra el mensaje de error. Todo apunta a una degradación de
capacidad del lado de GitHub, y no hay nada en esta rama que la sortee.

---

# Evidencia recogida

## Importación de 500 MB — opción A: demostrada

Archivo generado, procesado por el camino real y borrado; nunca entró a Git.

| Medida | Valor |
|---|---|
| Tamaño exacto | 524.288.338 bytes (500,0 MB) |
| Formato | CSV |
| Filas | 1.524.918 |
| Tiempo | 568 s |
| Velocidad | 2.685 filas/s |
| RSS inicial / máximo / final | 48,4 / 262,9 / 222,2 MB |
| Disco temporal | 500 MB |
| Progreso observado | sí — 113 muestras crecientes |
| Fallidas | 0 |
| Temporal limpiado | sí |
| Reprocesar una terminada | no duplica |

El pico de memoria es **la mitad** del archivo, no un múltiplo: se lee en
streaming, no se carga entero.

**Cancelación:** detuvo el proceso en 0,2 s. **Reinicio del worker a mitad de
carga:** reanudó y terminó en 400.000 productos con 400.000 SKU únicos, sin
duplicados.

**Lo que el producto promete:** `GET /api/products/import/limits` devuelve el
**menor** entre el límite del producto y el del proxy, y avisa cuál manda. En
staging Caddy corta en **55 MB**, así que la interfaz ofrece 55 MB en staging
—no 500— y lo dice. Los 500 MB están demostrados sobre el motor de importación;
el proxy es el techo operativo real y no se oculta.

Un archivo por encima del límite se rechaza **por el tamaño declarado**, sin
abrirlo ni leer una fila, y la subida se rechaza también si no cabe en disco.

## QA de navegador real

Chrome y Microsoft Edge, vía CDP, a 1440 / 1280 / 1024 / 768 / 390 px.

**Chrome 51/51 · Edge 51/51 · 0 fallos.**

El arnés se niega a dar por buena una captura si no encuentra la navegación de
la aplicación en la página, después de que una versión anterior informara de 39
capturas verdes de una página de error del navegador porque el frontend se había
caído. También se corrigieron dos falsos negativos suyos en el enlace profundo
al perfil: buscaba la palabra «Perfil» en los primeros caracteres del texto
—donde solo está la barra lateral— en vez de detectar el panel por su etiqueta
accesible. Un arnés que miente en cualquiera de los dos sentidos no sirve.

## Verificación completa

| Comprobación | Resultado |
|---|---|
| Backend unitarias | 2.008 |
| Backend E2E | 805 |
| Frontend | 422 |
| Typecheck / lint / build (ambos) | verde |
| Docker (ambas imágenes) | verde |
| Migraciones desde cero | verde |
| Migraciones sobre esquema anterior con datos | verde — `11700000.55` conservado exacto |
| Bot `ACTIVE` preexistente tras migrar | intacto |
| Claves Redis residuales | 0 |
| Archivos temporales residuales | 0 |
| Llamadas a `graph.facebook.com` | 0 |

## Auditoría del diff `origin/main...HEAD`

| Comprobación | Resultado |
|---|---|
| Archivos | 128 · +16.559 / −3.045 |
| `brand/` | fuera del control de versiones |
| Archivos fuera del alcance | ninguno |
| Dependencias declaradas nuevas | ninguna — solo lockfiles (`npm audit fix`) |
| Datos personales reales | ninguno — todos los teléfonos y correos del diff son ficticios |
| Secretos | ninguno |

## Estado de staging — no se tocó

`killswitch=true`, 7 contenedores, sin migraciones, sin despliegues. Los bots de
`admin.crm.staging@tehusrattan.com` pasaron de 3 a 4 durante el encargo: los
creó la persona usuaria real, no yo. `QA_E2E_TEMP_Co` **sigue existiendo**: se
reporta, no se borra, tal y como se pidió.

---

# Decisión

## **NO APTO PARA FUSIÓN A MAIN**

Un único bloqueador, y no es del producto:

> **No hay una ejecución de CI remota verde confirmada sobre el SHA de HEAD.**

El gate exige textualmente no aceptar solamente pruebas locales. Los dos
bloqueadores que sí eran del producto están corregidos y verificados contra el
producto vivo; todo lo demás está demostrado y en verde.

La causa del tercero está identificada con el mensaje literal de GitHub —el
trabajo no consiguió runner— y **no es corregible desde esta rama**: no hay
cambio de código que consiga capacidad de runners. Pero **una causa
identificada no es una ejecución verde**, y mientras no exista esa ejecución la
decisión honesta es NO APTO.

**Para pasar a APTO basta con relanzar el trabajo de backend hasta que consiga
runner y termine en verde.** No hay ningún otro trabajo pendiente, y el
contenido de la rama no necesita cambiar para lograrlo.

**No se fusionó ni se desplegó nada.** Solo se publicó
`feature/takto-functional-hardening`.
