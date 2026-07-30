-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "businessHours" JSONB,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'COP',
ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'es-CO',
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'America/Bogota';
