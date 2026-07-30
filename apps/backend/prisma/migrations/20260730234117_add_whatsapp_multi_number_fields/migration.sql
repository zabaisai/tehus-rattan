-- AlterTable
ALTER TABLE "whatsapp_integrations" ADD COLUMN     "isPrimary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "label" TEXT,
ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "whatsapp_integrations_companyId_isPrimary_idx" ON "whatsapp_integrations"("companyId", "isPrimary");

-- ─────────────────────────────────────────────────────────────────────────
-- BACKFILL — la integracion viva pasa a ser la PRINCIPAL de su empresa.
--
-- Requisito explicito del encargo: "La integracion actualmente conectada debe
-- preservarse y migrarse como integracion principal". Sin esto, tras retirar
-- el UNIQUE el envio no tendria criterio para elegir numero.
--
-- Idempotente: solo marca empresas que aun no tienen ninguna principal.
-- ─────────────────────────────────────────────────────────────────────────
UPDATE "whatsapp_integrations" w
SET "isPrimary" = true
WHERE NOT EXISTS (
  SELECT 1 FROM "whatsapp_integrations" w2
  WHERE w2."companyId" = w."companyId" AND w2."isPrimary"
);

-- Etiqueta por defecto para que la interfaz no muestre un phoneNumberId
-- desnudo. El numero de prueba de Meta se identifica como tal, porque el
-- encargo prohibe presentarlo como numero real de la empresa.
UPDATE "whatsapp_integrations"
SET "label" = COALESCE("label", 'Numero principal')
WHERE "label" IS NULL;
