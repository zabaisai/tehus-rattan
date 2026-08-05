-- CreateEnum
CREATE TYPE "WhatsAppTemplateStatus" AS ENUM ('UNKNOWN', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED');

-- CreateTable
CREATE TABLE "flowbot_kill_switch" (
    "id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "activatedAt" TIMESTAMP(3),
    "activatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flowbot_kill_switch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "status" "WhatsAppTemplateStatus" NOT NULL DEFAULT 'UNKNOWN',
    "bodyParams" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "companyId" TEXT NOT NULL,
    "whatsappIntegrationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_templates_companyId_name_idx" ON "whatsapp_templates"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_templates_companyId_whatsappIntegrationId_name_lan_key" ON "whatsapp_templates"("companyId", "whatsappIntegrationId", "name", "language");

-- AddForeignKey
ALTER TABLE "flowbot_kill_switch" ADD CONSTRAINT "flowbot_kill_switch_activatedById_fkey" FOREIGN KEY ("activatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_whatsappIntegrationId_fkey" FOREIGN KEY ("whatsappIntegrationId") REFERENCES "whatsapp_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
