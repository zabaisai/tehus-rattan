# Sistema de color y tokens — TAKTO

Fuente de verdad: `takto-tokens.json` / `takto-tokens.css` (valores idénticos a los tokens originales del proyecto). Preset de Tailwind en `takto.tailwind.preset.js`.

## Marca
- Primario **navy `#131C4A`** (primary-800): dirige la jerarquía, estructura, texto de marca.
- Secundario **naranja `#FF6A00`** (secondary-500): acento, acción, energía. **Nunca satura.**
- Sobre primario: blanco `#FFFFFF`.

## Reglas de contraste obligatorias
1. El **naranja `#FF6A00` no se usa como texto fino sobre fondos claros** (contraste insuficiente). Para texto naranja legible usar secondary-700 `#C24A00`.
2. Los **botones naranjas usan texto navy profundo** `#131C4A` (`action.onSecondary`), no blanco.
3. Texto principal `#171B24` sobre superficie clara → AAA. Texto secundario `#525A6B` → AA.

## Tokens semánticos (no solo colores de marca)
Superficie (`surface.*`), borde (`border.*`), texto (`text.*`), acción (`action.*`), estado (`status.*`: success/warning/error/info) y **pipeline** (`nuevo, contactado, cotizado, negociacion, ganado, perdido`). Además escalas 50–950 de primary/secondary/neutral.

## Uso
- Fondos de app: `surface.subtle #F7F8FA`; tarjetas `surface.default #FFFFFF`; navegación `surface.inverse #131C4A`.
- Foco: `border.focus #3B477E` + `shadow.focus`.
- Estados de pipeline: usar exactamente los colores `pipeline.*` en chips y bordes de columna.
