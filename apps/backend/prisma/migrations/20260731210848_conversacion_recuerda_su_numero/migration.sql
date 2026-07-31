-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "whatsappIntegrationId" TEXT;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_whatsappIntegrationId_fkey" FOREIGN KEY ("whatsappIntegrationId") REFERENCES "whatsapp_integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
