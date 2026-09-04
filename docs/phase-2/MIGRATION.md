# Fase 2 — Migración

Una sola migración Prisma, **aditiva y sin backfill**:
`apps/backend/prisma/migrations/20260903180000_tipo_de_elemento_de_catalogo/migration.sql`.

## SQL (revisado a mano)

```sql
-- 1. Enum
CREATE TYPE "CatalogItemType" AS ENUM ('PRODUCT', 'SERVICE');
-- 2. Columna nullable SIN default: las filas existentes quedan en NULL
ALTER TABLE "products" ADD COLUMN "itemType" "CatalogItemType";
-- 3. Default solo para inserciones futuras
ALTER TABLE "products" ALTER COLUMN "itemType" SET DEFAULT 'PRODUCT';
-- 4. Índice del listado (empresa + activos + tipo)
CREATE INDEX "products_companyId_isActive_itemType_idx" ON "products"("companyId", "isActive", "itemType");
```

## Por qué en ese orden

Prisma habría generado `ADD COLUMN "itemType" … DEFAULT 'PRODUCT'` en una sola
sentencia. En PostgreSQL eso hace que **todas las filas existentes lean
`'PRODUCT'`** (un backfill lógico, aunque no reescriba páginas). La Fase 2 exige
que las filas anteriores queden en `NULL` hasta el backfill auditable por
empresa de la Fase 5, así que la columna se añade sin default y el default se
fija después: aplica solo a lo que se inserte a partir de ahí.

Verificación: `prisma migrate diff --from-url <bd> --to-schema-datamodel`
tras aplicar la migración no muestra ninguna diferencia en `products`
(el estado final —columna nullable con default— coincide con el `schema.prisma`).

## Qué NO hace

- No hay `UPDATE`, `DROP`, `TRUNCATE`, renombres ni cambios en `LeadProduct`,
  `QuoteItem`, la tabla `products` ni las rutas `/products`.
- No toca `companies` ni `Company.settings`: la configuración regional usa las
  columnas que ya existían (`timezone`, `currency`, `locale`, `country`) y la
  auditoría usa `audit_logs` tal cual.

## Compatibilidad con el código anterior

El código previo a la Fase 2 no conoce la columna: no la lee ni la escribe, y
sus inserciones reciben `PRODUCT` por el default. Por eso un rollback de
aplicación (release anterior) convive con la columna sin tocarla.

## Comportamiento de la aplicación sobre `NULL`

| Operación | Resultado |
|---|---|
| `GET /products`, `GET /products/:id`, productos de una oportunidad | `itemType: "PRODUCT"` (tipo efectivo; nunca sale `null`) |
| `GET /products?itemType=PRODUCT` | Incluye las filas en `NULL` |
| `GET /products?itemType=SERVICE` | Solo `SERVICE` |
| `POST /products` sin `itemType` (cliente antiguo) | Persiste `PRODUCT` explícito |
| `PATCH /products/:id` con `itemType: null` | 400 (no se puede poner en `NULL` desde la API) |
| Importación sin columna de tipo | Crea `PRODUCT`; al actualizar por SKU no cambia el tipo existente |

## Datos en staging

Antes del despliegue todos los productos existentes de staging tendrán
`itemType = NULL` tras la migración y se mostrarán como Producto. Ninguno se
modifica (ver `STAGING-EVIDENCE.md`).
