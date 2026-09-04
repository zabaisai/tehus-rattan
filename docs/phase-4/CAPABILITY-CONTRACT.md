# Fase 4 — Contrato de capacidades por empresa

## Qué es una capacidad

Algo que el CRM puede hacer para UNA empresa. Hay dos grupos:

| Grupo | Capacidades | Comportamiento |
|---|---|---|
| `core` (plataforma/base) | `conversations`, `contacts`, `opportunities`, `pipeline` | Siempre activas. No se configuran. Además, autenticación, perfil, cierre de sesión, configuración de empresa, soporte y administración de plataforma (SUPER_ADMIN sin empresa) quedan fuera del registro: nunca dependen de la configuración de un tenant. |
| `commercial` (configurables) | `catalog`, `quotes`, `tasks` | Las gobierna `Company.settings.commercial.uses{Catalog,Quotes,Tasks}`; un ADMIN o SUPER_ADMIN de la empresa las activa o desactiva desde Configuración. |

Fuente única en el backend: `apps/backend/src/modules/companies/tenant-capabilities.ts`
(`CAPABILITY_REGISTRY`, `resolveEffectiveCapabilities`, `ModuleDisabledException`).
Nadie más decide si un módulo está activo.

## Registro (`CAPABILITY_REGISTRY`)

Cada definición describe: `key`, `label`, `description`, `group`, `alwaysOn`,
`configurable`, `settingsFlag`, `dependsOn` (duras), `relatedTo` (de creación),
`legacyDefault`, `frontendRoutes`, `apiOperations`, `navItems`, `quickActions`,
`widgets`, `searchTypes`. La vista pública (`definitions` en la respuesta) solo
publica `key, label, description, group, alwaysOn, configurable, dependsOn,
relatedTo`; rutas y banderas internas no viajan al navegador.

| Clave | Etiqueta | Bandera | `dependsOn` | `relatedTo` | Rutas frontend | API gobernada |
|---|---|---|---|---|---|---|
| `catalog` | Catálogo | `usesCatalog` | — | — | `/dashboard/products` | `/products/**` (incl. importación), `/leads/:leadId/products/**`; búsqueda tipo `productos` |
| `quotes` | Cotizaciones | `usesQuotes` | — | `catalog` | `/dashboard/quotes/**` | `/quotes/**`; búsqueda tipo `cotizaciones` |
| `tasks` | Tareas | `usesTasks` | — | — | `/dashboard/tasks` | `/tasks/**`, `/task-suggestions/**` |

## Resolución efectiva (regla de compatibilidad)

`resolveEffectiveCapabilities(settings)` decide con las banderas **declaradas**
(`NormalizedCompanySettings.declaredFlags`, solo booleanos presentes en el JSON):

- Bandera declarada → se respeta (`true`/`false`).
- Bandera **no declarada** (empresa v0 sin settings, o v1 sin esa clave) →
  `legacyDefault` = **activa**. Se informa en `capabilities.legacyDefaultsApplied`.
- `sellsProducts`/`sellsServices` no declaradas → `false` (modelo desconocido,
  nunca «vende ambos» por suposición).

Consecuencia: una empresa anterior a la configuración sigue viendo y usando su
catálogo, cotizaciones y tareas exactamente como antes. Solo un `false`
explícito desactiva. Desactivar nunca borra datos.

El PATCH fusiona sobre las banderas **efectivas**
(`resolveEffectiveCommercial`), no sobre las normalizadas: desactivar un
módulo en una empresa legacy no apaga los otros dos al escribir el JSON v2.

## Dependencias

- Duras (`dependsOn`): hoy ninguna. `moduleDependencyViolation` es el punto de
  control del PATCH; añadir una dependencia es cambiar el registro.
- De creación (`relatedTo`): `quotes → catalog`. Crear una cotización exige
  elementos del catálogo adjuntos a la oportunidad (`QuotesService.createFromLead`);
  leer, enviar, aceptar o rechazar cotizaciones no. Las plantillas v3
  `services`, `interior_design`, `consulting`, `agency` y `projects` activan
  cotizaciones sin catálogo a propósito, por eso NO es dura. La interfaz avisa.

## Tipo de elemento del catálogo según el modelo comercial

