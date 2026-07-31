import { Module } from '@nestjs/common';
import { AssignmentService } from './assignment.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [AssignmentService],
  exports: [AssignmentService],
})
export class AssignmentModule {}
