-- AlterEnum
ALTER TYPE "FlowBotExecutionStatus" ADD VALUE 'NEEDS_ATTENTION';

-- AlterTable
ALTER TABLE "flowbot_executions" ADD COLUMN     "attentionReason" TEXT,
ADD COLUMN     "lastRecoveryAt" TIMESTAMP(3),
ADD COLUMN     "recoveries" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "flowbot_executions_status_lastStepAt_idx" ON "flowbot_executions"("status", "lastStepAt");
