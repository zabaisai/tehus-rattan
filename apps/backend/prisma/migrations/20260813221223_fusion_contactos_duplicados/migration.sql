-- AlterTable
--
-- `NOT NULL DEFAULT ARRAY[]::TEXT[]` escrito a mano, y no el `TEXT[]` pelado
-- que genera Prisma: un `ADD COLUMN` sin default deja NULL en todas las filas
-- que ya existen, y un array NULL no es lo mismo que un array vacio para quien
-- lo lee. Con el default, los contactos anteriores a esta migracion entran con
-- lista vacia, que es exactamente lo que significan: todavia no tienen
-- identidades alternativas. Es aditivo y no toca ningun dato existente.
ALTER TABLE "contacts" ADD COLUMN     "altEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "altPhones" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "mergedAt" TIMESTAMP(3),
ADD COLUMN     "mergedIntoId" TEXT;

-- Un contacto no puede ser alias de si mismo. Es el unico ciclo que la base
-- puede impedir por si sola; las cadenas mas largas las corta el servicio, que
-- reapunta los alias del absorbido al principal antes de cerrar la fusion.
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_merged_into_no_self"
  CHECK ("mergedIntoId" IS NULL OR "mergedIntoId" <> "id");

-- CreateTable
CREATE TABLE "contact_merges" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "primaryContactId" TEXT NOT NULL,
    "mergedContactId" TEXT NOT NULL,
    "performedById" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneById" TEXT,
    "undoneAt" TIMESTAMP(3),
    "undoableUntil" TIMESTAMP(3) NOT NULL,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "contact_merges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_merge_dismissals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactAId" TEXT NOT NULL,
    "contactBId" TEXT NOT NULL,
    "dismissedById" TEXT,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_merge_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_merges_mergedContactId_key" ON "contact_merges"("mergedContactId");

-- CreateIndex
CREATE INDEX "contact_merges_companyId_performedAt_idx" ON "contact_merges"("companyId", "performedAt");

-- CreateIndex
CREATE INDEX "contact_merge_dismissals_companyId_contactAId_idx" ON "contact_merge_dismissals"("companyId", "contactAId");

-- CreateIndex
CREATE INDEX "contact_merge_dismissals_companyId_contactBId_idx" ON "contact_merge_dismissals"("companyId", "contactBId");

-- CreateIndex
CREATE UNIQUE INDEX "contact_merge_dismissals_companyId_contactAId_contactBId_key" ON "contact_merge_dismissals"("companyId", "contactAId", "contactBId");

-- CreateIndex
CREATE INDEX "contacts_companyId_mergedIntoId_idx" ON "contacts"("companyId", "mergedIntoId");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_merges" ADD CONSTRAINT "contact_merges_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_merges" ADD CONSTRAINT "contact_merges_primaryContactId_fkey" FOREIGN KEY ("primaryContactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_merges" ADD CONSTRAINT "contact_merges_mergedContactId_fkey" FOREIGN KEY ("mergedContactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_merge_dismissals" ADD CONSTRAINT "contact_merge_dismissals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_merge_dismissals" ADD CONSTRAINT "contact_merge_dismissals_contactAId_fkey" FOREIGN KEY ("contactAId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_merge_dismissals" ADD CONSTRAINT "contact_merge_dismissals_contactBId_fkey" FOREIGN KEY ("contactBId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