| `identity.businessModel` | `allowedItemTypes` | `defaultItemType` |
|---|---|---|
| `products` | `['PRODUCT']` | `PRODUCT` |
| `services` | `['SERVICE']` | `SERVICE` |
| `mixed` o `null` (desconocido/legacy) | `['PRODUCT','SERVICE']` | `PRODUCT` |

Se aplica en `POST/PATCH /products` (400 con motivo en español) y en la
importación (fila fallida con motivo; celda vacía → default efectivo). Las
filas heredadas del otro tipo (o con `itemType NULL`, leído como `PRODUCT`) se
siguen listando y editando; no se convierten (backfill = Fase 5).

## Respuesta `TenantConfigurationV1` (aditivo, contrato 1)

```json
{
  "modules": { "conversations": true, "contacts": true, "opportunities": true, "pipeline": true,
               "catalog": true, "quotes": true, "tasks": false },
  "capabilities": {
    "legacyDefaultsApplied": ["catalog"],
    "catalog": { "allowedItemTypes": ["SERVICE"], "defaultItemType": "SERVICE" },
    "definitions": [ { "key": "catalog", "label": "Catálogo", "description": "…", "group": "commercial",
                       "alwaysOn": false, "configurable": true, "dependsOn": [], "relatedTo": [] } ]
  }
}
```

`modules` pasa a ser el resultado **efectivo**. Esquema publicado:
`docs/contracts/tenant-configuration.v1.schema.json` (`x-phase4`), validado por
`tenant-configuration.contract.spec.ts` contra una respuesta real.

## Guard de módulo (API)

- Decorador `@RequiresTenantCapability('catalog' | 'quotes' | 'tasks' | …)`
  (`src/common/decorators/requires-tenant-capability.decorator.ts`), a nivel de
  controlador; un handler puede sobrescribirlo.
- `TenantCapabilityGuard` (`companies/tenant-capability.guard.ts`) va después de
  `AuthGuard('jwt')` y `BusinessTenantGuard`. Lee `req.user.companyId` (token +
  sesión), resuelve `TenantConfigurationService.resolveCapabilities(companyId)` y
  responde:

```json
{ "statusCode": 403, "error": "Forbidden", "code": "MODULE_DISABLED",
  "module": "catalog", "message": "El módulo Catálogo no está activo para tu empresa" }
```

  Sin metadato no opina; un metadato desconocido nunca abre la puerta; sin
  empresa en el token responde 403 sin consultar. Ignora `companyId` en cuerpo,
  query o headers.
- Caché: `resolveCapabilities` cachea por `companyId` durante
  `CAPABILITIES_CACHE_TTL_MS` (5 s), aislada por clave, invalidada al escribir
  la configuración (éxito o error) en el mismo proceso. Una empresa inexistente
  responde 404 y no se cachea. Pruebas: `tenant-configuration.capabilities.spec.ts`.
- La búsqueda global (`/search`) no lleva guard: filtra los tipos gobernados
  por módulos desactivados en el servidor (`tiposPermitidos`), aunque se pidan.
- Fuera del guard: `/companies/me/**` (para reactivar), auth, perfil, plataforma,
  webhooks, workers y automatizaciones internas (no reciben peticiones de
  usuario; su función no cambia en esta fase).

## Administración de módulos

`PATCH /companies/me/configuration` (ADMIN/SUPER_ADMIN, `BusinessTenantGuard`,
`RolesGuard`): `modules.{catalog,quotes,tasks}` booleanos; `companyId` y claves
desconocidas → 400 por whitelist; transacción con `FOR UPDATE`; auditoría
`company.configuration.update` con secciones y campos, sin valores. La
respuesta es la configuración canónica, con la que el frontend actualiza su
caché sin volver a iniciar sesión.

## Frontend

`apps/frontend/src/lib/tenant-capabilities.tsx`: `TenantCapabilitiesProvider`
(montado en el shell autenticado), `useTenantCapabilities()` (`status`,
`can(key)`, `catalog`, `definitions`, `apply(configuration)`), `capabilityForPath`,
`catalogVocabulary`, `isLegacyItemType`. Mientras la configuración no se conoce,
`can()` es `false`: los módulos opcionales no aparecen ni consultan nada. Ver
`MODULE-MATRIX.md` y `DYNAMIC-CATALOG.md`.
