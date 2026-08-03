-- AlterTable
ALTER TABLE "flowbot_executions" ADD COLUMN     "leaseOwner" TEXT,
ADD COLUMN     "leaseUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "flowbot_executions_status_leaseUntil_idx" ON "flowbot_executions"("status", "leaseUntil");
