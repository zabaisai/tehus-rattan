# Tipografía — TAKTO

Tres familias, tres funciones. Todas con licencia **SIL Open Font License 1.1** (uso libre, comercial e incrustación).

| Rol | Familia | Uso | Pesos incluidos |
|---|---|---|---|
| Marca / titulares | **Archivo** | Logotipo, display, H1–H3 | 400, 500, 600, 700, **800 (ExtraBold = logo)** |
| Interfaz / texto | **IBM Plex Sans** | UI, cuerpo, botones, etiquetas | 400, 500, 600, 700 |
| Datos / código | **IBM Plex Mono** | Cifras, montos, IDs, tablas | 400, 500 |

## Reglas
- El **wordmark** usa Archivo **ExtraBold (800)**, `letter-spacing: -0.03em`. En SVG es texto vivo con la familia Archivo; para imprenta usar las versiones **outlined** de `01-LOGOS/svg-print-outlined/`.
- Titulares en Archivo 700–800 con tracking negativo (`--tracking-display: -0.02em`).
- Cuerpo y UI en IBM Plex Sans 400–600, interlineado `1.5`.
- Montos y cifras en IBM Plex Mono para alineación tabular.

## Escala tipográfica (tokens)
display-1 64 · display-2 48 · h1 36 · h2 28 · h3 22 · body-lg 18 · body 16 · sm 14 · xs 12 (px).

## Licencias
`fonts/Archivo-OFL.txt` y `fonts/IBMPlex-OFL.txt`. Copyright: Archivo © The Archivo Project Authors (Omnibus-Type); IBM Plex © IBM Corp. Ambas OFL 1.1.

## `@font-face` sugerido
```css
@font-face{font-family:"Archivo";font-weight:800;font-style:normal;src:url("/fonts/Archivo-ExtraBold.ttf") format("truetype");font-display:swap}
@font-face{font-family:"IBM Plex Sans";font-weight:400;src:url("/fonts/IBMPlexSans-Regular.ttf") format("truetype");font-display:swap}
```
