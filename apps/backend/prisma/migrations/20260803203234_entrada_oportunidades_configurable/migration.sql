-- CreateEnum
CREATE TYPE "EstrategiaAsignacion" AS ENUM ('NINGUNA', 'ROUND_ROBIN', 'FIJA');

-- AlterTable
ALTER TABLE "pipeline_stages" ADD COLUMN     "isInitial" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "company_lead_settings" (
    "id" TEXT NOT NULL,
    "autoCreateLead" BOOLEAN NOT NULL DEFAULT true,
    "defaultPipelineId" TEXT,
    "initialStageId" TEXT,
    "reuseOpenLead" BOOLEAN NOT NULL DEFAULT true,
    "createInitialTask" BOOLEAN NOT NULL DEFAULT false,
    "initialTaskTitle" TEXT,
    "initialTaskDueHours" INTEGER NOT NULL DEFAULT 24,
    "assignmentStrategy" "EstrategiaAsignacion" NOT NULL DEFAULT 'ROUND_ROBIN',
    "assignedUserId" TEXT,
    "reactivateArchived" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "company_lead_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_lead_settings_companyId_key" ON "company_lead_settings"("companyId");

-- AddForeignKey
ALTER TABLE "company_lead_settings" ADD CONSTRAINT "company_lead_settings_defaultPipelineId_fkey" FOREIGN KEY ("defaultPipelineId") REFERENCES "pipelines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_lead_settings" ADD CONSTRAINT "company_lead_settings_initialStageId_fkey" FOREIGN KEY ("initialStageId") REFERENCES "pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_lead_settings" ADD CONSTRAINT "company_lead_settings_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_lead_settings" ADD CONSTRAINT "company_lead_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: marca como inicial la etapa de MENOR orden de cada pipeline.
--
-- Antes de este cambio, la entrada automatica usaba "la primera por orden".
-- Sin este relleno, ninguna etapa quedaria marcada y las empresas existentes
-- dejarian de recibir oportunidades nuevas: una migracion aditiva habria
-- roto el comportamiento en silencio, que es peor que un error visible.
--
-- Solo escribe sobre la columna creada arriba. No toca ninguna otra.
-- Reversion: UPDATE "pipeline_stages" SET "isInitial" = false;
UPDATE "pipeline_stages" AS s
SET "isInitial" = true
WHERE s.id IN (
  SELECT DISTINCT ON ("pipelineId") id
  FROM "pipeline_stages"
  ORDER BY "pipelineId", "order" ASC, "createdAt" ASC
);
