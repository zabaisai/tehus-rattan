-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MessageType" ADD VALUE 'STICKER';
ALTER TYPE "MessageType" ADD VALUE 'LOCATION';
ALTER TYPE "MessageType" ADD VALUE 'CONTACTS';
ALTER TYPE "MessageType" ADD VALUE 'INTERACTIVE';
ALTER TYPE "MessageType" ADD VALUE 'REACTION';
ALTER TYPE "MessageType" ADD VALUE 'UNSUPPORTED';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "caption" TEXT,
ADD COLUMN     "contacts" JSONB,
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "errorCode" TEXT,
ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "interactive" JSONB,
ADD COLUMN     "location" JSONB,
ADD COLUMN     "mediaDuration" INTEGER,
ADD COLUMN     "mediaFileName" TEXT,
ADD COLUMN     "mediaId" TEXT,
ADD COLUMN     "mediaMimeType" TEXT,
ADD COLUMN     "mediaSize" INTEGER,
ADD COLUMN     "mediaUrl" TEXT,
ADD COLUMN     "readAt" TIMESTAMP(3),
ADD COLUMN     "replyToWamid" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "messages_conversationId_status_idx" ON "messages"("conversationId", "status");

-- CreateIndex
CREATE INDEX "messages_status_createdAt_idx" ON "messages"("status", "createdAt");
