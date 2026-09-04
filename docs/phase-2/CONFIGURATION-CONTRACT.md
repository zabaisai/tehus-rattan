# Fase 2 — Contrato de configuración por empresa (`TenantConfigurationV1`)

Esquema publicado: [`docs/contracts/tenant-configuration.v1.schema.json`](../contracts/tenant-configuration.v1.schema.json)
(una prueba, `tenant-configuration.contract.spec.ts`, valida una respuesta real
del motor contra ese esquema en cada CI). Implementación:
`apps/backend/src/modules/companies/tenant-configuration.ts` (reglas puras) y
`tenant-configuration.service.ts` (lectura, transacción, auditoría).

## Qué es y qué no es

- **Es** la vista agregada, tipada y versionada que consume el frontend:
  identidad de origen, región, módulos, categorías y pipeline real.
- **No es** la forma de almacenamiento. `Company.settings` sigue guardándose
  como v0/v1/v2 (ver `company-settings.v2.schema.json`) y el contrato lo
  informa en `storageVersion`. Cambiar el contrato no obliga a migrar datos.

## Fuentes (una sola por dato)

| Sección | Fuente canónica | Notas |
|---|---|---|
| `regional.country/timezone/currency/locale` | Columnas de `companies` | Nunca se duplican en el JSON. Una columna con texto inválido histórico se responde con el default del producto (`America/Bogota`, `COP`, `es-CO`) sin reescribir nada. |
| `identity.industry/businessType/templateVersion` | `settings.vertical` (plantilla de onboarding) o `companies.businessType` (descripción manual) | Metadatos de origen, no editables por este contrato. |
| `identity.businessModel` | **Derivado** de `settings.commercial.sellsProducts/sellsServices` | `products` / `services` / `mixed` / `null` (legacy sin banderas). No se guarda dos veces. |
| `modules.*` | Centrales fijos + `settings.commercial.usesCatalog/usesQuotes/usesTasks` | Conversaciones, contactos, oportunidades y pipeline siempre `true`. |
| `catalog.categories` | `settings.catalog.categories` (v2) o `settings.categories` (v1) | Mismas reglas de normalización que la Fase 1. |
| `pipeline` | `pipelines` / `pipeline_stages` | `isDefault` no archivado → si no hay, primero no archivado por `order, createdAt, id` → `null`. Siempre por `companyId`. Nunca se copia al JSON. |
| `limits` | Constantes del servidor | Categorías (60 / 30) y región (país 80, zona 64, moneda 3, idioma 35). |

## Endpoints

| Ruta | Acceso | Cuerpo | Respuesta |
|---|---|---|---|
| `GET /companies/me/configuration` | `AuthGuard('jwt')` + `BusinessTenantGuard`; cualquier rol de la empresa | — | `TenantConfigurationV1` |
| `PATCH /companies/me/configuration` | + `RolesGuard` (`ADMIN`, `SUPER_ADMIN` con empresa) | `UpdateTenantConfigurationDto` | `TenantConfigurationV1` |
| `GET /companies/me/settings` | cualquier rol | — | Vista Fase 1 (`publicView`) — **compatibilidad**, delega en el motor |
| `PATCH /companies/me/settings` | `ADMIN`, `SUPER_ADMIN` | `UpdateCompanySettingsDto` (Fase 1) | Vista Fase 1 — **compatibilidad**, delega en el motor (misma transacción, reglas y auditoría) |

`companyId` sale SIEMPRE del JWT (`req.user.companyId`), validado contra la
sesión real (`user_sessions`). Ningún DTO lo acepta (`dto-tenant-whitelist.spec.ts`).

## Campos editables (`PATCH /companies/me/configuration`)

```jsonc
{
  "regional":   { "country": "Colombia" | null, "timezone": "America/Bogota", "currency": "COP", "locale": "es-CO" },
  "commercial": { "sellsProducts": true, "sellsServices": false },
  "modules":    { "catalog": true, "quotes": true, "tasks": true },
  "catalog":    { "categories": ["Salas", "Comedores"] }
}
```

Todo es opcional y parcial. Se rechaza con **400** (whitelist +
`forbidNonWhitelisted`, antes de tocar la base):

- `settings`, `storageVersion`, `contractVersion`, `identity`, `pipeline`,
  `pipelineDefaults`, `limits`, `companyId`, `id` y cualquier clave desconocida
  (también dentro de `regional`, `commercial`, `modules`, `catalog`).
- `timezone` / `currency` / `locale` en `null` o de otro tipo.

