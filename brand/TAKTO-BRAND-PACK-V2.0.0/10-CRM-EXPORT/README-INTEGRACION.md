# 10-CRM-EXPORT — Paquete listo para integracion

Esta es **la unica carpeta lista para entregar a Claude Code** e integrar en el CRM.
Autocontenida: logos, favicons/PWA, iconos, tokens, motion y fuentes con licencia.

## Contenido
- `assets/logos/` — SVG de marca (editables + wordmark trazado).
- `assets/favicons/` — favicon.ico/svg, PNG 16/32/48, apple-touch 180, PWA 192/512, maskable 512, OG 1200x630, `site.webmanifest`, `head-snippet.html`.
- `assets/icons/` — set de iconos de linea (currentColor).
- `tokens/` — `takto-tokens.json`, `takto-tokens.css`, `takto.tailwind.preset.js`.
- `motion/` — `takto-motion.css`, `takto-logo-motion.svg`.
- `fonts/` — Archivo + IBM Plex Sans/Mono (OFL 1.1) + licencias.
- `CRM-ASSET-MANIFEST.json` — indice + reglas + puntos de entrada.

## Reglas de marca que la integracion DEBE respetar
1. Wordmark **TAK** principal / **TO** secundario (solo color).
2. Naranja `#FF6A00` **no** como texto fino sobre claro (usar `#C24A00`).
3. Botones naranjas con **texto navy** `#131C4A`.
4. Isotipo compacto, sin abrir el canal central.
5. No mezclar la marca TAKTO con identidades de empresas cliente.

## Importante
No se integra nada todavia. Este paquete es la **entrega**; la integracion la ejecuta Claude Code desde VS Code.
No incluye secretos, `.env`, `node_modules` ni codigo del CRM.
