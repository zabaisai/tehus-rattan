# TAKTO — Estado de la integración visual

**Rama:** `feature/takto-brand-ui-integration`
**Base:** `main` = `b19217c2e4da69b251285774c1f6585cc29fb765`
**Fecha:** 11 de agosto de 2026 · America/Bogota
**Documento anterior:** `docs/TAKTO-PAUSA-Y-REANUDACION-2026-08-10.md`

> Este archivo continúa el punto de pausa. Se actualiza en cada sesión de
> branding para poder parar sin perder contexto.

---

## 1. Preflight ejecutado (solo lectura)

| # | Comprobación | Resultado |
|---|---|---|
| 1 | Repositorio `C:\Users\Usuario\Desktop\Tehus_Rattan` | ✅ |
| 2 | `.git/index.lock` ausente | ✅ |
| 3 | Working tree limpio; `brand/` sin archivos rastreados | ✅ ignorado en `.gitignore:17` |
| 4 | `main == origin/main` | ✅ `b19217c2e4da69b251285774c1f6585cc29fb765`, 0/0 |
| 5 | CI verde sobre ese SHA | ✅ Frontend `success`, Backend `success` |
| 6 | Staging sano y release registrado | ✅ `/api/health/version` → `b19217c2e4da…`; `/api/health/status` → base, cola, worker, outbox, tiempo real y flowbot en `up` |
| 7 | 56 migraciones aplicadas, 0 fallidas, 0 pendientes | ⚠️ **parcial** — 56 carpetas en `apps/backend/prisma/migrations` y base `up`; no se consultó `_prisma_migrations` |
| 8 | Kill switch, dry-run, allowlists vacías | ⚠️ **no verificado** — requiere sesión autenticada en staging |
| 9 | Cuatro bots sin cambios | ⚠️ **no verificado** — mismo motivo |
| 10 | `10-CRM-EXPORT` existe; `99-NO-USAR` excluido | ✅ 61 archivos |
| — | Checksums del paquete | ✅ 205/205 — 170 idénticos y 35 iguales salvo CRLF; **0 diferencias reales** |

Los puntos 7–9 no se pudieron comprobar directamente y **no se forzaron**: hacerlo
habría exigido credenciales, y la regla 13 del punto de pausa lo prohíbe. Esta
rama no toca backend, Prisma, datos ni transporte, así que no puede alterarlos.

**Endpoints reales de staging** (el documento anterior no los registraba):

- API: `https://api.crm-staging.tehusrattan.com` — subdominio propio, no `/api` del frontend.
- Salud: `/api/health`, `/api/health/live`, `/api/health/ready`, `/api/health/queue`, `/api/health/status`.
- Versión: `/api/health/version` (**no** `/api/version`).

---

## 2. Diferencia encontrada contra el punto de pausa

El documento del 10 de agosto declara *«Branding: desbloqueado, todavía no
integrado»* y describe un alcance de integración desde cero. **Eso ya no era
cierto al reanudar.**

El commit `3f7cb04` (31 de julio de 2026, *feat(branding): adopt the TAKTO visual
identity*), ancestro de `main`, ya había integrado:

- tokens completos en `globals.css` (`@theme` de Tailwind 4): navy/naranja, neutrales de marca, semánticos, etapas del embudo, radios, sombras y curvas;
- las dos reglas del manual codificadas: `#C24A00` para texto naranja fino sobre claro, y botón naranja con texto navy;
- fuentes autoalojadas Archivo / IBM Plex Sans / IBM Plex Mono con licencias OFL;
- favicons, iconos PWA, maskable, webmanifest, OG 1200×630, `themeColor` navy, plantilla de título `%s · TAKTO`, `noindex`;
- `TaktoLogo` como SVG inline con la división cromática TAK navy / TO naranja;
- **117 de 137** archivos `.tsx` usando ya tokens de marca.

Por eso el trabajo de esta rama **no es integrar, es cerrar huecos**. El alcance
del punto de pausa sigue siendo válido como lista de superficies; lo que cambia
es que la mayoría ya estaba hecha.

