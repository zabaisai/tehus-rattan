-- CreateEnum
CREATE TYPE "StageType" AS ENUM ('OPEN', 'WON', 'LOST');

-- AlterTable
ALTER TABLE "pipeline_stages" ADD COLUMN     "probability" INTEGER,
ADD COLUMN     "type" "StageType" NOT NULL DEFAULT 'OPEN';

-- AlterTable
ALTER TABLE "pipelines" ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "pipeline_stages_pipelineId_order_idx" ON "pipeline_stages"("pipelineId", "order");

-- CreateIndex
CREATE INDEX "pipelines_companyId_isArchived_order_idx" ON "pipelines"("companyId", "isArchived", "order");

-- ─────────────────────────────────────────────────────────────────────────
-- BACKFILL 1 — toda empresa debe tener un pipeline predeterminado.
--
-- En staging hay una empresa sin NINGUN pipeline. La regla de creacion
-- automatica de oportunidades (bloque 7) resuelve "pipeline predeterminado +
-- primera etapa activa", asi que sin esta fila esa regla fallaria para ella
-- en cuanto reciba su primer mensaje.
--
-- Idempotente: el WHERE NOT EXISTS impide crear un segundo pipeline si la
-- empresa ya tiene alguno, de modo que reejecutar la migracion no duplica.
-- ─────────────────────────────────────────────────────────────────────────
WITH nuevos AS (
  INSERT INTO "pipelines" ("id", "name", "isDefault", "order", "isArchived", "companyId", "createdAt", "updatedAt")
  SELECT
    'seed_' || replace(gen_random_uuid()::text, '-', ''),
    'Pipeline comercial',
    true,
    0,
    false,
    c."id",
    now(),
    now()
  FROM "companies" c
  WHERE NOT EXISTS (SELECT 1 FROM "pipelines" p WHERE p."companyId" = c."id")
  RETURNING "id"
)
INSERT INTO "pipeline_stages" ("id", "name", "order", "color", "type", "pipelineId", "createdAt", "updatedAt")
SELECT
  'seed_' || replace(gen_random_uuid()::text, '-', ''),
  etapa."name",
  etapa."order",
  etapa."color",
  etapa."type"::"StageType",
  nuevos."id",
  now(),
  now()
FROM nuevos
CROSS JOIN (VALUES
  ('Nuevo',        0, '#131C4A', 'OPEN'),
  ('Contactado',   1, '#1A2352', 'OPEN'),
  ('Propuesta',    2, '#C24A00', 'OPEN'),
  ('Negociacion',  3, '#FF6A00', 'OPEN'),
  ('Ganado',       4, '#2E7D32', 'WON'),
  ('Perdido',      5, '#8B1E1E', 'LOST')
) AS etapa("name", "order", "color", "type");

-- ─────────────────────────────────────────────────────────────────────────
-- BACKFILL 2 — garantizar UN solo predeterminado por empresa.
--
-- Defensivo: hoy no hay ninguna empresa con dos predeterminados (verificado),
-- pero el servicio permitia crearlos, asi que la migracion no puede asumir
-- datos limpios. Se conserva el mas antiguo y se desmarcan los demas.
--
-- Si una empresa tiene pipelines pero NINGUNO predeterminado, se marca el
-- primero: el indice de abajo exige unicidad, no existencia, y dejar a una
-- empresa sin predeterminado romperia la resolucion automatica igual que
-- no tener pipeline.
-- ─────────────────────────────────────────────────────────────────────────
UPDATE "pipelines" p
SET "isDefault" = false
WHERE p."isDefault"
  AND p."id" <> (
    SELECT p2."id" FROM "pipelines" p2
    WHERE p2."companyId" = p."companyId" AND p2."isDefault"
    ORDER BY p2."createdAt" ASC, p2."id" ASC
    LIMIT 1
  );

UPDATE "pipelines" p
SET "isDefault" = true
WHERE p."id" IN (
  SELECT DISTINCT ON (p2."companyId") p2."id"
  FROM "pipelines" p2
  WHERE NOT EXISTS (
    SELECT 1 FROM "pipelines" p3
    WHERE p3."companyId" = p2."companyId" AND p3."isDefault"
  )
  ORDER BY p2."companyId", p2."createdAt" ASC, p2."id" ASC
);

-- ─────────────────────────────────────────────────────────────────────────
-- INDICE PARCIAL — un unico predeterminado por empresa, garantizado en base.
--
-- NOTA DE MANTENIMIENTO: Prisma no soporta indices parciales en el schema,
-- asi que este indice vive SOLO aqui. Consecuencia conocida y aceptada:
-- `prisma migrate dev` puede proponer eliminarlo al detectar deriva. NUNCA
-- aceptar ese DROP; el prompt maestro obliga a revisar a mano el SQL
-- generado, y ese es el punto donde se detecta.
--
-- Se mantiene ademas la garantia en el servicio (desmarcar dentro de la
-- misma transaccion), porque el indice protege de la concurrencia pero un
-- error de constraint es una mala experiencia de usuario.
-- ─────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "pipelines_one_default_per_company"
  ON "pipelines" ("companyId")
  WHERE "isDefault";
