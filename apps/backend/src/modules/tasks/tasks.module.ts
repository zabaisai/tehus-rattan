import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { TaskSuggestionsService } from './task-suggestions.service';
import { TaskSuggestionsController } from './task-suggestions.controller';
import { PlatformAuditLogService } from '../platform/platform-audit-log.service';

@Module({
  imports: [CompaniesModule],
  controllers: [TasksController, TaskSuggestionsController],
  providers: [TasksService, TaskSuggestionsService, PlatformAuditLogService],
  // Se exporta para que el motor de Pulso pueda PROPONER en vez de crear.
  exports: [TasksService, TaskSuggestionsService],
})
export class TasksModule {}
