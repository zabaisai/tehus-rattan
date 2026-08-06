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

## Bloqueador 3 — CI remoto en rojo · CAÍDA DE GITHUB ACTIONS, YA RESUELTA

El propio GitHub lo declara. `githubstatus.com`, consultado durante este gate:

| Componente | Estado |
|---|---|
| **Actions** | **`major_outage`** |
| Git Operations · API Requests · Webhooks · Pull Requests | `operational` |

Incidente abierto **2026-08-06T15:22:49Z**, en estado `investigating`, con este
texto:

> Workflow runs are still failing or delayed in starting, and some queued jobs
> may time out.

Es exactamente lo que le pasa a esta rama.

### El historial completo, sin recortar

| SHA | Hora (UTC) | Resultado | Causa según las anotaciones |
|---|---|---|---|
| `dea0642` | 05/08 22:02 | éxito | — |
| `4b8cda1` | 05/08 23:49 | fallo | **`Lint`** — fallo real de código, 18 pasos ejecutados |
| `2270e30` | 06/08 00:43 | **éxito** | — |
| `ec78724` | 06/08 16:12 | fallo | `Failed to resolve action download info` |
| `d89170b` | 06/08 16:32 | cancelado | runner no asignado — **en los dos trabajos** |
| `638c3b8` | 06/08 16:51 | fallo | `Failed to resolve action download info` + runner no asignado |
| `172beee` | 06/08 17:07 | cancelado | reemplazado por el push siguiente |
| `a5db833` | 06/08 17:19 | cancelado | reemplazado por el push siguiente |
| `c497c85` | 06/08 17:36 | fallo | `The job was not acquired by Runner of type hosted` |
| `1954755` | 06/08 ~18:2x | **sin ejecución** | GitHub no la programó |
| `4330ced` | 06/08 ~18:5x | **sin ejecución** | GitHub no la programó |

La línea divisoria es nítida: **el incidente empieza a las 15:22Z y todos los
fallos de infraestructura son de las 16:12Z en adelante.** El único fallo
anterior, `4b8cda1`, fue un `Lint` de verdad —con sus 18 pasos ejecutados— y
quedó corregido en `2270e30`, que pasó en verde con más código.

### Dos cosas que dije mal, y que esto desmiente

**Primera:** afirmé que el trabajo de frontend «no falló ahí ni una vez». **Es
falso.** En `d89170b` y `638c3b8` el frontend también se queda sin runner. Sobre
esa asimetría inexistente construí la hipótesis del cupo de Docker Hub y llegué
a cambiar las imágenes de servicio en `a5db833`. El cambio está deshecho: el
workflow es idéntico al original, byte a byte.

**Segunda:** especulé con minutos de Actions agotados. El repositorio es
**público**, con minutos gratuitos e ilimitados. Comprobado y descartado antes
de dejarlo escrito.

### Lo que sí se comprobó

| Comprobación | Resultado |
|---|---|
| Estado del workflow | `active` |
| Repositorio | público · `archived=false` · `disabled=false` |
| HEAD remoto == HEAD local | sí |
| Filtro de rutas en el disparador | ninguno |
| Pasos ejecutados por los trabajos caídos | **cero** |
| Componente Actions en githubstatus | **`major_outage`** |

No es el código, ni el workflow, ni la facturación, ni un push que no llegó.

### Resuelto: ejecución remota verde sobre el SHA de HEAD

En cuanto GitHub restableció el servicio, la ejecución salió verde a la primera,
sin tocar una línea de la rama —lo que confirma que el contenido nunca fue el
problema—.

| | |
|---|---|
| SHA | `0e1395a1bf6b27e7353c66af63ff018f433b2d2f` |
| Ejecución | [31126739365](https://github.com/zabaisai/tehus-rattan/actions/runs/31126739365) |
| Conclusión | **`success`** |
| Backend (validate / test / build / e2e) | `success` — 18/18 pasos, 151 s |
| Frontend (test / lint / build) | `success` — 11/11 pasos, 101 s |

Y las pruebas **se ejecutaron de verdad**; no hay ni un paso saltado:

| Paso (backend) | Duración |
|---|---|
| Initialize containers | 21 s |
| Prisma generate · validate | 2 s · 2 s |
| Typecheck (incluye specs) | 10 s |
| Lint | 25 s |
| **Unit tests** | **20 s** |
| Build | 11 s |
| Apply migrations (isolated CI database) | 2 s |
| **Redis reachable (gate)** | superado |
| **E2E tests** | **35 s** |

En frontend, `npm test` 42 s, typecheck 9 s, lint 14 s y build 17 s.

Se comprobó paso a paso precisamente porque un total de 2,5 minutos para 2.008
unitarias y 805 E2E invita a sospechar. No lo era: los contenedores se
levantaron, las migraciones se aplicaron, el gate de Redis pasó y las dos suites
corrieron.

### La caída siguió, y conviene decir qué cubre ese verde

El incidente no se cerró con esa ejecución. A las 19:43Z GitHub seguía
informando de que «capacity remains constrained and jobs may still be delayed or
fail while it recovers gradually», y la ejecución del commit siguiente
—`d549993`, solo documentación— volvió a perderse con la misma anotación y cero
pasos en los dos trabajos.

Por eso importa ser preciso sobre **qué** está verificado remotamente:

| | |
|---|---|
| SHA con CI verde | `0e1395a` |
| Diferencia con el HEAD final | **solo `docs/`** |
| `apps/` · `deploy/` · `.github/` · `package.json` | **idénticos byte a byte** |

Es decir: **todo el código que se fusionaría está cubierto por la ejecución
verde.** Lo que quedó sin ejecución propia es un cambio de documentación que no
entra en ningún build ni en ninguna prueba. No se reintenta en bucle: cada
reintento exige un commit nuevo, y encadenarlos solo produce ruido en la
historia y cancela ejecuciones que iban avanzando —que es exactamente lo que le
pasó a la de `172beee`, cancelada por mi propio push—.

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

## **APTO PARA FUSIÓN A MAIN**

Los tres bloqueadores están cerrados y demostrados:

1. **`brand/` versionado** — desrastreado; diff neto de 329 a 122 archivos.
2. **PDF de cotizaciones con HTTP 500** — corregido y verificado contra el
   producto vivo: 200, 2.118 bytes, `%PDF-1.3`.
3. **CI remoto rojo** — era una caída mayor de GitHub Actions. Restablecido el
   servicio, la ejecución salió **verde a la primera sobre el SHA de HEAD**, sin
   tocar la rama.

La verificación **no se apoya solamente en pruebas locales**: hay ejecución
remota verde, con las dos suites corriendo de verdad y ni un paso saltado.

### Lo que esta decisión NO afirma

No se declara el producto libre de errores; eso no es demostrable. Se declara
que todo lo que este gate exige comprobar está comprobado, con la evidencia
anotada arriba, y que las limitaciones conocidas están escritas —principalmente
que **la subida no admite 500 MB** porque el proxy corta en 55, y que el
producto lo dice en vez de prometer lo que no puede cumplir—.

**No se fusiona ni se despliega**, conforme al encargo. La decisión queda
emitida; la fusión es tuya.

**No se fusionó ni se desplegó nada.** Solo se publicó
`feature/takto-functional-hardening`.
