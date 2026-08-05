# Sistema de logotipo — uso, zona de seguridad y tamaños mínimos

## Estructura del isotipo (no rediseñar)
Retícula **24u × 24u**, banda azul central **3u** constante, escalones en **9u** y **15u**.
La segunda figura (naranja) es la primera **rotada exactamente 180°** sobre el centro (12,12) — nunca redibujada.
Estructura **compacta**: no abrir el canal central (ver `99-NO-USAR`).

- `pathA = M0 0H13V9H8V24H0Z`
- `pathB = M24 24H11V15H16V0H24Z`

## División cromática del wordmark — regla única
**TAK** en color principal · **TO** en color secundario. Separación siempre **TAK | TO**.
Solo por color: sin espacios, líneas, cambios de tamaño, peso ni degradados.

| Variante | TAK | TO | Fondo |
|---|---|---|---|
| Principal | #131C4A | #FF6A00 | claro |
| Negativa | #FFFFFF | #FF6A00 | #131C4A |
| Escala de grises | #171B24 | #6E7688 | claro |
| Monocromática | una tinta | una tinta | según pieza (excepción técnica) |

## Zona de seguridad
Margen de reserva mínimo = **3u** de la retícula del isotipo (equivale a la altura de la banda) alrededor de todo el logo.
En favicons micro (16–24 px) se reduce a **2u** por microóptica (ver `05-FAVICON-PWA`).

## Tamaños mínimos
| Pieza | Mínimo digital | Mínimo impreso |
|---|---|---|
| Isotipo | 24 px (favicon 16 px con reserva 2u) | 8 mm |
| Wordmark | 16 px de altura | 6 mm |
| Lockup horizontal | 96 px de ancho | 24 mm |
| Lockup vertical | 72 px de ancho | 20 mm |

## Archivos
- `svg-editable/` — SVG con color embebido y **texto vivo** (Archivo). Editables.
- `svg-print-outlined/` — wordmark/lockups **trazados a curvas** para imprenta (sin dependencia de fuente).
- `png/` — fondo transparente, escalas @1x/@2x/@3x. `webp/` — mismas piezas optimizadas.

## Prohibiciones
No deformar, rotar, recolorear fuera de la paleta, añadir sombras/contornos, ni invertir la regla TAK|TO.
Naranja **nunca** como texto fino sobre fondos claros.
