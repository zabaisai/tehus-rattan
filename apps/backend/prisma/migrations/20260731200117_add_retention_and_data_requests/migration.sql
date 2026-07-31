-- CreateEnum
CREATE TYPE "DataRequestType" AS ENUM ('EXPORT', 'DELETION');

-- CreateEnum
CREATE TYPE "DataRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'COMPLETED', 'REJECTED');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "retentionMonths" INTEGER,
ADD COLUMN     "retentionPurgeEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "data_requests" (
    "id" TEXT NOT NULL,
    "type" "DataRequestType" NOT NULL,
    "status" "DataRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "requestedBy" TEXT,
    "approvedBy" TEXT,
    "result" JSONB,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "companyId" TEXT NOT NULL,

    CONSTRAINT "data_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_requests_companyId_status_idx" ON "data_requests"("companyId", "status");

-- CreateIndex
CREATE INDEX "data_requests_status_requestedAt_idx" ON "data_requests"("status", "requestedAt");

-- AddForeignKey
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
