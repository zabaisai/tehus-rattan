import { Module } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { LeadProductsService } from './lead-products.service';
import { LeadProductsController } from './lead-products.controller';
import { LeadIntakeService } from './lead-intake.service';
import { AssignmentModule } from '../assignment/assignment.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AssignmentModule, NotificationsModule],
  controllers: [LeadsController, LeadProductsController],
  providers: [LeadsService, LeadProductsService, LeadIntakeService],
  // LeadIntakeService se exporta para el webhook: es el unico camino por el
  // que una conversacion entrante llega al tablero.
  exports: [LeadsService, LeadIntakeService],
})
export class LeadsModule {}
