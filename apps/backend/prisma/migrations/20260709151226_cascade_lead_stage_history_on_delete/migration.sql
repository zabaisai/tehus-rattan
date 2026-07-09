-- DropForeignKey
ALTER TABLE "lead_stage_histories" DROP CONSTRAINT "lead_stage_histories_leadId_fkey";

-- AddForeignKey
ALTER TABLE "lead_stage_histories" ADD CONSTRAINT "lead_stage_histories_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
