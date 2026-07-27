import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationSchedulerService } from './notification-scheduler.service';

@Module({
  imports: [MailModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationSchedulerService],
  // Exported so other modules (WhatsApp, webhook, tasks, …) can emit events.
  exports: [NotificationsService],
})
export class NotificationsModule {}
