-- CreateEnum
CREATE TYPE "ChatbotFlowStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ChatbotSessionStatus" AS ENUM ('ACTIVE', 'HANDED_OVER', 'COMPLETED', 'ABANDONED');

-- CreateTable
CREATE TABLE "chatbot_flows" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ChatbotFlowStatus" NOT NULL DEFAULT 'DRAFT',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "draftNodes" JSONB NOT NULL,
    "publishedVersion" INTEGER,
    "triggerKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "chatbot_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chatbot_flow_versions" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "nodes" JSONB NOT NULL,
    "publishedBy" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "flowId" TEXT NOT NULL,

    CONSTRAINT "chatbot_flow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chatbot_sessions" (
    "id" TEXT NOT NULL,
    "status" "ChatbotSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentNode" TEXT NOT NULL,
    "context" JSONB,
    "steps" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInteractionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "companyId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "flowVersionId" TEXT NOT NULL,

    CONSTRAINT "chatbot_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chatbot_flows_companyId_isActive_idx" ON "chatbot_flows"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "chatbot_flow_versions_flowId_version_key" ON "chatbot_flow_versions"("flowId", "version");

-- CreateIndex
CREATE INDEX "chatbot_sessions_conversationId_status_idx" ON "chatbot_sessions"("conversationId", "status");

-- CreateIndex
CREATE INDEX "chatbot_sessions_companyId_status_lastInteractionAt_idx" ON "chatbot_sessions"("companyId", "status", "lastInteractionAt");

-- AddForeignKey
ALTER TABLE "chatbot_flows" ADD CONSTRAINT "chatbot_flows_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chatbot_flow_versions" ADD CONSTRAINT "chatbot_flow_versions_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "chatbot_flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chatbot_sessions" ADD CONSTRAINT "chatbot_sessions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chatbot_sessions" ADD CONSTRAINT "chatbot_sessions_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chatbot_sessions" ADD CONSTRAINT "chatbot_sessions_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "chatbot_flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chatbot_sessions" ADD CONSTRAINT "chatbot_sessions_flowVersionId_fkey" FOREIGN KEY ("flowVersionId") REFERENCES "chatbot_flow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
