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


## 3.5 Segundo bloque (11 de agosto) — barrido de color y QA autenticada

**Base del bloque:** `5917f89` · **CI verde** sobre ese SHA y sobre `d5f09aa`.

> `d5f09aa` era ya el HEAD real al empezar: un cuarto commit, solo de
> documentación, publicado tras el CI del bloque anterior.

### Decisiones aprobadas, aplicadas

1. **`#A32323` aceptado como token semántico.** Cumple las cinco condiciones:
   se llama `status-error-hover`, se usa solo en el hover destructivo, no
   pertenece a la paleta primaria ni secundaria, existe **una sola vez** en
   `@theme` y ningún componente lo escribe literal (verificado por `grep`).
   **Contraste con texto blanco: 7,44:1 — pasa AA y AAA.** Es además mayor que
   el 5,63:1 del estado en reposo: el botón gana legibilidad al apuntarlo.
2. **La tarjeta «Login» de `BrandingStep` corregida.** Pasa a «Identidad de tu
   empresa» con el texto aprobado. Las muestras se rotulan «Menú lateral» y
   «Cotizaciones» —donde el logotipo del cliente aparece de verdad— y se
   retira toda promesa de branding de empresa en el acceso general.

### Barrido de color: 255 usos, 0 clases genéricas restantes

No fue sustitución global. Medir el contraste antes de tocar cambió el
resultado en dos categorías enteras:

| Token | Como texto (blanco / su superficie) | Decisión |
|---|---|---|
| `status-error` | 5,63:1 / 4,85:1 ✅ | migrado tal cual |
| `status-info` | 5,67:1 / 4,91:1 ✅ | migrado tal cual |
| `status-success` | **4,36:1 / 3,87:1 ❌** | solo icono, borde y relleno |
| `status-warning` | **4,24:1 / 3,89:1 ❌** | solo icono, borde y relleno |

Migrar `text-emerald-700` (5,21:1 hoy) al token oficial habría sido una
**regresión medible**. Como icono o relleno los oficiales sí cumplen (3:1).

De ahí los dos tokens nuevos, aprobados: **`status-success-strong` `#0C734F`**
y **`status-warning-strong` `#945800`**, derivados con el mismo factor ×0,83
que produjo `#A32323`. Quedan en 5,86:1 y 5,75:1 sobre blanco.

Esto corrige además el **`Badge` ya desplegado desde `3f7cb04`**, que llevaba
ese texto a 10px con 3,87:1.

### Botones de éxito y aviso: relleno claro, texto oscuro

Rellenos sólidos con texto blanco daban 3,19:1 y 3,77:1 con los genéricos, y
seguirían fallando con los oficiales (4,24:1 y 4,36:1). Nuevas variantes
`success` y `warning` de `Button`: superficie de estado con el tono `*-strong`
encima, hover al 10 % (al 20 % el texto caía a 4,11:1).

`ConfirmDialog` cambia `confirmClassName` por `confirmVariant`. Pasar `bg-…`
en crudo competía con el `bg-…` de la variante y ganaba el que quedara más
abajo en el CSS compilado, no el que se escribiera después.

---

## 4. Clasificación aplicada a cada uso

| Categoría | Tratamiento |
|---|---|
| Superficie de plataforma | tokens `surface-*` |
| Texto | `content-primary` / `content-secondary` / `content-disabled` |
| Borde | `line-default` / `line-strong` |
| Foco | `line-focus`, siempre el mismo |
| Acción primaria | `brand-primary` |
| Acción secundaria | `Button variant="secondary"` |
| Éxito · advertencia | superficie + `*-strong` |
| Error · información | tokens oficiales |
| Acción destructiva | `status-error` + `status-error-hover` |
| **Color dinámico de empresa** | **intacto** |
| **Color de documentos del cliente** | **intacto** |
| **Colores de etapa de pipeline** | **intactos** (`pipeline-*`, son datos) |

---

## 5. QA autenticada local

Producto levantado entero: Postgres en Docker, backend NestJS, frontend Next.
**56 migraciones aplicadas, 0 pendientes** en la base local.

