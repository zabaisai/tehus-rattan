-- Cotizaciones completas: impuestos, transporte, descuento por linea,
-- ajustes, revisiones y ciclo de vida.
--
-- ADITIVA. Todo son columnas nuevas con valor por defecto o anulables. No
-- borra nada, no cambia tipos y no reescribe filas existentes: una cotizacion
-- que ya existe queda con impuesto 0, transporte 0 y ajuste 0, que es
-- exactamente lo que era antes de que estos conceptos existieran.
--
-- ROLLBACK: quitar las columnas añadidas (listadas al final de este archivo).
-- Se perderian los impuestos y el transporte capturados desde la migracion,
-- pero `subtotal`, `discount` y `total` —que ya existian— quedan intactos.

-- ── empresa: como redondea y como cobra impuestos ──────────────
ALTER TABLE "companies"
  ADD COLUMN "quoteRoundingDecimals" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "defaultTaxRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
  ADD COLUMN "taxIncluded" BOOLEAN NOT NULL DEFAULT false;

-- ── a donde va la oportunidad al cotizar ───────────────────────
-- Por ID y nunca por nombre: buscar un embudo llamado «Cotizaciones» rompe el
-- dia que alguien lo renombra.
ALTER TABLE "company_lead_settings"
  ADD COLUMN "quotePipelineId" TEXT,
  ADD COLUMN "quoteStageId" TEXT;

ALTER TABLE "company_lead_settings"
  ADD CONSTRAINT "company_lead_settings_quotePipelineId_fkey"
    FOREIGN KEY ("quotePipelineId") REFERENCES "pipelines"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "company_lead_settings_quoteStageId_fkey"
    FOREIGN KEY ("quoteStageId") REFERENCES "pipeline_stages"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ── la cotizacion ──────────────────────────────────────────────
ALTER TABLE "quotes"
  ADD COLUMN "lineDiscountTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "adjustment"        DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "adjustmentLabel"   TEXT,
  ADD COLUMN "shipping"          DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "taxRate"           DECIMAL(7,4)  NOT NULL DEFAULT 0,
  ADD COLUMN "taxTotal"          DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "taxIncluded"       BOOLEAN       NOT NULL DEFAULT false,
  ADD COLUMN "currency"          TEXT          NOT NULL DEFAULT 'COP',
  ADD COLUMN "roundingDecimals"  INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN "revision"          INTEGER       NOT NULL DEFAULT 1,
  ADD COLUMN "parentQuoteId"     TEXT,
  ADD COLUMN "sentAt"            TIMESTAMP(3),
  ADD COLUMN "acceptedAt"        TIMESTAMP(3),
  ADD COLUMN "rejectedAt"        TIMESTAMP(3),
  ADD COLUMN "cancelledAt"       TIMESTAMP(3),
  ADD COLUMN "rejectionReason"   TEXT,
  ADD COLUMN "sendIdempotencyKey" TEXT,
  ADD COLUMN "terms"             TEXT,
  ADD COLUMN "contactId"         TEXT,
  ADD COLUMN "conversationId"    TEXT,
  ADD COLUMN "assignedTo"        TEXT;

-- Reintentar un envio NO manda dos veces la misma cotizacion al cliente.
CREATE UNIQUE INDEX "quotes_sendIdempotencyKey_key"
  ON "quotes"("sendIdempotencyKey");

ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_parentQuoteId_fkey"
    FOREIGN KEY ("parentQuoteId") REFERENCES "quotes"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "quotes_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "contacts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "quotes_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "quotes_assignedTo_fkey"
    FOREIGN KEY ("assignedTo") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ── las lineas ─────────────────────────────────────────────────
-- Importe y no porcentaje: lo que hay que conservar es la cifra exacta que se
-- rebajo, no una regla que al recalcular podria dar otra por redondeo.
ALTER TABLE "quote_items"
  ADD COLUMN "lineDiscount"        DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "lineDiscountPercent" DECIMAL(7,4);

-- ROLLBACK COMPLETO:
--   DROP INDEX "quotes_sendIdempotencyKey_key";
--   ALTER TABLE "quote_items" DROP COLUMN "lineDiscount", DROP COLUMN "lineDiscountPercent";
--   ALTER TABLE "quotes" DROP COLUMN "lineDiscountTotal", DROP COLUMN "adjustment",
--     DROP COLUMN "adjustmentLabel", DROP COLUMN "shipping", DROP COLUMN "taxRate",
--     DROP COLUMN "taxTotal", DROP COLUMN "taxIncluded", DROP COLUMN "currency",
--     DROP COLUMN "roundingDecimals", DROP COLUMN "revision", DROP COLUMN "parentQuoteId",
--     DROP COLUMN "sentAt", DROP COLUMN "acceptedAt", DROP COLUMN "rejectedAt",
--     DROP COLUMN "cancelledAt", DROP COLUMN "rejectionReason",
--     DROP COLUMN "sendIdempotencyKey", DROP COLUMN "terms", DROP COLUMN "contactId",
--     DROP COLUMN "conversationId", DROP COLUMN "assignedTo";
--   ALTER TABLE "company_lead_settings" DROP COLUMN "quotePipelineId", DROP COLUMN "quoteStageId";
--   ALTER TABLE "companies" DROP COLUMN "quoteRoundingDecimals",
--     DROP COLUMN "defaultTaxRate", DROP COLUMN "taxIncluded";
