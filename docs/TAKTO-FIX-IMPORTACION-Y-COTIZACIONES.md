# Corrección: almacenamiento de importaciones y API de cotizaciones

Rama `fix/staging-import-storage-and-quotes-api`, partiendo de `main` en
`c02331e`. Los dos defectos se encontraron en el despliegue controlado a
staging del 7 de agosto de 2026; **staging siguió en `c02331e` y no se modificó
durante esta corrección**.

---

## Defecto 1 — El worker no encontraba el archivo que subía el backend

### Causa raíz

El backend guardaba el archivo de importación en `/tmp` y persistía la **ruta
absoluta** en `product_imports.tempPath`. Después encolaba el trabajo, que
consume el **worker**: otro contenedor, con su propio `/tmp`.

La ruta existía, pero solo en el proceso equivocado. Cada importación moría con
`El archivo temporal ya no existe` y **cero filas procesadas**.

```
backend  /tmp/takto-importaciones/1786115268689-4c78f0e004b7.csv   ← existe
worker   /tmp/takto-importaciones/                                 ← no existe
```

Ninguno de los dos montaba un volumen en `/tmp`.

### Por qué no lo detectó ninguna prueba

Todas —unitarias, E2E y hasta la de 500 MB— corren en **un solo proceso**, donde
quien escribe y quien lee comparten disco. El fallo solo existe cuando productor
y consumidor son contenedores distintos. Es el mismo patrón que escondió el
`$ NaN` del tablero y el 500 del PDF: **el fallo vive en la frontera, no en el
dominio**.

### Arquitectura elegida

Una abstracción `AlmacenamientoDeImportaciones` con seis operaciones: guardar,
abrir lectura, comprobar existencia, eliminar de forma idempotente, leer
metadatos y limpiar huérfanos. El proveedor actual,
`AlmacenamientoEnDirectorioCompartido`, trabaja sobre un directorio configurable
por `PRODUCT_IMPORT_STORAGE_DIR`.

La base guarda una **clave relativa** generada por el servidor, nunca una ruta.
Cada proceso la resuelve contra su propia raíz. Se inyecta por token
(`ALMACENAMIENTO_DE_IMPORTACIONES`), de modo que pasar a almacenamiento de
objetos es cambiar una línea del módulo: el motor de importación no se entera.

**En Docker:** volumen nombrado `product_imports`, montado en
`/var/lib/takto/importaciones` en **backend y worker**, y en ningún otro
servicio —ni frontend, ni PostgreSQL, ni Caddy, ni Redis—.

### Detalles que habrían dejado el arreglo a medias

**Permisos.** Un volumen nombrado nuevo nace propiedad de `root` y el contenedor
corre como `nestjs`. La carpeta se crea en la imagen con su dueño, porque Docker
inicializa el volumen copiando contenido *y* propietario del punto de montaje.
Sin esto, el archivo seguiría sin llegar al worker, ahora por permisos.

**Limpieza de huérfanos.** La función existía en el código y **no estaba
conectada a nada**. Ahora corre a diario en el worker —`shouldRunScheduledJobs`
evita que backend y worker la dupliquen— y además libera las referencias de
importaciones ya terminadas, para que la pantalla no ofrezca reintentar algo
cuyo archivo se barrió.

### Protecciones

| Protección | Cómo |
|---|---|
| Path traversal | Patrón estricto de clave + comprobación de que la ruta resuelta cae dentro de la raíz |
| Nombre del cliente | Nunca decide dónde se escribe; solo aporta la extensión, acotada a `.xlsx`/`.csv` |
| Escritura parcial | `.partial` + `rename` atómico; un fallo a mitad no publica un archivo truncado |
| Tamaño | Validado antes de aceptar y comprobado contra el espacio libre en disco |
| Borrado | Idempotente; al terminar, cancelar o fallar |
| Conservación | Los archivos recientes no se barren: una importación fallida aún puede reintentarse |
| Registros | Sin nombres originales ni contenido del archivo |

### Aviso al arrancar

Si `PRODUCT_IMPORT_STORAGE_DIR` no está configurada en producción, el worker lo
avisa en el arranque. No tumba el proceso —en desarrollo local el `tmpdir` es
correcto—, pero el fallo tiene que verse al arrancar y no cuando alguien sube un
catálogo de 50 MB.

---

## Defecto 2 — El motor de cotizaciones no era alcanzable

### Causa raíz

El esquema, `quote-calculo.ts` y sus pruebas soportaban transporte, impuesto,
ajuste y descuentos por línea desde el primer día. Los DTO **no declaraban esos
campos**, así que con `forbidNonWhitelisted` la API respondía:

```
property shipping should not exist
```

Y el frontend tampoco los enviaba. Funcionalidad completa, probada e
inalcanzable.

### Por qué no lo detectó ninguna prueba

Las pruebas ejercitan el servicio y el motor **directamente**, nunca a través de
HTTP y su capa de validación. La misma lección que el defecto 1.

### Qué cambia

Un solo `EconomiaDeCotizacionDto`, heredado por crear y actualizar —para que no
vuelvan a desviarse—, expone transporte, tasa, impuesto incluido, ajuste con su
etiqueta, descuento general y edición de líneas por id.

`update` deja de recalcular solo el descuento: recalcula el documento entero
desde las **líneas persistidas**, y guarda líneas y cabecera en una transacción.

### Reglas explícitas

- El **ajuste es el único campo que puede restar**, y por eso el único sin
  `Min(0)`. Un ajuste que deja la base en negativo se rechaza con **400**, no se
  recorta a cero en silencio: el motor acota como última red, pero un −500.000
  sobre una cotización de 100.000 es un signo puesto al revés.
