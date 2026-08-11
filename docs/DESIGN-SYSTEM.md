# Sistema visual TAKTO

Traducción del paquete de marca (`brand/TAKTO-BRAND-PACK-V2.0.0/10-CRM-EXPORT`)
al producto. Los valores no se retocan: salen tal cual de `takto-tokens.json`.

## Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| Tokens (color, tipografía, radios, sombras) | `apps/frontend/src/app/globals.css`, bloque `@theme` |
| Logotipo | `src/components/ui/TaktoLogo.tsx` |
| Botones | `src/components/ui/Button.tsx` |
| Etiquetas de estado | `src/components/ui/Badge.tsx` |
| Campos de formulario | `src/components/ui/Field.tsx` + `Input` / `Select` / `Textarea` |
| Superficie elevada | `src/components/ui/Card.tsx` |
| Estados de lista y confirmaciones | `src/components/ui/ListState.tsx`, `ConfirmDialog.tsx` |
| Comportamiento de todo diálogo modal | `src/components/ui/useDialogoModal.ts` |
| Fuentes autoalojadas | `src/app/fonts/`, cargadas en `layout.tsx` |
| Iconos de navegador, manifiesto, OG | `apps/frontend/public/` |

Tailwind 4 se configura **en CSS**, no con un preset de JavaScript. El
`takto.tailwind.preset.js` del paquete de marca es la referencia, pero lo que
manda es el bloque `@theme`.

## Las tres reglas que no se pueden romper

Están codificadas en componentes precisamente para que no dependan de que
alguien las recuerde.

