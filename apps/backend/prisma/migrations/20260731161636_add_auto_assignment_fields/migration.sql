-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "autoAssignEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "autoAssignEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastAssignedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "users_companyId_isActive_autoAssignEnabled_lastAssignedAt_idx" ON "users"("companyId", "isActive", "autoAssignEnabled", "lastAssignedAt");
