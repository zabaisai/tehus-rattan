-- Per-company fiscal identity for quotes / printable documents.
-- All columns are nullable additions with no default — existing rows are
-- unaffected, and no company ever inherits another company's (or a global
-- hardcoded) fiscal data. Empty fields are simply omitted at render time.

-- AlterTable
ALTER TABLE "companies"
  ADD COLUMN "legalName" TEXT,
  ADD COLUMN "taxId" TEXT,
  ADD COLUMN "address" TEXT,
  ADD COLUMN "quoteFooter" TEXT;