- La **tasa se acota a 0–100**: es un porcentaje, y un 1900 por un cero de más
  multiplicaría el total por veinte sin que nada chille.
- Los importes rechazan **infinitos, `NaN` y más de cuatro decimales**, que es lo
  que la base guarda.
- El **total nunca llega del cliente**: el DTO lo rechaza *y* el servicio lo
  recalcula. Hay una prueba para cada mitad — una capa de validación se puede
  saltar; una cuenta hecha en el servidor, no.
- Una cotización **ya enviada no cambia sus importes**: para eso existe la
  revisión.

### Frontend

Crear y editar ofrecen los campos con etiquetas asociadas, alcanzables con
teclado. De las líneas solo se envían **las que cambiaron**: mandarlas todas
haría que abrir y guardar sin tocar nada reescribiera cada línea.

La pantalla de detalle y el documento imprimible usan ahora **el mismo
desglose**. Antes cada uno enseñaba lo suyo, y el documento añadía un «Abono»
fijo a cero que no existe en el modelo. `filasDelDesglose` no calcula nada:
pinta lo que devuelve el servidor. Si sumara por su cuenta, tarde o temprano
diría algo distinto del PDF.

---

## Defecto 3 — Un mapeo mal formado devolvía 500

`@IsObject()` acepta `{}` y cualquier objeto sin `campos`; `validarMapeo` entraba
entonces a `mapeo.campos.name` sobre `undefined`. Un cuerpo mal escrito es culpa
de quien lo manda: ahora es un **400** con un mensaje que dice cómo se escribe
bien.

---

## Pruebas

### La que reproduce el fallo de staging

`almacenamiento-importaciones.spec.ts` monta **dos raíces distintas** a
propósito —que es lo que son dos `/tmp` de dos contenedores— y comprueba que el
worker no encuentra nada. Si alguien vuelve a configurar mal el volumen, esto lo
dice.

La E2E de catálogo usa ahora **dos instancias con dos almacenamientos** que solo
comparten la carpeta: el backend guarda, el worker procesa.

### Docker con contenedores separados

Prueba real ejecutada con `postgres`, `backend` y `worker` en contenedores
distintos y volumen compartido:

| Comprobación | Resultado |
|---|---|
| Usuario en ambos contenedores | `nestjs` |
| Escritura en el volumen (backend / worker) | sí / sí |
| La clave persistida no es una ruta | correcto |
| El worker ve el archivo del backend | sí |
| Importación de 500 filas | `COMPLETED`, 500 creados, 0 fallidos |
| Importación de 2.000 filas con **reinicio del worker a mitad** | `COMPLETED`, 2.000 productos, 2.000 SKU distintos, **0 duplicados** |
| Archivos temporales al terminar | 0 |

Todo se creó y se destruyó en la prueba; no quedaron contenedores ni volúmenes.

### Resultados

| Suite | Resultado |
|---|---|
| Backend unitarias | 2.068 |
| Backend E2E | 812 de 817 |
| Frontend | 435 |
| Typecheck, lint y build (ambos) | verde |
| Docker backend y frontend | construyen |
| `prisma format` y `validate` | válido |

---

## Migraciones

**Ninguna.** El arreglo se resolvió con código y Compose, como debía ser: la
columna `tempPath` ya era `String?` y ahora guarda una clave en vez de una ruta.

---

## Rollback

Revertir esta rama devuelve el comportamiento anterior sin tocar datos. El
volumen `product_imports` puede quedarse: si nadie lo usa, solo ocupa espacio, y
la limpieza de huérfanos lo vacía sola.

Las importaciones creadas con esta versión guardan una clave donde la anterior
esperaba una ruta; al revertir, esas importaciones fallarían al procesarse
—`El archivo de esta importación ya no está disponible`— y habría que volver a
subir el archivo. No hay pérdida de datos: los productos ya importados quedan.

---

## Defecto 4 — La rama no disparaba el CI

El workflow se ejecuta en `develop`, `main`, `feature/**` y `hotfix/**`. Esta
rama se llama `fix/...`, que **no encajaba en ningún patrón**: se publicó y
GitHub no creó ninguna ejecución. Una rama sin verificar no se nota hasta que
alguien la fusiona.

El repositorio ya había aprendido esto una vez —el comentario del propio
workflow explica que `hotfix/**` se añadió tras quedarse una rama urgente sin
verificar—. Se añade `fix/**` por lo mismo.

---

## Limitaciones conocidas

**La suite `flowbot-transporte.e2e-spec.ts` es frágil bajo carga paralela.**
Falla de forma intermitente al ejecutar toda la E2E a la vez, y en pruebas
distintas cada vez. Está comprobado que **ya ocurre en `main` (`c02331e`)** —el
SHA desplegado y con CI verde—: en un árbol de trabajo aparte fallaron las
pruebas 1, 4 y 6 del despacho del outbox, y aisladamente pasa 36 de 36 tanto en
`main` como en esta rama. **No lo introduce esta corrección**, pero conviene
arreglarlo: una suite que falla al azar acaba enseñando a ignorar los rojos.

**El almacenamiento sigue siendo un directorio compartido.** Es suficiente para
una instancia; escalar a varias exige el proveedor de objetos, para el que la
interfaz ya está preparada.

**El límite de subida lo sigue poniendo el proxy** (55 MB en staging), y el
producto muestra el menor entre ese y el suyo.
