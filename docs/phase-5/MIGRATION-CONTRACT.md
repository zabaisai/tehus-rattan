# Fase 5 — Contrato de migración

Diseño cerrado **antes** de escribir código. Define qué toca la herramienta,
qué no puede tocar nunca, cómo se demuestra que nada cambió de forma observable
y cómo se vuelve atrás.

## 0. Principio

La migración **materializa lo que el producto ya hace al leer**. No decide nada
nuevo: escribe en la base el valor que el código de lectura ya devolvía. Si una
empresa o una fila necesitara una decisión que hoy no existe, la herramienta se
detiene en lugar de inventarla.

## 1. Alcance exacto

| Toca | No toca |
|---|---|
| `products.itemType` cuando vale nulo | Cualquier otra columna de productos |
| `companies.settings` (objeto completo) | Cualquier otra columna de empresas, incluida la región |
| — | Pipelines, etapas y ajustes de oportunidades |
| — | Oportunidades, contactos, conversaciones, mensajes, tareas, cotizaciones y sus líneas |
| — | Usuarios, sesiones, dispositivos confiables, auditoría histórica |
| — | Esquema: sin migración Prisma, sin `NOT NULL`, sin disparadores |

La herramienta escribe **solo** en esas dos columnas y añade filas nuevas de
auditoría. Nada más.

## 2. Modos

| Modo | Escribe | Efecto |
|---|---|---|
| Ensayo en seco | no | Inventario, plan, manifiesto y diferencias previstas. **Es el modo por defecto** |
| Aplicar | sí | Ejecuta el plan dentro de una transacción, con guardas |
| Verificar | no | Comprueba las postcondiciones contra la base real |
| Revertir | sí | Restaura exactamente los valores anteriores del manifiesto |

Sin bandera explícita se ejecuta el ensayo en seco. Aplicar exige además una
confirmación explícita y una guarda de entorno.

## 3. Objetivo A — tipo de elemento del catálogo

**Por qué convertir el nulo en producto conserva exactamente la semántica
actual.** Tres hechos verificados en el código, no supuestos:

1. Toda respuesta de la API pasa por el resolutor de tipo efectivo, que
   devuelve producto cuando el valor guardado es nulo. Se aplica en el servicio
   de catálogo y en el de productos de una oportunidad. Una fila nula y una fila
   de tipo producto producen **la misma respuesta**.
2. El filtro por tipo expande producto a «igual a producto o nulo», así que la
   pertenencia a los listados no cambia.
3. Ninguna otra consulta del producto lee la columna: cotizaciones, búsqueda,
   importación y borrado seleccionan otros campos.

Por tanto el relleno no altera ninguna salida observable: escribe en disco el
valor que la aplicación ya devolvía en memoria.

**Regla.** Nulo pasa a producto. Única condición. No se mira el nombre, la
categoría, el precio, el stock ni el modelo comercial de la empresa. No se
clasifica por texto ni por heurística.

**Plan.** Lista de identificadores de fila, agrupada por empresa, obtenida en la
misma transacción que la escritura.

**Guardas antes de escribir.**

- El número de filas afectadas debe coincidir exactamente con el plan.
- La actualización exige que la fila siga siendo nula y esté en el plan: una
  fila que dejó de ser nula entre el plan y la escritura no se toca.
- Si el conteo real difiere del previsto, la transacción se revierte entera.

**Postcondición.** Cero filas nulas entre las planificadas, y los conteos por
tipo cuadran: los de tipo producto posteriores son los anteriores más los nulos,
y los de tipo servicio no cambian.

## 4. Objetivo B — configuración canónica

**Generación.** Para cada empresa, con el código real del producto: se lee la
configuración almacenada con el parser existente, se resuelven las banderas
efectivas con la regla de compatibilidad y se construye el objeto canónico con
la misma función que usa el motor de configuración, conservando categorías,
vertical, ajustes de pipeline y claves desconocidas.

Es exactamente la misma composición que se ejecuta hoy cuando alguien edita sus
ajustes. La migración no introduce una segunda forma de escribir configuración:
reutiliza la existente.

**Por qué se escriben las banderas efectivas y no las normalizadas.** El parser
rellena las banderas ausentes con falso, pero el producto nunca usa ese valor
directamente: la resolución de capacidades sustituye las no declaradas por su
valor de compatibilidad, que para catálogo, cotizaciones y tareas es **activo**.
Escribir las normalizadas apagaría módulos que hoy están encendidos. Escribir
las efectivas conserva el comportamiento.

**Prueba de equivalencia.** Antes de aceptar el canónico de una empresa se
comparan, campo por campo, la configuración efectiva derivada del valor actual y
la derivada del canónico propuesto:

| Campo | Debe ser idéntico |
|---|---|
| Identidad: industria, tipo de negocio, modelo, versión de plantilla | sí |
| Región: país, zona horaria, moneda, idioma | sí |
| Los siete módulos | sí |
| Tipos de catálogo permitidos y por defecto | sí |
| Categorías | sí |
| Pipeline efectivo y sus etapas | sí |
| Claves desconocidas | sí |
| Versión de almacenamiento | **no**: pasa a 2 |
| Módulos activos por compatibilidad | **no**: queda vacío |

