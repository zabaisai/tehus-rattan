-- Importacion de catalogo con estado DURABLE.
--
-- ADITIVA. Un enum nuevo y una tabla nueva. No toca ninguna tabla existente,
-- no cambia tipos y no reescribe filas.
--
-- POR QUE DURABLE Y NO EN MEMORIA
-- Un catalogo grande tarda minutos, el worker se puede reiniciar a mitad y
-- quien lanzo la importacion cierra la pestaña. Si el progreso viviera en el
-- proceso, un reinicio dejaria la pantalla esperando para siempre una
-- respuesta que nadie va a dar.
--
-- ROLLBACK:
--   DROP TABLE "product_imports";
--   DROP TYPE "ProductImportStatus";
-- Se perderia el historial de importaciones; los PRODUCTOS creados por ellas
-- son filas de `products` y sobreviven.

CREATE TYPE "ProductImportStatus" AS ENUM (
  'PENDING', 'RUNNING', 'CANCELLING', 'CANCELLED', 'COMPLETED', 'FAILED'
);

CREATE TABLE "product_imports" (
  "id"               TEXT NOT NULL,
  "status"           "ProductImportStatus" NOT NULL DEFAULT 'PENDING',
  "fileName"         TEXT NOT NULL,
  "fileSize"         INTEGER NOT NULL,
  "tempPath"         TEXT,
  "totalRows"        INTEGER NOT NULL DEFAULT 0,
  "processedRows"    INTEGER NOT NULL DEFAULT 0,
  "created"          INTEGER NOT NULL DEFAULT 0,
  "updated"          INTEGER NOT NULL DEFAULT 0,
  "skipped"          INTEGER NOT NULL DEFAULT 0,
  "failed"           INTEGER NOT NULL DEFAULT 0,
  "lastCommittedRow" INTEGER NOT NULL DEFAULT 0,
  "columnMapping"    JSONB,
  "issues"           JSONB,
  "errorMessage"     TEXT,
  "idempotencyKey"   TEXT,
  "startedAt"        TIMESTAMP(3),
  "finishedAt"       TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  "companyId"        TEXT NOT NULL,
  "createdById"      TEXT,
  CONSTRAINT "product_imports_pkey" PRIMARY KEY ("id")
);

-- Reintentar la MISMA subida no arranca dos importaciones.
CREATE UNIQUE INDEX "product_imports_idempotencyKey_key"
  ON "product_imports"("idempotencyKey");

CREATE INDEX "product_imports_companyId_status_createdAt_idx"
  ON "product_imports"("companyId", "status", "createdAt");

ALTER TABLE "product_imports"
  ADD CONSTRAINT "product_imports_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "product_imports_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
