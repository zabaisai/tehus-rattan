-- AlterTable
ALTER TABLE "data_requests" ADD COLUMN     "confirmationText" TEXT,
ADD COLUMN     "executedBy" TEXT,
ADD COLUMN     "rejectionReason" TEXT;