Las dos únicas diferencias permitidas son las dos últimas, y son la definición
misma de canonicalizar: los módulos dejan de estar activos por compatibilidad y
pasan a estar declarados, con el mismo resultado efectivo. Cualquier otra
diferencia detiene la migración de esa empresa.

**Detección de deriva y ambigüedad.** La empresa se marca ambigua y se omite,
sin escribir, si ocurre cualquiera de estas cosas:

1. La comparación anterior encuentra una diferencia fuera de las dos permitidas.
2. Alguna clave de primer nivel del objeto original desaparecería del canónico.
3. El objeto original trae sub-claves de catálogo distintas de las categorías,
   que se perderían al reconstruir.
4. Declara vertical o ajustes de pipeline con una forma que el parser descarta:
   el valor almacenado se perdería aunque hoy ya se lea como nulo.
5. La lista de categorías normalizada difiere de la almacenada, porque algún
   nombre fue recortado, deduplicado o descartado por longitud.
6. Un módulo quedaría apagado teniendo datos asociados: catálogo con productos,
   cotizaciones con cotizaciones, tareas con tareas.

Ninguna ambigüedad se resuelve automáticamente. Se listan para decidirlas a
mano.

**Idempotencia.** La comparación del canónico con el valor almacenado es
semántica, no textual, así que una empresa ya canónica produce un plan vacío. La
segunda ejecución debe informar cero cambios.

## 5. Objetivo C — moneda por empresa

No hay migración de datos: **ningún importe almacenado se toca**. Es un cambio
de presentación en el frontend.

- Fuente de verdad: la región de la configuración del inquilino, que ya sirve el
  endpoint de configuración y que la interfaz autenticada ya tiene cargada.
- Se añade un formateador único que reemplaza los trece formateadores fijos
  repartidos por la interfaz, incluida la abreviatura en millones que hoy
  concatena el símbolo de dólar a mano.
- Ante una moneda o un idioma inválidos cae al mismo comportamiento defensivo
  que ya usa el backend: el código de la moneda seguido del importe, sin romper
  la pantalla.
- Paridad entre pantalla y PDF: el frontend usa la **misma fuente que el PDF**,
  que es la moneda actual de la empresa. Así los dos coinciden siempre.

**Deuda registrada, no resuelta aquí.** Una cotización congela su moneda al
crearse, pero el PDF ya formatea con la moneda actual de la empresa. Si una
empresa cambiara de moneda, las cotizaciones antiguas se mostrarían en la nueva.
Cambiar eso alteraría el PDF y excede esta fase.

## 6. Manifiesto

Un fichero por ejecución, escrito **fuera del repositorio**, con permisos
restrictivos. Contiene, para poder revertir con exactitud:

- Marca de tiempo, versión de la herramienta, commit y destino.
- Objetivo A: identificadores de las filas convertidas.
- Objetivo B: por empresa, el valor **anterior completo** de la configuración,
  incluido el caso de que fuera nula, y el valor escrito.
- Conteos previos y posteriores y las huellas de control.

El manifiesto contiene configuración real, así que **no entra en Git** y no se
pega en documentos ni informes.

## 7. Reversión

| Objetivo | Cómo se revierte |
|---|---|
| A | Devolver a nulo exactamente las filas listadas en el manifiesto |
| B | Restaurar la configuración anterior empresa por empresa, incluido volver a nula |
| C | Revertir el código; no hay datos que restaurar |

La reversión se ejecuta desde el manifiesto, en una transacción, con las mismas
guardas de conteo. Es campo por campo y no depende de un respaldo completo,
aunque el respaldo se toma igualmente antes de aplicar.

## 8. Seguridad de ejecución

1. **Guarda de entorno.** La herramienta se niega a aplicar sin confirmación
   explícita y sin que el destino declare ser un entorno permitido.
2. **Cerrojo.** Un cerrojo de asesoramiento de la base impide dos ejecuciones
   simultáneas.
3. **Transacción única.** Todo el modo de aplicación ocurre en una transacción:
   o entra entero o no entra nada.
4. **Auditoría.** Una fila de auditoría por empresa afectada, con actor de
   sistema, sin valores privados: solo secciones, conteos y versiones.
5. **Caché.** Las capacidades se guardan cinco segundos por proceso y no se
   enteran de una escritura externa; la verificación por API espera ese margen.
6. **Sin secretos ni datos reales** en la salida por consola: identificadores
   abreviados y conteos.

## 9. Orden de ejecución en staging

1. Inventario de solo lectura y huellas.
2. Respaldo oficial y verificación de la copia.
3. Ensayo en seco y revisión del plan.
4. Aplicación con confirmación.
5. Verificación.
6. Segunda ejecución completa: debe informar cero cambios.
7. Comparación de la configuración efectiva antes y después, empresa por empresa.
8. QA por API y por navegador con perfil administrador y asesor.

Estado: el contrato queda fijado aquí; los resultados van en
[STAGING-EVIDENCE.md](STAGING-EVIDENCE.md) y [TEST-MATRIX.md](TEST-MATRIX.md).