## Validación regional (servidor, antes de escribir)

| Campo | Regla | Normalización | Ejemplos válidos | Rechazados |
|---|---|---|---|---|
| `timezone` | Identificador IANA (`Area/Lugar…` o `UTC`) que `Intl` resuelva; no se admiten desplazamientos | forma canónica (`america/bogota` → `America/Bogota`) | `America/Bogota`, `America/Costa_Rica`, `UTC` | `Bogota`, `+05:00`, `GMT-5`, `America/Ciudad_Inventada` |
| `currency` | ISO 4217 de tres letras conocido por `Intl.supportedValuesOf('currency')` | mayúsculas (`cop` → `COP`) | `COP`, `USD`, `CRC` | `PESOS`, `ZZZ`, `C0P` |
| `locale` | Etiqueta BCP 47 con idioma real, canonicalizable por `Intl.getCanonicalLocales` | canónica (`es-co` → `es-CO`) | `es-CO`, `es-CR`, `en-US`, `es` | `castellano`, `es_CO`, `x-private` |
| `country` | Texto libre (compatibilidad con la columna actual), máx. 80 | colapsa espacios; vacío/`null` limpia | `Colombia`, `Costa Rica` | 81+ caracteres |

El mensaje de error empieza por la ruta del campo
(`regional.timezone debe ser…`) para que el frontend lo muestre junto al campo.

## Reglas de negocio

1. **Leer nunca escribe.** `GET` de una empresa v0/v1 no la convierte a v2.
2. **Un parche solo regional** escribe columnas y **no** reescribe `settings`
   (una empresa v1 sigue v1).
3. **Editar `commercial`, `modules` o `catalog`** escribe `settings` v2
   conservando `vertical`, `pipelineDefaults` y las claves desconocidas.
4. **Modelo comercial**: una lectura legacy con ambas banderas en falso
   funciona (`businessModel: null`); una edición explícita de `commercial`
   que deje ambas en falso → 400 y nada se escribe.
5. **Desactivar un módulo** no borra categorías, productos, cotizaciones ni
   tareas. La navegación no se oculta todavía (Fase 4).
6. **Un parche vacío** no escribe ni audita.
7. **Concurrencia**: toda escritura ocurre en `prisma.$transaction` con
   `SELECT "id" FROM "companies" WHERE "id" = $1 FOR UPDATE`. Dos PATCH
   simultáneos (región + categorías) conservan ambos cambios; sobre la misma
   sección, gana uno de los dos completo, nunca un estado mezclado.
8. **Auditoría** en la misma transacción (`audit_logs`): `action`
   `company.configuration.update`, `entityType` `Company`, `entityId` =
   empresa, actor (`actorUserId`, `actorRole`) del JWT, `metadata` =
   `{ contractVersion, sections, fields, storageVersion: { before, after } }`.
   Sin valores, sin secretos, sin payloads. Si la auditoría falla, la
   transacción falla.

## Compatibilidad

| Caso | Comportamiento |
|---|---|
| Empresa sin `settings` (v0) | `storageVersion: 0`, modelo `null`, módulos opcionales `false`, categorías `[]`, región de columnas/defaults. |
| Empresa v1 | Banderas planas y `categories`; `identity.businessType` sale de `companies.businessType` si existe. |
| Empresa v2 (onboarding) | Identidad de la plantilla; modelo derivado de las banderas actuales (puede diferir de `vertical.businessModel` si un administrador lo cambió). |
| Pipeline sin `isDefault` | Fallback determinista; nunca se marca ninguno. |
| Sin pipeline | `pipeline: null`. |
| Claves desconocidas en `settings` | Se conservan al escribir y nunca salen al contrato. |
| Clientes de `/companies/me/settings` | Siguen funcionando con la misma respuesta de la Fase 1. |

## Frontend

- Cliente y tipos: `apps/frontend/src/lib/tenant-configuration.ts`
  (`useTenantConfiguration`, `updateMyTenantConfiguration`, avisos previos
  con las mismas reglas: `validateRegionalDraft`).
- Sección administrativa: `apps/frontend/src/components/settings/TenantConfigurationSection.tsx`
  en Configuración → Empresa. Región, modelo comercial, módulos (centrales
  «Siempre activo», opcionales editables) y datos de origen informativos.
  Solo envía lo que cambió; un `AGENT` la ve en solo lectura.
- Categorías: `CompanyCategoriesEditor` (Fase 1) sigue en la misma pantalla
  e invalida también la caché del contrato.
