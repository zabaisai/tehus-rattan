import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { LeadProductsService } from './lead-products.service';
import { LeadProductsController } from './lead-products.controller';
import { LeadIntakeService } from './lead-intake.service';
import { LeadSettingsService } from './lead-settings.service';
import { AssignmentModule } from '../assignment/assignment.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AssignmentModule, NotificationsModule, CompaniesModule],
  controllers: [LeadsController, LeadProductsController],
  providers: [
    LeadsService,
    LeadProductsService,
    LeadIntakeService,
    LeadSettingsService,
  ],
  // LeadIntakeService se exporta para el webhook: es el unico camino por el
  // que una conversacion entrante llega al tablero.
  exports: [LeadsService, LeadIntakeService, LeadSettingsService],
})
export class LeadsModule {}
