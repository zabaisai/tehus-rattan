-- Fase 2 — Tipo de elemento del catálogo (PRODUCT | SERVICE).
--
-- ADITIVA Y SIN BACKFILL. Cuatro pasos, en este orden y no en otro:
--
--   1. El enum.
--   2. La columna, NULLABLE y SIN default: así las filas existentes quedan en
--      NULL. Si se añadiera con `DEFAULT 'PRODUCT'` en el mismo ALTER,
--      PostgreSQL haría que todas las filas existentes LEYERAN 'PRODUCT'
--      (un backfill lógico), y el backfill auditable por empresa pertenece a
--      la Fase 5. La aplicación trata NULL como PRODUCT al leer.
--   3. El default, que a partir de aquí aplica SOLO a inserciones nuevas.
--   4. El índice que usa el listado (empresa + activos + tipo). La tabla no
--      tenía ningún índice propio.
--
-- No hay UPDATE, DROP, TRUNCATE ni renombres. El código anterior sigue
-- funcionando con la columna presente (no la conoce y no la escribe; el
-- default cubre sus inserciones).
--
-- ROLLBACK (solo si hiciera falta y siempre tras un respaldo):
--   DROP INDEX IF EXISTS "products_companyId_isActive_itemType_idx";
--   ALTER TABLE "products" DROP COLUMN IF EXISTS "itemType";
--   DROP TYPE IF EXISTS "CatalogItemType";
-- En la práctica no se revierte: el código anterior convive con la columna.

-- 1. Enum
CREATE TYPE "CatalogItemType" AS ENUM ('PRODUCT', 'SERVICE');

-- 2. Columna nullable sin default (las filas existentes quedan en NULL)
ALTER TABLE "products" ADD COLUMN "itemType" "CatalogItemType";

-- 3. Default solo para inserciones futuras
ALTER TABLE "products" ALTER COLUMN "itemType" SET DEFAULT 'PRODUCT';

-- 4. Índice del listado
CREATE INDEX "products_companyId_isActive_itemType_idx" ON "products"("companyId", "isActive", "itemType");
