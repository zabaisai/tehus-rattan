# Motion — TAKTO

## Principio: TAK → TO
La animación de marca revela **primero TAK** (color principal) y **después TO** (secundario), reforzando la lectura TAK|TO y el concepto de *la jugada* (movimiento y cierre).

## Parámetros (tokens de movimiento)
- Entrada TAK: `320ms`, `cubic-bezier(.16,1,.3,1)`, delay `50ms`.
- Entrada TO: `320ms`, misma curva, delay `300ms` (leve solape).
- Desplazamiento sutil ±4px + fundido de opacidad.

## Reduced motion
`@media (prefers-reduced-motion: reduce)` → el logo aparece **completo, sin desplazamiento ni animación**. Incluido tanto en el SVG (`takto-logo-motion.svg`) como en el CSS (`takto-motion.css`).

## Archivos
- `takto-logo-motion.svg` — SVG autocontenido (trazado a curvas, sin dependencia de fuente).
- `takto-motion.css` — clases `.takto-logo .takto-tak/.takto-to` para web.
- `motion-demo.html` — demostración local.
