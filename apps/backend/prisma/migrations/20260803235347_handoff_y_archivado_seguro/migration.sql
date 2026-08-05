-- CreateEnum
CREATE TYPE "HandoffStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'CANCELLED');

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedReason" TEXT;

-- CreateTable
CREATE TABLE "conversation_handoffs" (
    "id" TEXT NOT NULL,
    "status" "HandoffStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT,
    "note" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "companyId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "assignedToUserId" TEXT,
    "resolvedByUserId" TEXT,
    "executionId" TEXT,
    "nodeId" TEXT,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_handoffs_companyId_status_startedAt_idx" ON "conversation_handoffs"("companyId", "status", "startedAt");

-- CreateIndex
CREATE INDEX "conversation_handoffs_conversationId_status_idx" ON "conversation_handoffs"("conversationId", "status");

-- CreateIndex
CREATE INDEX "conversation_handoffs_assignedToUserId_status_idx" ON "conversation_handoffs"("assignedToUserId", "status");

-- AddForeignKey
ALTER TABLE "conversation_handoffs" ADD CONSTRAINT "conversation_handoffs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_handoffs" ADD CONSTRAINT "conversation_handoffs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_handoffs" ADD CONSTRAINT "conversation_handoffs_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_handoffs" ADD CONSTRAINT "conversation_handoffs_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────
-- UNA sola entrega activa por conversación.
--
-- Es un índice PARCIAL: solo aplica a las ACTIVE, así que una conversación
-- puede acumular todas las entregas resueltas que haga falta pero nunca dos
-- vivas a la vez. Prisma no sabe expresarlo, y sin él dos nodos de handoff
-- simultáneos —un reintento y una continuación— dejarían dos filas activas y
-- resolver una no devolvería el bot.
-- ─────────────────────────────────────────────
CREATE UNIQUE INDEX "conversation_handoffs_una_activa"
  ON "conversation_handoffs" ("conversationId")
  WHERE "status" = 'ACTIVE';
