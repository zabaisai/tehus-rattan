-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'LONG_TEXT', 'NUMBER', 'CURRENCY', 'DATE', 'DATETIME', 'BOOLEAN', 'SELECT', 'MULTI_SELECT', 'PHONE', 'EMAIL', 'URL');

-- CreateEnum
CREATE TYPE "CustomFieldEntity" AS ENUM ('CONTACT', 'LEAD');

-- CreateEnum
CREATE TYPE "CustomFieldSource" AS ENUM ('USER', 'FLOWBOT', 'AUTOMATION', 'IMPORT', 'API');

-- CreateTable
CREATE TABLE "custom_field_definitions" (
    "id" TEXT NOT NULL,
    "entity" "CustomFieldEntity" NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL,
    "helpText" TEXT,
    "options" JSONB,
    "validation" JSONB,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_values" (
    "id" TEXT NOT NULL,
    "valueText" TEXT,
    "valueNumber" DECIMAL(18,6),
    "valueBool" BOOLEAN,
    "valueDate" TIMESTAMP(3),
    "valueList" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "contactId" TEXT,
    "leadId" TEXT,

    CONSTRAINT "custom_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_value_changes" (
    "id" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "source" "CustomFieldSource" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "entity" "CustomFieldEntity" NOT NULL,
    "entityId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "executionId" TEXT,

    CONSTRAINT "custom_field_value_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "custom_field_definitions_companyId_entity_isActive_order_idx" ON "custom_field_definitions"("companyId", "entity", "isActive", "order");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_definitions_companyId_entity_key_key" ON "custom_field_definitions"("companyId", "entity", "key");

-- CreateIndex
CREATE INDEX "custom_field_values_companyId_definitionId_idx" ON "custom_field_values"("companyId", "definitionId");

-- CreateIndex
CREATE INDEX "custom_field_values_contactId_idx" ON "custom_field_values"("contactId");

-- CreateIndex
CREATE INDEX "custom_field_values_leadId_idx" ON "custom_field_values"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_values_definitionId_contactId_key" ON "custom_field_values"("definitionId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_values_definitionId_leadId_key" ON "custom_field_values"("definitionId", "leadId");

-- CreateIndex
CREATE INDEX "custom_field_value_changes_companyId_createdAt_idx" ON "custom_field_value_changes"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "custom_field_value_changes_companyId_entity_entityId_idx" ON "custom_field_value_changes"("companyId", "entity", "entityId");

-- CreateIndex
CREATE INDEX "custom_field_value_changes_definitionId_createdAt_idx" ON "custom_field_value_changes"("definitionId", "createdAt");

-- AddForeignKey
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "custom_field_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_value_changes" ADD CONSTRAINT "custom_field_value_changes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_value_changes" ADD CONSTRAINT "custom_field_value_changes_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "custom_field_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_value_changes" ADD CONSTRAINT "custom_field_value_changes_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────
-- Restricciones que Prisma no sabe expresar y que la base sí puede garantizar.
-- ─────────────────────────────────────────────

-- Un valor cuelga de UN contacto o de UNA oportunidad, nunca de ambos ni de
-- ninguno. Sin esto, una fila huerfana con los dos nulos pasaria los indices
-- unicos —en PostgreSQL los NULL no chocan— y quedaria invisible para siempre.
ALTER TABLE "custom_field_values"
  ADD CONSTRAINT "custom_field_values_una_sola_entidad"
  CHECK (("contactId" IS NOT NULL) <> ("leadId" IS NOT NULL));

-- La clave es un identificador, no una etiqueta. Si se aceptara texto libre,
-- "Estado Credito" y "estado credito" convivirian como campos distintos y
-- ningun flujo sabria a cual apunta.
ALTER TABLE "custom_field_definitions"
  ADD CONSTRAINT "custom_field_definitions_clave_valida"
  CHECK ("key" ~ '^[a-z][a-z0-9_]{0,62}$');
