-- Informational company profile, branding, and commercial settings.
-- All columns are nullable additions with no default — existing rows are
-- unaffected, and the unique constraint on "slug" is safe because Postgres
-- treats multiple NULLs as distinct values for a unique index.

-- AlterTable
ALTER TABLE "companies"
  ADD COLUMN "slug" TEXT,
  ADD COLUMN "logoUrl" TEXT,
  ADD COLUMN "secondaryLogoUrl" TEXT,
  ADD COLUMN "primaryColor" TEXT,
  ADD COLUMN "accentColor" TEXT,
  ADD COLUMN "backgroundColor" TEXT,
  ADD COLUMN "businessType" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "country" TEXT,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "website" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "settings" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");
