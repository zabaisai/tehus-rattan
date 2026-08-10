# Corrección: el desglose económico del PDF de cotizaciones

Rama `fix/quotes-pdf-economic-breakdown`, partiendo de `main` en `0b8ebba`.
El defecto se encontró en la QA del despliegue controlado a staging del 7 de
agosto de 2026. **Staging siguió en `0b8ebba` y no se modificó.**

---

## Causa raíz

El endpoint del PDF (`quotes.controller.ts`) pasaba al generador **solo tres
cifras**: `subtotal`, `discount` y `total`. Nunca `shipping`, `adjustment`,
`adjustmentLabel`, `taxRate`, `taxTotal` ni `lineDiscountTotal`.

El resultado, con una cotización que usaba todos los conceptos:

```
Subtotal      $ 400.000
Descuento   - $  25.000
TOTAL         $ 487.900
```

**400.000 − 25.000 = 375.000, no 487.900.** El total era correcto —el cálculo y
la persistencia siempre lo fueron—; lo que faltaba era el desglose que lo
justifica. Un cliente que sume las líneas del papel no llega al total.

## Por qué apareció al habilitar los campos económicos

Hasta que transporte, impuesto y ajuste fueron alcanzables desde la API, **toda
cotización los tenía en cero** y el documento cuadraba por casualidad: subtotal
menos descuento *era* el total. Al hacerlos usables, el hueco quedó a la vista.

Lo introdujo la corrección anterior, y en concreto por una razón concreta: se
actualizaron el documento imprimible de React y la pantalla de detalle, pero el
**PDF lo genera PDFKit en el servidor por otro camino** que no se tocó. Tres
superficies decidiendo por separado qué filas enseñar.

## Segundo defecto: la etiqueta del ajuste

`adjustmentLabel` se aceptaba al **crear** —el DTO la declara, la petición
devolvía 201— y `createFromLead` la descartaba en silencio. Editar después sí
funcionaba, lo que lo hacía más confuso todavía.

---

## Contrato económico único

`quote-desglose.ts` es ahora el **único sitio** donde se decide qué conceptos
aparecen, en qué orden y con qué signo:

| Concepto | Signo | Nota |
|---|---|---|
| Subtotal bruto | + | `subtotal + lineDiscountTotal` |
| Descuentos por línea | − | solo si los hay |
| Descuento general | − | solo si lo hay |
| Transporte | + | solo si lo hay |
| Ajuste (con su etiqueta) | ± | el único que puede restar libremente |
| IVA *n* % | + | o informativo si va incluido |
| TOTAL | | destacado, siempre el último |

**Se parte del bruto y se resta.** `subtotal` ya lleva descontados los
descuentos de línea; enseñarlo como primera fila y *además* restarlos los
contaría dos veces, y presentarlos como fila que no suma dejaría al lector con
una cifra que sobra. Partiendo del bruto, **todas las filas son sumables**, que
es lo que hace el documento defendible.

**Con impuesto incluido la fila es informativa** y la etiqueta lo dice: el
impuesto ya está dentro de los precios y sumarlo otra vez desviaría el papel un
19 % entero.

`desgloseCuadra()` es la red de seguridad: si algún día se añade un concepto y
se olvida incluirlo, el documento imprime un aviso en lugar de salir sin cuadrar.

El PDF **recibe el resultado ya calculado**. No recalcula nada, no confía en
valores del cliente, y `Decimal` sigue siendo la autoridad: las cifras llegan
resueltas por el servidor y solo redondeadas para presentar.

El frontend sigue las mismas reglas. No puede importar el módulo del backend
—son dos aplicaciones—, así que la garantía son pruebas en ambos lados que
exigen la misma lista de etiquetas y la misma aritmética.

---

## Prueba de regresión

`quote-document.regresion.spec.ts` reproduce el caso exacto de staging y
**reconstruye la aritmética desde las cifras impresas**, no desde los datos de
entrada. Antes de la corrección fallaba con `Expected: 487900, Received: 375000`
— la discrepancia exacta observada.

### Cómo se lee un PDF de verdad

El texto de un PDF de PDFKit va **comprimido** y además **codificado en
hexadecimal por glifo**: `<434f><54495a41><4349d34e>` es «COTIZACIÓN». Buscar
cadenas ASCII en el archivo no encuentra nada y da una falsa sensación de que
todo está bien — **esa fue exactamente la trampa al verificarlo a mano la
primera vez**, y el motivo de que el defecto llegara a QA sin detectarse.

`quote-pdf.texto.ts` descomprime los flujos y decodifica los operadores `TJ`.
Vive en un módulo propio y no dentro de un `.spec` porque importar un fichero de
pruebas desde otro arrastra sus `describe` y los recuentos dejan de significar
nada.

---

## Evidencia

### El papel, después

```
Subtotal bruto          $ 500.000
Descuentos por línea  - $ 100.000
Descuento general     - $  25.000
Transporte              $  50.000
QA_HOTFIX_ rebaja     - $  15.000
IVA 19%                 $  77.900
TOTAL                   $ 487.900
```

500.000 − 100.000 − 25.000 + 50.000 − 15.000 + 77.900 = **487.900**. Cuadra.

### Maquetación

Verificado sobre el PDF generado: el desglose completo **cabe en una página**,
el total no queda huérfano cuando el documento pagina con 40 líneas, la marca
de la empresa se conserva, y una etiqueta de ajuste larga **se parte en varias
líneas dentro de su columna sin recortarse** ni invadir la del importe.

### Paridad base / API / PDF

`quotes-pdf-paridad.e2e-spec.ts` recorre el camino entero contra la base real:
crea la cotización, la edita, la lee como lo hace el endpoint, genera el PDF y
compara. En staging el total coincidía y el desglose no, así que comprobar solo
el total no habría detectado nada.

---

## Resultados

| Comprobación | Resultado |
|---|---|
| Backend unitarias | **2.105** |
| Backend E2E | 819 de 825 |
| Frontend | 435 |
| Typecheck, lint, build (ambos) | verde |
| Prisma validate | válido |
| Docker backend y frontend | construyen |
| Migraciones | **ninguna** — el campo ya existía |

## Limitación conocida

**Dos suites E2E son frágiles bajo carga paralela:**
`flowbot-transporte.e2e-spec.ts` y `token-rotation.e2e-spec.ts`. Fallan de forma
intermitente al ejecutar toda la E2E a la vez, y en pruebas distintas cada vez.

Comprobado en un árbol de trabajo aparte: **`main` (`0b8ebba`) falla exactamente
en la misma prueba de rotación de claves** bajo la suite completa, y las de
FlowBot pasan 36 de 36 aisladas en ambas ramas. **No lo introduce esta
corrección**, pero conviene arreglarlo: una suite que falla al azar acaba
enseñando a ignorar los rojos.

Ninguna prueba de cotizaciones ni de PDF falla en ninguna ejecución.
