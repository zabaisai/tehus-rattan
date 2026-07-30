-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "leadId" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "conversationId" TEXT;

-- CreateIndex
CREATE INDEX "conversations_companyId_status_lastMessageAt_idx" ON "conversations"("companyId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "conversations_companyId_assignedTo_idx" ON "conversations"("companyId", "assignedTo");

-- CreateIndex
CREATE INDEX "conversations_leadId_idx" ON "conversations"("leadId");

-- CreateIndex
CREATE INDEX "leads_companyId_status_idx" ON "leads"("companyId", "status");

-- CreateIndex
CREATE INDEX "leads_pipelineId_stageId_idx" ON "leads"("pipelineId", "stageId");

-- CreateIndex
CREATE INDEX "leads_contactId_idx" ON "leads"("contactId");

-- CreateIndex
CREATE INDEX "tasks_companyId_status_dueDate_idx" ON "tasks"("companyId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "tasks_companyId_assignedTo_idx" ON "tasks"("companyId", "assignedTo");

-- CreateIndex
CREATE INDEX "tasks_conversationId_idx" ON "tasks"("conversationId");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
