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

**Dónde aparece el acento.** Deliberadamente poco: el contador de mensajes sin
leer, la etiqueta «Sin asignar», y una barra a la izquierda del elemento
activo del menú. Va como borde y no como fondo porque el naranja a pantalla
completa compite con el contenido, y porque así convive con el color propio de
cada empresa sin taparlo.

**La escala `stone` es un puente.** Apunta a los neutrales de marca desde
`@theme`, lo que rebautizó 929 usos de una vez sin tocar componentes. Las
pantallas nuevas usan `neutral-*`; cuando no quede ningún `stone-*` el bloque
se borra y no cambia nada.

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

## Qué NO hay

- **Tema oscuro.** Existía un `prefers-color-scheme: dark` heredado que solo
  invertía el fondo del `body` y dejaba el resto de la interfaz en claro; se
  retiró. Un tema oscuro de verdad es un trabajo aparte, no un media query.
- **Logotipo de la empresa en el PDF.** Descargarlo obligaría a una petición
  de red por documento dentro de una respuesta que el usuario está esperando.
