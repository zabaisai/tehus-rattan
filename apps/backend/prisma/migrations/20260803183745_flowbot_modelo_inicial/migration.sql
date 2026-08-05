-- CreateEnum
CREATE TYPE "FlowBotStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FlowBotTriggerType" AS ENUM ('INBOUND_MESSAGE', 'FIRST_CONVERSATION', 'KEYWORD', 'INTENT', 'CONVERSATION_CREATED', 'CONTACT_CREATED', 'LEAD_CREATED', 'STAGE_CHANGED', 'TAG_ADDED', 'TASK_OVERDUE', 'NO_REPLY', 'SCHEDULE', 'MANUAL', 'WEBHOOK', 'AUTOMATION_EVENT');

-- CreateEnum
CREATE TYPE "FlowBotExecutionStatus" AS ENUM ('RUNNING', 'WAITING_INPUT', 'WAITING_TIME', 'HANDED_OFF', 'COMPLETED', 'FAILED', 'CANCELLED', 'PAUSED');

-- CreateEnum
CREATE TYPE "FlowBotStepStatus" AS ENUM ('OK', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "FlowBotWaitKind" AS ENUM ('INPUT', 'TIME', 'EVENT');

-- CreateTable
CREATE TABLE "flowbots" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "FlowBotStatus" NOT NULL DEFAULT 'DRAFT',
    "draftGraph" JSONB NOT NULL,
    "publishedVersionId" TEXT,
    "lastVersionNumber" INTEGER NOT NULL DEFAULT 0,
    "draftRevision" INTEGER NOT NULL DEFAULT 0,
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "templateKey" TEXT,
    "clonedFromId" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "flowbots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flowbot_versions" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "graph" JSONB NOT NULL,
    "compiled" JSONB NOT NULL,
    "compiledHash" TEXT NOT NULL,
    "publishNote" TEXT,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "flowBotId" TEXT NOT NULL,

    CONSTRAINT "flowbot_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flowbot_triggers" (
    "id" TEXT NOT NULL,
    "type" "FlowBotTriggerType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "exclusive" BOOLEAN NOT NULL DEFAULT true,
    "filters" JSONB,
    "whatsappIntegrationId" TEXT,
    "scheduleSpec" TEXT,
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "flowBotId" TEXT NOT NULL,

    CONSTRAINT "flowbot_triggers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flowbot_executions" (
    "id" TEXT NOT NULL,
    "status" "FlowBotExecutionStatus" NOT NULL DEFAULT 'RUNNING',
    "currentNodeId" TEXT,
    "variables" JSONB NOT NULL DEFAULT '{}',
    "steps" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "endedReason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastStepAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "companyId" TEXT NOT NULL,
    "flowBotId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "conversationId" TEXT,
    "contactId" TEXT,
    "leadId" TEXT,
    "whatsappIntegrationId" TEXT,
    "triggerMessageId" TEXT,

    CONSTRAINT "flowbot_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flowbot_execution_steps" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "status" "FlowBotStepStatus" NOT NULL DEFAULT 'OK',
    "outPort" TEXT,
    "input" JSONB,
    "output" JSONB,
    "errorCode" TEXT,
    "durationMs" INTEGER,
    "idempotencyKey" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executionId" TEXT NOT NULL,

    CONSTRAINT "flowbot_execution_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flowbot_waits" (
    "id" TEXT NOT NULL,
    "kind" "FlowBotWaitKind" NOT NULL,
    "wakeAt" TIMESTAMP(3),
    "resumeNodeId" TEXT NOT NULL,
    "timeoutPort" TEXT,
    "eventKey" TEXT,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,

    CONSTRAINT "flowbot_waits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flowbot_metrics" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "executionsStarted" INTEGER NOT NULL DEFAULT 0,
    "executionsCompleted" INTEGER NOT NULL DEFAULT 0,
    "executionsFailed" INTEGER NOT NULL DEFAULT 0,
    "executionsCancelled" INTEGER NOT NULL DEFAULT 0,
    "handedOff" INTEGER NOT NULL DEFAULT 0,
    "messagesSent" INTEGER NOT NULL DEFAULT 0,
    "templatesSent" INTEGER NOT NULL DEFAULT 0,
    "contactsCaptured" INTEGER NOT NULL DEFAULT 0,
    "leadsCreated" INTEGER NOT NULL DEFAULT 0,
    "tasksCreated" INTEGER NOT NULL DEFAULT 0,
    "aiCalls" INTEGER NOT NULL DEFAULT 0,
    "aiCostMillis" INTEGER NOT NULL DEFAULT 0,
    "totalDurationMs" BIGINT NOT NULL DEFAULT 0,
    "companyId" TEXT NOT NULL,
    "flowBotId" TEXT NOT NULL,
    "versionId" TEXT,

    CONSTRAINT "flowbot_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flowbot_test_runs" (
    "id" TEXT NOT NULL,
    "scenario" JSONB NOT NULL,
    "trace" JSONB NOT NULL,
    "effects" JSONB,
    "passed" BOOLEAN NOT NULL DEFAULT true,
    "summary" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "flowBotId" TEXT NOT NULL,
    "versionId" TEXT,

    CONSTRAINT "flowbot_test_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "flowbots_publishedVersionId_key" ON "flowbots"("publishedVersionId");

-- CreateIndex
CREATE INDEX "flowbots_companyId_status_idx" ON "flowbots"("companyId", "status");

-- CreateIndex
CREATE INDEX "flowbots_companyId_isTemplate_idx" ON "flowbots"("companyId", "isTemplate");

-- CreateIndex
CREATE INDEX "flowbot_versions_flowBotId_publishedAt_idx" ON "flowbot_versions"("flowBotId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "flowbot_versions_flowBotId_version_key" ON "flowbot_versions"("flowBotId", "version");

-- CreateIndex
CREATE INDEX "flowbot_triggers_flowBotId_idx" ON "flowbot_triggers"("flowBotId");

-- CreateIndex
CREATE INDEX "flowbot_triggers_type_enabled_idx" ON "flowbot_triggers"("type", "enabled");

-- CreateIndex
CREATE INDEX "flowbot_triggers_whatsappIntegrationId_enabled_idx" ON "flowbot_triggers"("whatsappIntegrationId", "enabled");

-- CreateIndex
CREATE INDEX "flowbot_triggers_nextRunAt_idx" ON "flowbot_triggers"("nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "flowbot_executions_idempotencyKey_key" ON "flowbot_executions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "flowbot_executions_companyId_status_idx" ON "flowbot_executions"("companyId", "status");

-- CreateIndex
CREATE INDEX "flowbot_executions_conversationId_status_idx" ON "flowbot_executions"("conversationId", "status");

-- CreateIndex
CREATE INDEX "flowbot_executions_flowBotId_startedAt_idx" ON "flowbot_executions"("flowBotId", "startedAt");

-- CreateIndex
CREATE INDEX "flowbot_executions_versionId_idx" ON "flowbot_executions"("versionId");

-- CreateIndex
CREATE INDEX "flowbot_executions_companyId_startedAt_idx" ON "flowbot_executions"("companyId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "flowbot_execution_steps_idempotencyKey_key" ON "flowbot_execution_steps"("idempotencyKey");

-- CreateIndex
CREATE INDEX "flowbot_execution_steps_executionId_createdAt_idx" ON "flowbot_execution_steps"("executionId", "createdAt");

-- CreateIndex
CREATE INDEX "flowbot_execution_steps_nodeType_status_idx" ON "flowbot_execution_steps"("nodeType", "status");

-- CreateIndex
CREATE INDEX "flowbot_waits_wakeAt_consumedAt_idx" ON "flowbot_waits"("wakeAt", "consumedAt");

-- CreateIndex
CREATE INDEX "flowbot_waits_executionId_consumedAt_idx" ON "flowbot_waits"("executionId", "consumedAt");

-- CreateIndex
CREATE INDEX "flowbot_waits_companyId_kind_consumedAt_idx" ON "flowbot_waits"("companyId", "kind", "consumedAt");

-- CreateIndex
CREATE INDEX "flowbot_metrics_companyId_day_idx" ON "flowbot_metrics"("companyId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "flowbot_metrics_flowBotId_versionId_day_key" ON "flowbot_metrics"("flowBotId", "versionId", "day");

-- CreateIndex
CREATE INDEX "flowbot_test_runs_companyId_createdAt_idx" ON "flowbot_test_runs"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "flowbot_test_runs_flowBotId_createdAt_idx" ON "flowbot_test_runs"("flowBotId", "createdAt");

-- AddForeignKey
ALTER TABLE "flowbots" ADD CONSTRAINT "flowbots_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "flowbot_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flowbots" ADD CONSTRAINT "flowbots_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flowbots" ADD CONSTRAINT "flowbots_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flowbots" ADD CONSTRAINT "flowbots_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flowbot_versions" ADD CONSTRAINT "flowbot_versions_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flowbot_versions" ADD CONSTRAINT "flowbot_versions_flowBotId_fkey" FOREIGN KEY ("flowBotId") REFERENCES "flowbots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flowbot_triggers" ADD CONSTRAINT "flowbot_triggers_whatsappIntegrationId_fkey" FOREIGN KEY ("whatsappIntegrationId") REFERENCES "whatsapp_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flowbot_triggers" ADD CONSTRAINT "flowbot_triggers_flowBotId_fkey" FOREIGN KEY ("flowBotId") REFERENCES "flowbots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flowbot_executions" ADD CONSTRAINT "flowbot_executions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flowbot_executions" ADD CONSTRAINT "flowbot_executions_flowBotId_fkey" FOREIGN KEY ("flowBotId") REFERENCES "flowbots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flowbot_executions" ADD CONSTRAINT "flowbot_executions_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "flowbot_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flowbot_executions" ADD CONSTRAINT "flowbot_executions_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flowbot_executions" ADD CONSTRAINT "flowbot_executions_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flowbot_executions" ADD CONSTRAINT "flowbot_executions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flowbot_executions" ADD CONSTRAINT "flowbot_executions_whatsappIntegrationId_fkey" FOREIGN KEY ("whatsappIntegrationId") REFERENCES "whatsapp_integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flowbot_execution_steps" ADD CONSTRAINT "flowbot_execution_steps_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "flowbot_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flowbot_waits" ADD CONSTRAINT "flowbot_waits_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flowbot_waits" ADD CONSTRAINT "flowbot_waits_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "flowbot_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flowbot_metrics" ADD CONSTRAINT "flowbot_metrics_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flowbot_metrics" ADD CONSTRAINT "flowbot_metrics_flowBotId_fkey" FOREIGN KEY ("flowBotId") REFERENCES "flowbots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flowbot_metrics" ADD CONSTRAINT "flowbot_metrics_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "flowbot_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flowbot_test_runs" ADD CONSTRAINT "flowbot_test_runs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flowbot_test_runs" ADD CONSTRAINT "flowbot_test_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flowbot_test_runs" ADD CONSTRAINT "flowbot_test_runs_flowBotId_fkey" FOREIGN KEY ("flowBotId") REFERENCES "flowbots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flowbot_test_runs" ADD CONSTRAINT "flowbot_test_runs_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "flowbot_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
