-- CreateEnum
CREATE TYPE "WhatsAppConnectionMethod" AS ENUM ('MANUAL', 'EMBEDDED_SIGNUP', 'COEXISTENCE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WhatsAppIntegrationStatus" ADD VALUE 'CONNECTING';
ALTER TYPE "WhatsAppIntegrationStatus" ADD VALUE 'REAUTH_REQUIRED';
ALTER TYPE "WhatsAppIntegrationStatus" ADD VALUE 'ERROR';

-- AlterTable
ALTER TABLE "whatsapp_integrations" ADD COLUMN     "businessId" TEXT,
ADD COLUMN     "businessName" TEXT,
ADD COLUMN     "connectionMethod" "WhatsAppConnectionMethod" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "lastCheckedAt" TIMESTAMP(3),
ADD COLUMN     "lastErrorCode" TEXT;

-- CreateTable
CREATE TABLE "whatsapp_embedded_signup_states" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "requestedIpPreview" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_embedded_signup_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_embedded_signup_states_stateHash_key" ON "whatsapp_embedded_signup_states"("stateHash");

-- CreateIndex
CREATE INDEX "whatsapp_embedded_signup_states_companyId_idx" ON "whatsapp_embedded_signup_states"("companyId");

-- CreateIndex
CREATE INDEX "whatsapp_embedded_signup_states_expiresAt_idx" ON "whatsapp_embedded_signup_states"("expiresAt");

-- AddForeignKey
ALTER TABLE "whatsapp_embedded_signup_states" ADD CONSTRAINT "whatsapp_embedded_signup_states_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