---

## 3. Qué se hizo en esta sesión

### 3.1 Primitivas de formulario (paso 4 del método)

No existían `Input`, `Select`, `Textarea`, `Card` ni un envoltorio de campo.
Había **60 archivos con `<input>` crudo, 25 con `<select>` y 16 con `<table>`**,
cada uno repitiendo sus clases a mano.

Nuevos, en `apps/frontend/src/components/ui/`:

| Archivo | Qué fija |
|---|---|
| `Field.tsx` | Etiqueta, ayuda y error conectados por contexto: `id`, `aria-describedby`, `aria-invalid`, `role="alert"`. Exporta `CLASES_CONTROL`, el par borde+anillo de foco. |
| `Input.tsx` | Campo de texto |
| `Select.tsx` | Desplegable nativo con flecha propia (`aria-hidden`, `pointer-events-none`, `pr-9`) |
| `Textarea.tsx` | Área de texto |
| `Card.tsx` | Superficie elevada con `border-line-default` / `bg-surface-default` y `padding` opcional |

El foco vivía escrito a mano y había divergido: `neutral-500` en el login,
`#A57014` en el onboarding y **ninguno** en varias pantallas. Ahora sale de
`line-focus`, el token de marca, y es el mismo en los tres controles.

Pruebas: `Field.test.tsx`, 18 casos.

### 3.2 Puerta del producto

`app/page.tsx` mostraba un disco oscuro con la palabra «CRM» en la paleta
beige/oro anterior, sin logotipo y sin decir de qué producto se trataba.
Ahora lleva `TaktoLogo`, fondo `neutral-50` y botones de marca.

### 3.3 Onboarding completo (11 archivos)

Toda la creación de empresa estaba en la paleta anterior (`#0B0F10`, `#A57014`,
`#FDDC7F`, `#F4EFE6`, `#FAF8F3`). El alta ocurre **antes de que exista la
empresa**, así que ahí no hay identidad de cliente que respetar: manda TAKTO.

Migrados: `onboarding/page.tsx`, `OnboardingProgress`, `SuccessScreen`,
`InviteCodeStep`, `CompanyInfoStep`, `BrandingStep`, `CommercialStep`,
`PipelineStep`, `AdminStep`, `AgentsStep`, `ConfirmationStep`.

El panel lateral usa `surface-inverse` con el logotipo en **negativo** —TAK
blanco, TO naranja—, que es la regla del manual para fondo oscuro.

Defectos de accesibilidad corregidos de paso:

- Ninguna `<label>` del onboarding tenía `htmlFor`: pulsarlas no enfocaba nada.
- Los tres campos de cada asesor solo tenían `placeholder`, que no es nombre accesible y desaparece al escribir.
- Los botones de papelera no tenían nombre accesible.
- Los chips de categoría no exponían su estado (`aria-pressed`).
- La barra de progreso móvil no era un `progressbar`.
- Las muestras de color se distinguían solo por color; ahora llevan texto.
- La vista previa de branding usaba `<button>` para elementos que no hacen nada: pasan a `<span>`.

### 3.4 Defecto del sistema: el botón destructivo cambiaba de tono

`Button` variante `danger` usaba `hover:bg-secondary-800` (`#963900`), que es
**naranja oscuro**. El botón de borrar pasaba de rojo a marrón al apuntarlo.

Corregido con `--color-status-error-hover: #a32323`.

> ⚠️ **Ese valor es DERIVADO, no viene del paquete de marca.** El pack no define
> un hover de error (`takto-tokens.json` solo trae `status/error` y
> `status/errorSurface`). Debe confirmarse con marca antes de darlo por oficial.

`ConfirmDialog` y `ListState` pasan a tokens de estado y a `Button`.

---

## 4. Pantallas terminadas y pendientes

### Terminadas

- Página raíz `/`
- Onboarding completo (8 pasos + progreso + éxito)
- Primitivas `Field` / `Input` / `Select` / `Textarea` / `Card`
- `Button`, `Badge`, `ConfirmDialog`, `ListState`, `EmptyState`, `Modal`, `TaktoLogo`