Datos QA por los **endpoints oficiales**, nunca por escritura directa:
`platform:create-super-admin` → `POST /admin/invitation-codes` →
`POST /onboarding/company`. Todo con prefijo `QA_BRAND_` y correos `@qa.invalid`.
Ninguna credencial se imprimió, se guardó en el repo ni aparece en el diff.

### Recorrido autenticado — 14 pantallas × 5 anchos

Inicio, Contactos, Pipeline, Conversaciones, TAKTO Pulso, Tareas, Productos,
Cotizaciones, Documentos, Automatizaciones, WhatsApp, Empresa, Datos y
Notificaciones, en 1440 / 1280 / 1024 / 768 / 390 px.

**Resultado final: cero desbordes, cero errores de consola, cero campos sin
etiqueta, cero botones sin nombre y cero clases de color genéricas en el DOM.**

Lo que encontró la primera pasada, y se corrigió:

- **Productos**: buscador y filtro con solo `placeholder`, que no es nombre accesible.
- **Empresa**: quince `<label>` **sin `htmlFor`** — pulsarlas no enfocaba nada.
- **Empresa**: el subidor de logo con `className="hidden"`, lo que lo sacaba del orden de tabulación: no se alcanzaba por teclado.
- **Documentos**: celdas de tabla, fechas, nombre de recibido, totales editables y las tres observaciones, con la etiqueta solo como texto al lado.
- **Documentos**: papelera de fila sin nombre accesible.

### Recorrido sin autenticar — 6 rutas × 5 anchos

Raíz, login, onboarding, recuperación, restablecer sin token y con token
inválido. Cero desbordes, cero campos sin etiqueta, cero colores genéricos y
**logotipo TAKTO presente en todas**.

El único error de consola es `401 POST /api/auth/refresh`: el arranque de
sesión de un visitante anónimo. Es el comportamiento correcto, no un defecto.

### Estado de desconexión

Probado bloqueando la API desde el navegador. `ConnectionUnavailable` no
llevaba logotipo: con el servidor caído es lo único que se ve del producto y
parecía una página de error de cualquier sitio. Ahora lleva marca,
`role="status"` con `aria-live` y el botón del sistema.

### Limpieza

Borrado **por ID exacto** en una transacción: 2 empresas, 3 usuarios, 5 códigos
y sus 2 pipelines con 8 etapas.

**Las auditorías NO se borraron.** Sus claves foráneas son `SET NULL`, así que
los 7 registros de la actividad QA sobreviven al borrado, como exige la regla.

Baseline comprobado: antes 10 empresas / 14 usuarios / 14 contactos / 3 códigos;
después **exactamente los mismos**. Auditorías 335 → 342.

---

## 6. Iconos del brand pack — inventario y decisión

20 iconos en `10-CRM-EXPORT/assets/icons`, todos 24×24 y **trazo 1,75**:
`bell calendar company contact dashboard funnel lost message next-step
opportunity phone pipeline quote search send settings tag task-check whatsapp won`.

El `whatsapp.svg` **no es el logotipo de Meta**: es línea propia en la retícula
TAKTO, así que no hay problema de marca de terceros.

**Integrados en este bloque: ninguno.** La razón está en el propio manual
(`04-ICONOGRAFIA/iconografia.md`): *«No mezclar con iconos de otras familias
ni cambiar el grosor de trazo»*. El producto usa `lucide-react` en **74
archivos con 68 iconos distintos**, con trazo 2. Meter 20 iconos de trazo 1,75
al lado crearía exactamente la mezcla que el manual prohíbe, y sustituir solo
algunos es peor que no sustituir ninguno.

Asignación semántica preparada para la fase siguiente:

| Icono oficial | Cubre hoy | Nota |
|---|---|---|
| `whatsapp` | `MessageCircle` | el caso más claro: lucide no tiene icono de WhatsApp |
| `pipeline` | `KanbanSquare` | |
| `opportunity` | `Target` | |
| `won` / `lost` | `CheckCircle2` / `XCircle` | |
| `quote` | `FileText` | |
| `task-check` | `CheckSquare` | |
| `funnel` | `Filter` | |
| `contact` / `company` | `Users` / — | no hay icono de edificio en uso |
| `bell` `search` `send` `settings` `phone` `calendar` `tag` `dashboard` `message` `next-step` | equivalentes lucide | |

