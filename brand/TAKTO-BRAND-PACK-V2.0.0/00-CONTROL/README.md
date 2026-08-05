# TAKTO-BRAND-PACK-V2 — indice

Paquete profesional de identidad **TAKTO** ("La jugada"). Construido desde los vectores originales
(`02_Logo_Source`) y los tokens (`10_Design_Tokens`) del proyecto REBUILD-2026, **sin rediseñar** la marca.

## Como navegar
- Abre **`brand-review.html`** para el control visual de todo el sistema.
- `TAKTO-BRAND-MANIFEST.json` — manifiesto tecnico (paleta, geometria, contraste, pendientes).
- `brand-asset-inventory.csv` — inventario de cada activo (tipo, bytes, sha256).
- `checksums-sha256.txt` — verificacion de integridad.
- `decisiones-obligatorias.md` — decisiones bloqueadas.

## Estructura
00-CONTROL · 01-LOGOS · 02-COLOR-TOKENS · 03-TIPOGRAFIA · 04-ICONOGRAFIA · 05-FAVICON-PWA ·
06-MOTION · 07-PRODUCT-UI · 08-EMAIL-DOCUMENTOS · 09-SOCIAL-MARKETING · **10-CRM-EXPORT** (unica lista para integrar) · 99-NO-USAR

## Totales
205 archivos (sin contar los 3 indices auto-excluidos del checksum).

## Importante
No se integra nada en el CRM todavia. La integracion la ejecuta Claude Code desde VS Code con `10-CRM-EXPORT`.
