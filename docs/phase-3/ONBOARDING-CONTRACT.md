# Fase 3 — Contrato del onboarding guiado

Complementa `docs/phase-1/ONBOARDING-CONTRACT.md` (plantillas, settings v2,
invariantes del pipeline) y `docs/phase-2/CONFIGURATION-CONTRACT.md` (región
y `TenantConfigurationV1`). Aquí solo lo que la Fase 3 añade o precisa.

## Endpoints

| Método | Ruta | Acceso | Uso |
|---|---|---|---|
| GET | `/onboarding/templates` | público, throttle por IP | Plantillas **v3** + límites. Sin datos de empresa |
| POST | `/onboarding/invitation/check` | header `X-Onboarding-Invite-Code`, `OnboardingInviteGuard`, throttle de onboarding | **Nuevo.** Comprueba el código sin consumirlo. `201 { valid: true }` o `400` con motivo: «inválido», «revocado», «ya utilizado», «vencido». No devuelve preview, empresa prevista ni fechas |
| POST | `/onboarding/company` | mismo header y guardia | Crea la empresa. Acepta ahora `company.timezone`, `company.currency`, `company.locale` (opcionales) y acota `company.country` a 80 caracteres |

El código viaja **solo** en el header (CORS ya lo permite desde la Fase 1);
nunca en la URL, `localStorage`/`sessionStorage`, logs (se registra
`invitationId`) ni auditoría (solo `codePreview` parcial). Los códigos `TEHUS`
activos siguen valiendo: la comparación es por hash y estado, no por prefijo.

## Payload final (`CreateOnboardingCompanyDto`)

```jsonc
{
  "company": {
    "name": "Clínica QA", "businessType": "solo con «Otro»",
    "city": "…", "country": "Costa Rica",
    "timezone": "America/Costa_Rica", "currency": "CRC", "locale": "es-CR",
    "phone": "…", "email": "…", "website": "…", "description": "…"
  },
  "branding": { "primaryColor": "#…", "accentColor": "#…", "backgroundColor": "#…" },
  "commercial": {
    "sellsProducts": true, "sellsServices": true,
    "usesCatalog": true, "usesQuotes": false, "usesTasks": true,
    "categories": ["Consultas", "Vacunas"],
    "industry": "veterinary_pet", "businessType": "vet_petshop", "businessModel": "mixed"
  },
  "pipeline": { "name": "Citas y pedidos", "typedStages": [{ "name": "…", "type": "OPEN|WON|LOST" }], "templateKey": "vet_petshop" },
  "admin": { "name": "…", "email": "…", "password": "política real" },
  "agents": [{ "name": "…", "email": "…", "password": "…", "role": "AGENT" }]
}
```

El servidor valida **el resultado final**, no la sugerencia: whitelist estricta
(`forbidNonWhitelisted`) — `companyId`, `status`, `isDemo`, roles distintos de
`AGENT`, campos desconocidos → 400; región con los normalizadores de la Fase 2
(IANA, ISO 4217 en mayúsculas, BCP 47 canónico, país ≤ 80) → 400 **antes** de
abrir la transacción o consumir el código; categorías normalizadas (dedupe
sin mayúsculas, ≤ 60, ≤ 30); etapas con `validateTypedStages`; industria/tipo
válidos y coherentes; «Otro» exige descripción; contraseñas con
`IsStrongPassword`; emails únicos (409).

## Creación atómica (sin cambios de fondo, verificada por e2e HTTP)

Una transacción: *claim* atómico del código (`updateMany … status ACTIVE`),
empresa (con región en columnas y `settings` v2), administrador, sesión,
asesores (`AGENT` forzado), pipeline `isDefault` y etapas tipadas con una
inicial, enlace de la invitación, auditoría. Logos después del commit con
compensación (`cleanupFailedCompany`, que ahora también borra sesión y eventos
de login del administrador). Dos peticiones simultáneas con el mismo código →
exactamente una empresa; el reintento tras el éxito → 400 «ya utilizado»
(resultado controlado, nunca una segunda empresa). Un fallo de validación deja
el código `ACTIVE` y ningún registro nuevo.

## Auditoría

`USE_INVITATION_CODE` (`entityType InvitationCode`, actor = administrador
creado, `affectedCompanyId`) con `metadata.onboarding`:
`templateVersion`, `industry`, `businessType`, `businessModel`, `modules`,
`categoriesCount`, `stagesCount`, `agentsCount`, `regional`
(`country/timezone/currency/locale` elegidos o `null`), `branding` (bool).
Nunca contraseñas, hashes, código completo, tokens ni logos (probado).

## Asistente (frontend)

Orden: Código → Datos de empresa (nombre, **industria**, datos informativos)
→ **Región** (país → zona/moneda/idioma propuestos, editables) → **Forma de
vender** → **Recomendación** (plantilla recomendada explicada; usar / otra /
manual) → Módulos → Categorías (solo con catálogo) → Pipeline → Branding →
Administrador → Asesores → **Confirmación** → creación.

- Textos en español natural: «Vendo productos y servicios», «Tipo de
  negocio», «Pipeline inicial», «Etapas comerciales», «cierre ganado /
  perdido». Nunca `PRODUCT`, `SERVICE`, `vertical`, `pipelineDefaults`.
- **Un solo constructor de payload** (`buildOnboardingPayload` en
  `lib/onboarding-wizard.ts`): el resumen se pinta desde ese objeto y es el
  que se envía; cada bloque del resumen tiene «Editar» que vuelve a su paso.
- Doble envío: botón deshabilitado + guarda de reentrada.
- Error del servidor: el estado se conserva y se muestra el mensaje accionable
  con foco; si la empresa se creó pero la sesión automática falla, se muestra
  el éxito (y `/login?created=1` avisa) en vez de un falso error.

## Procedencia y protección de ediciones (`EditedFlags`)

| Sección | Se marca «editada» cuando… | Qué la puede reemplazar |
|---|---|---|
| `regional` | se cambia zona, moneda o idioma a mano | Elegir país con ediciones → aviso con **Conservar mis cambios** / **Aplicar los valores del país**; «Volver a los valores de <país>» |
| `businessModel` | se elige la forma de vender | Nunca en silencio: la plantilla conserva la forma elegida (y lo explica) |
| `modules`, `categories`, `pipeline` | se toca cualquier control del paso | Cambiar de plantilla con ediciones → diálogo **Conservar mis cambios** (solo se actualiza lo no editado) / **Aplicar las nuevas recomendaciones**; «Restaurar sugerencias» por sección; **Restablecer recomendaciones** global en el paso de recomendación |

Reglas: la primera plantilla carga todas las recomendaciones; lo no editado
sigue a industria y forma de vender; atrás/adelante no pierde datos; un error
del backend no reinicia; **sin `sessionStorage`** (decisión documentada: nada
del código ni contraseñas se persiste; recargar reinicia).

## Accesibilidad

Stepper `<nav aria-label>` + `aria-current="step"` + estado textual
(completado/actual/pendiente); barra de progreso móvil con nombre y valores;
errores `role="alert"` con foco; campos con `aria-invalid` /
`aria-describedby` vía `Field`; foco al encabezado del paso al cambiar;
`motion-reduce:transition-none`; sin scroll horizontal (QA 320–1440).