**Recomendación:** adopción completa en un bloque propio, fijando
`strokeWidth={1.75}` en los iconos lucide que se conserven para que las dos
familias coincidan. Es un cambio transversal y merece su propia QA.

`99-NO-USAR` **no se abrió en ningún momento**.

---

## 7. Verificación final

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` | ✅ sin errores |
| `eslint` | ✅ 0 errores (1 warning **previo**, en `EstadoTransporte.test.tsx` de `9120b89`) |
| `vitest run` | ✅ **62 archivos, 481 pruebas** |
| `next build` | ✅ compila, todas las rutas |
| QA autenticada | ✅ 14 pantallas × 5 anchos, sin hallazgos |
| QA anónima | ✅ 6 rutas × 5 anchos, sin hallazgos |
| Backend / Prisma / migraciones | **0 archivos tocados** |
| `brand/` y `99-NO-USAR` | **0 archivos tocados** |
| Secretos o datos QA en el diff | **ninguno** (verificado por `grep`) |

### Una prueba intermitente, no una regresión

`src/lib/axios.test.ts` falló dos veces **mientras la máquina ejecutaba Docker,
backend, frontend y Chrome a la vez**. Son pruebas con `timeout` de 5 s.
Aislada pasa **17/17, cinco veces seguidas**, y el archivo **no se tocó en toda
la rama**. Con la máquina descargada, la suite completa pasa 481/481.

---

## 7.5 Pantallas terminadas, y lo que se dejó intacto a propósito

### Terminadas y verificadas

| Superficie | Estado |
|---|---|
| Raíz `/`, login, recuperación, restablecer | ✅ marca, primitivas y QA |
| Onboarding completo (8 pasos, progreso, éxito) | ✅ |
| Estado de desconexión | ✅ |
| Inicio, Contactos, Pipeline, Conversaciones | ✅ tokens y QA |
| TAKTO Pulso, Tareas, Productos, Cotizaciones | ✅ |
| Documentos, Automatizaciones, WhatsApp | ✅ |
| Empresa, Datos, Notificaciones | ✅ |
| Primitivas `Button` `Badge` `Field` `Input` `Select` `Textarea` `Card` `Modal` `ConfirmDialog` `ListState` `EmptyState` `TaktoLogo` | ✅ |

### Intacto a propósito

- **`components/documents/*`** — las plantillas imprimibles conservan su paleta
  beige/oro (`#E7D7C9`, `#F4EFE6`, `#0B0F10`). Es la **identidad del documento
  de la empresa emisora**; el manual prohíbe sustituirla por TAKTO. Solo se les
  añadieron nombres accesibles, que no cambian un píxel.
- **Colores por defecto de una empresa nueva** (`#A57014`, `#FDDC7F`, `#FAF8F3`)
  en `BrandingStep`, `ConfirmationStep` y `settings/company`. Son identidad del
  cliente, no de la plataforma. Viven en constantes con nombre y comentario.
- **Colores de etapa de pipeline** (`pipeline-*`): son datos, no branding.
- **Colores que cada empresa configura** y que se pintan por `style`.
- Backend, Prisma, migraciones, datos reales, WhatsApp real, Meta, DNS,
  credenciales y producción.

---

## 8. Deuda visual que queda

1. **Iconos del brand pack sin integrar** (sección 6): decisión tomada, trabajo pendiente.
2. **Primitivas que siguen sin existir:** `Table`, `Drawer`, `Tooltip`, `Tabs`, `Spinner`, `Toast`. Quedan 16 archivos con `<table>` a mano.
3. **Formularios aún sin migrar a `Field`:** los modales de contactos, productos, cotizaciones, tareas y plataforma. No tienen defectos de accesibilidad detectados —el recorrido no abre modales—, pero repiten estilos.
4. **Modales y drawers no se abrieron en la QA automática:** el recorrido cubre pantallas, no interacciones. Verificarlos es el siguiente paso natural.
5. **Los tres tonos derivados esperan confirmación de marca.**
6. **Tema oscuro:** sigue sin existir, y sigue siendo trabajo aparte.

---

## 9. Próximo comando seguro

```bash
git checkout feature/takto-brand-ui-integration
git pull --ff-only
```

**No fusionar, no desplegar y no activar producción** sin autorización separada.
