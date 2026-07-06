-- CreateEnum
CREATE TYPE "WhatsAppIntegrationStatus" AS ENUM ('PENDING', 'CONNECTED', 'DISCONNECTED', 'REVOKED');

-- CreateTable
CREATE TABLE "whatsapp_integrations" (
    "id" TEXT NOT NULL,
    "displayPhoneNumber" TEXT,
    "phoneNumberId" TEXT NOT NULL,
    "wabaId" TEXT,
    "status" "WhatsAppIntegrationStatus" NOT NULL DEFAULT 'PENDING',
    "accessTokenEncrypted" TEXT,
    "connectedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "whatsapp_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_integrations_phoneNumberId_key" ON "whatsapp_integrations"("phoneNumberId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_integrations_companyId_key" ON "whatsapp_integrations"("companyId");

-- AddForeignKey
ALTER TABLE "whatsapp_integrations" ADD CONSTRAINT "whatsapp_integrations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
