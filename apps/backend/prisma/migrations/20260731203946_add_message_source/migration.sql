-- CreateEnum
CREATE TYPE "MessageSource" AS ENUM ('LIVE', 'HISTORY_SYNC', 'CSV_IMPORT');

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "source" "MessageSource" NOT NULL DEFAULT 'LIVE';
