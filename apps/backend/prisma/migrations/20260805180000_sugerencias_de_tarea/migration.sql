-- Tareas propuestas por un bot: se aprueban antes de existir.
--
-- ADITIVA. Un enum nuevo, una tabla nueva y una columna nueva con valor por
-- defecto. No toca ninguna fila existente, no borra nada y no reescribe tablas
-- grandes.
--
-- ROLLBACK:
--   DROP TABLE "task_suggestions";
--   DROP TYPE "TaskSuggestionStatus";
--   ALTER TABLE "company_lead_settings" DROP COLUMN "requireTaskApproval";
-- Solo pierde las propuestas que estuvieran pendientes; las tareas ya
-- aprobadas son filas de `tasks` y sobreviven.

CREATE TYPE "TaskSuggestionStatus" AS ENUM (
  'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'
);

-- Por defecto SE EXIGE aprobacion. El valor seguro es el de fabrica: apagarlo
-- tiene que ser una decision explicita de la empresa.
ALTER TABLE "company_lead_settings"
  ADD COLUMN "requireTaskApproval" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "task_suggestions" (
  "id"              TEXT NOT NULL,
  "status"          "TaskSuggestionStatus" NOT NULL DEFAULT 'PENDING',
  "source"          TEXT NOT NULL,
  "reason"          TEXT,
  "excerpt"         TEXT,
  "title"           TEXT NOT NULL,
  "description"     TEXT,
  "priority"        "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
  "dueAt"           TIMESTAMP(3),
  "suggestedAssignee" TEXT,
  "idempotencyKey"  TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "contactId"       TEXT,
  "conversationId"  TEXT,
  "leadId"          TEXT,
  "flowBotId"       TEXT,
  "decidedById"     TEXT,
  "decidedAt"       TIMESTAMP(3),
  "decisionNote"    TEXT,
  "createdTaskId"   TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "task_suggestions_pkey" PRIMARY KEY ("id")
);

-- La MISMA regla sobre el MISMO mensaje no propone dos veces: un reintento del
-- worker duplicaria la propuesta y el asesor veria lo mismo dos veces sin
-- saber cual atender.
CREATE UNIQUE INDEX "task_suggestions_idempotencyKey_key"
  ON "task_suggestions"("idempotencyKey");

-- Dos aprobaciones simultaneas NO pueden acabar en dos tareas. El codigo ya lo
-- evita con una transaccion; esto lo garantiza aunque el codigo falle.
CREATE UNIQUE INDEX "task_suggestions_createdTaskId_key"
  ON "task_suggestions"("createdTaskId");

CREATE INDEX "task_suggestions_companyId_status_createdAt_idx"
  ON "task_suggestions"("companyId", "status", "createdAt");
CREATE INDEX "task_suggestions_conversationId_idx"
  ON "task_suggestions"("conversationId");
CREATE INDEX "task_suggestions_contactId_idx"
  ON "task_suggestions"("contactId");

ALTER TABLE "task_suggestions"
  ADD CONSTRAINT "task_suggestions_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "task_suggestions_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "contacts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "task_suggestions_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "task_suggestions_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "leads"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "task_suggestions_flowBotId_fkey"
    FOREIGN KEY ("flowBotId") REFERENCES "flowbots"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "task_suggestions_suggestedAssignee_fkey"
    FOREIGN KEY ("suggestedAssignee") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "task_suggestions_decidedById_fkey"
    FOREIGN KEY ("decidedById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "task_suggestions_createdTaskId_fkey"
    FOREIGN KEY ("createdTaskId") REFERENCES "tasks"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