1. **El naranja no se usa como texto fino sobre claro.** Para texto existe
   `secondary-700` (#C24A00), que sí tiene contraste.
2. **Un botón naranja lleva texto navy**, nunca blanco: blanco sobre #FF6A00
   no alcanza el contraste mínimo. Lo impone `Button variant="accent"`.
3. **La marca TAKTO no se mezcla con la de las empresas cliente.** En el login
   manda TAKTO —es la puerta del producto—; dentro del espacio de trabajo
   manda la identidad de la empresa, que es su casa.

## Color

| Uso | Token | Valor |
|---|---|---|
| Acción principal, superficies de marca | `brand-primary` | `#131C4A` |
| Acento | `brand-secondary` | `#FF6A00` |
| Texto sobre acento | `brand-primary` | `#131C4A` |
| Éxito / aviso / error / información | `status-*` y `status-*-surface` | ver `@theme` |
| Grises | `neutral-50…950` | azulados, de la familia del navy |

**No queda ni una clase de color genérica de Tailwind** en el frontend. Si
aparece un `red-600` o un `emerald-50` en una revisión, es que alguien se
saltó el sistema.

### Los tres tonos derivados

No vienen del paquete de marca. Existen porque el paquete no cubre estos tres
casos, y están aquí —una sola definición, en `@theme`— para que ningún
componente los escriba literales.

| Token | Valor | Para qué | Contraste |
|---|---|---|---|
| `status-error-hover` | `#A32323` | Hover de acciones destructivas | 7,44:1 con blanco (AAA) |
| `status-success-strong` | `#0C734F` | Texto de éxito | 5,86:1 blanco · 5,21:1 superficie |
| `status-warning-strong` | `#945800` | Texto de aviso | 5,75:1 blanco · 5,27:1 superficie |

Los tres salen de aplicar el **mismo factor ×0,83** al tono oficial, para que
los estados se oscurezcan igual entre sí. **Pendientes de confirmar con marca.**

**Por qué existen los dos `*-strong`.** Los tonos oficiales `status-success`
(#0E8A5F) y `status-warning` (#B26A00) dan 4,36:1 y 4,24:1 sobre blanco, y
3,87:1 y 3,89:1 sobre su propia superficie: por debajo del mínimo para texto.
Como icono, borde o relleno **sí** cumplen —piden 3:1— y ahí se siguen usando
los oficiales. El problema es solo el texto. `status-error` y `status-info` no
lo tienen (4,85:1 y 4,91:1), así que se usan tal cual.

Es el mismo principio que el paquete ya aplica al naranja: `#FF6A00` para
relleno, `secondary-700` para texto.

### Acciones de éxito y aviso: relleno claro, texto oscuro

Igual que el botón naranja, y por el mismo motivo. Rellenar con
`status-success` y poner texto blanco encima da 4,36:1. Las variantes
`success` y `warning` de `Button` usan la superficie de estado con el tono
`*-strong` encima, y tiñen el fondo un 10 % al pasar el ratón —un 20 % ya
bajaba el texto a 4,11:1—.

**Dónde aparece el acento.** Deliberadamente poco: el contador de mensajes sin
leer, la etiqueta «Sin asignar», y una barra a la izquierda del elemento
activo del menú. Va como borde y no como fondo porque el naranja a pantalla
completa compite con el contenido, y porque así convive con el color propio de
cada empresa sin taparlo.

**El puente `stone` ya no existe.** Sirvió para rebautizar los usos de una vez
sin tocar componentes; se retiró cuando no quedó ninguno. Todo es `neutral-*`.

## Tipografía

| Rol | Familia | Dónde |
|---|---|---|
| Marca y titulares | Archivo | `h1`, `h2`, `h3` (por elemento, no por clase) |
| Interfaz y cuerpo | IBM Plex Sans | `body` |
| Cifras, montos, identificadores | IBM Plex Mono | `font-mono` |

Los titulares se aplican **por elemento** para que ninguna pantalla nueva se
quede fuera por olvido. Las fuentes van autoalojadas: ninguna petición sale a
un tercero, que es además lo que exige `font-src 'self'` de la CSP.

## Foco

Hay una regla global en `globals.css` que devuelve un contorno visible a todo
lo interactivo. Es necesaria porque el producto usa `outline-none` en
prácticamente todos sus campos —para quitar el contorno azul del navegador— y
sin reponerlo, quien navega con teclado se queda sin saber dónde está.

No va envuelta en `:where()`: eso la dejaría con especificidad cero y
cualquier `.outline-none` la anularía, que es justo el caso que cubre.

## Movimiento

Curvas y duraciones en `@theme`. Todo se apaga con
`prefers-reduced-motion: reduce`: ninguna animación del producto es
informativa, así que quitarlas no quita nada.

## Diálogos

Todo lo que se anuncie como diálogo debe usar `useDialogoModal`. El hook da
fondo bloqueado, Escape, **foco atrapado** y foco devuelto al disparador.

No es opcional: `aria-modal="true"` le dice al lector de pantalla que el resto
de la página no existe. Un diálogo que lo declara y deja escapar el tabulador
manda al usuario fuera de un contenido que su lector sigue describiendo como el
único que hay. Había cuatro implementaciones y ninguna lo cumplía entera.

Los diálogos se apilan: Escape solo cierra el de arriba, y el fondo sigue
bloqueado mientras quede alguno abierto.

**Un panel que se queda montado para animarse no está cerrado.** El cajón
lateral móvil lo aprendió por las malas: seguía visible para el navegador, con
catorce enlaces tabulables fuera de pantalla. Cuando esté cerrado va con
`inert`, y `role`/`aria-modal` solo se declaran si de verdad está abierto.

## Iconos

El producto usa **`lucide-react`**: 74 archivos, 68 iconos distintos, trazo 2.

El paquete de marca trae 20 iconos de dominio (`funnel`, `pipeline`, `quote`,
`won`, `lost`, `whatsapp`…) con **trazo 1,75**, y su manual dice que *no se
mezclan familias ni se cambia el grosor de trazo*. Por eso **no se ha
integrado ninguno todavía**: meter veinte al lado de sesenta y ocho crearía
justo la mezcla que el manual prohíbe.

La adopción completa —con `strokeWidth={1.75}` en los lucide que se conserven—
es un trabajo transversal con su propia QA. El inventario y la asignación
semántica están en `TAKTO-BRANDING-ESTADO-2026-08-11.md`, sección 6.

## Qué NO hay

- **Tema oscuro.** Existía un `prefers-color-scheme: dark` heredado que solo
  invertía el fondo del `body` y dejaba el resto de la interfaz en claro; se
  retiró. Un tema oscuro de verdad es un trabajo aparte, no un media query.
- **Logotipo de la empresa en el PDF.** Descargarlo obligaría a una petición
  de red por documento dentro de una respuesta que el usuario está esperando.
