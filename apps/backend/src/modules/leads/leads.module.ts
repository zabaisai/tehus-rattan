import { Module } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { LeadProductsService } from './lead-products.service';
import { LeadProductsController } from './lead-products.controller';

@Module({
  controllers: [LeadsController, LeadProductsController],
  providers: [LeadsService, LeadProductsService],
  exports: [LeadsService],
})
export class LeadsModule {}