### Pendientes

1. **Barrido de colores de estado.** Quedan **62 archivos** con la paleta por
   defecto de Tailwind donde deberían ir los tokens semánticos:
   `text-red-600` (76 usos), `bg-red-50` (42), `text-red-700` (29),
   `bg-amber-50` (21), `bg-emerald-50` (16), `text-emerald-*`, `bg-sky-50`,
   `bg-blue-50`, `bg-green-*`, `bg-orange-50`. Es el hueco más grande que queda.
2. **Login, recuperación y restablecimiento.** Usan `Input` crudo con foco
   `neutral-500` y colores `green-*`/`red-*` sueltos; deben pasar a las
   primitivas nuevas.
3. **Migrar los 60 archivos con `<input>` crudo** a `Field`+`Input`.
4. **Primitivas que siguen sin existir:** `Table`, `Drawer`, `Tooltip`, `Tabs`,
   `Spinner`, `Toast`. Hay 16 archivos con `<table>` a mano.
5. **Botones de chrome en oro suelto:** `dashboard/quotes/[id]/print/page.tsx:55`
   y `components/quotes/QuoteDetailModal.tsx:264` usan `bg-[#A57014]`. Son
   controles del producto, no del documento: deben ser navy.
6. **20 iconos de dominio del pack** sin integrar (`funnel`, `pipeline`, `quote`,
   `won`, `lost`, `whatsapp`…). Hoy todo es `lucide-react`. Decidir si se
   sustituyen en los puntos de dominio o se mantiene lucide.
7. **QA visual en cinco anchos** (1440, 1280, 1024, 768, 390) autenticada y no
   autenticada. **No ejecutada todavía.**
8. **Panel de plataforma/superadministrador**: revisar que no mezcle identidad
   de empresas.

---

## 5. Qué NO se tocó, a propósito

- **`components/documents/*`** (9 archivos): plantillas imprimibles de
  cotización, remisión, reparación y factura. Su paleta beige/oro
  (`#E7D7C9`, `#F4EFE6`, `#0B0F10`) es la **identidad del documento de la
  empresa emisora**. El manual prohíbe sustituirla por TAKTO.
- **Colores por defecto de una empresa nueva** (`#A57014`, `#FDDC7F`,
  `#FAF8F3`) en `BrandingStep`, `ConfirmationStep` y `settings/company`. Son
  identidad de la empresa cliente, no de la plataforma. Se movieron a
  constantes con nombre y comentario, sin cambiar los valores.
- Backend, Prisma, migraciones, datos, WhatsApp real, Meta, DNS, credenciales
  y producción.

---

## 6. Decisión pendiente para el usuario

La vista previa de `BrandingStep` muestra el logotipo **de la empresa** sobre
una tarjeta rotulada **«Login»**. Eso contradice la decisión ya desplegada en
`3f7cb04`: *en el login manda TAKTO; la identidad de la empresa vive dentro de
su espacio de trabajo*.

No se cambió porque el rótulo describe **dónde aparece el logotipo**, y
corregirlo es una decisión de producto, no de color. Opciones: renombrar la
tarjeta a la superficie donde sí manda la empresa, o retirarla de la vista
previa.

---

## 7. Verificación de esta sesión

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` | ✅ sin errores |
| `eslint` | ✅ 0 errores (1 warning **previo**, en `EstadoTransporte.test.tsx` de `9120b89`, archivo no tocado) |
| `vitest run` | ✅ **62 archivos, 478 pruebas** (477 antes + 1 nueva del hover destructivo) |
| `next build` | ver commit |
| Backend | **no tocado** — 0 archivos modificados |

---

## 8. Próximo comando seguro

```bash
git checkout feature/takto-brand-ui-integration
git pull --ff-only
```

Y a continuación, el hueco mayor: el barrido de colores de estado del punto 4.1.

**No fusionar, no desplegar y no activar producción** sin autorización separada.
