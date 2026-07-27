import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TaskStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

// How far ahead counts as "due soon" (hours). A task crossing this window
// produces one TASK_DUE_SOON; once its dueDate passes, one TASK_OVERDUE. Both
// are single-shot per task via a unique dedupeKey.
export const DUE_SOON_WINDOW_HOURS = 24;
// Read notifications older than this are pruned (audit logs are never touched).
export const READ_RETENTION_DAYS = 60;

const ACTIVE_TASK_STATUSES: TaskStatus[] = ['PENDING', 'IN_PROGRESS'];

@Injectable()
export class NotificationSchedulerService {
  private readonly logger = new Logger(NotificationSchedulerService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  // Runs hourly (single instance on staging). Idempotent: dedupeKeys make
  // re-runs no-ops. Documented scaling note: for multi-instance, move to a
  // leader-elected job or a durable queue (see docs).
  @Cron(CronExpression.EVERY_HOUR)
  async handleScheduledTaskNotifications(): Promise<void> {
    await this.notifyDueSoonTasks();
    await this.notifyOverdueTasks();
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleRetentionCleanup(): Promise<number> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - READ_RETENTION_DAYS * 86_400_000);
    const result = await this.prisma.notification.deleteMany({
      where: {
        OR: [
          { readAt: { not: null, lt: cutoff } },
          { expiresAt: { not: null, lt: now } },
        ],
      },
    });
    if (result.count > 0) {
      this.logger.log(`Pruned ${result.count} old/expired notifications`);
    }
    return result.count;
  }

  async notifyDueSoonTasks(): Promise<number> {
    const now = new Date();
    const windowEnd = new Date(
      now.getTime() + DUE_SOON_WINDOW_HOURS * 3_600_000,
    );
    const tasks = await this.prisma.task.findMany({
      where: {
        status: { in: ACTIVE_TASK_STATUSES },
        assignedTo: { not: null },
        dueDate: { gte: now, lte: windowEnd },
      },
      select: {
        id: true,
        title: true,
        companyId: true,
        assignedTo: true,
        dueDate: true,
      },
    });
    let sent = 0;
    for (const t of tasks) {
      const created = await this.emitTaskNotification(
        t,
        'TASK_DUE_SOON',
        'vence pronto',
      );
      if (created) sent++;
    }
    return sent;
  }

  async notifyOverdueTasks(): Promise<number> {
    const now = new Date();
    const tasks = await this.prisma.task.findMany({
      where: {
        status: { in: ACTIVE_TASK_STATUSES },
        assignedTo: { not: null },
        dueDate: { lt: now },
      },
      select: {
        id: true,
        title: true,
        companyId: true,
        assignedTo: true,
        dueDate: true,
      },
    });
    let sent = 0;
    for (const t of tasks) {
      const created = await this.emitTaskNotification(
        t,
        'TASK_OVERDUE',
        'está vencida',
      );
      if (created) sent++;
    }
    return sent;
  }

  private async emitTaskNotification(
    task: {
      id: string;
      title: string;
      companyId: string;
      assignedTo: string | null;
    },
    type: 'TASK_DUE_SOON' | 'TASK_OVERDUE',
    phrase: string,
  ): Promise<boolean> {
    if (!task.assignedTo) return false;
    const created = await this.notifications
      .create({
        companyId: task.companyId,
        recipientUserId: task.assignedTo,
        type,
        title: `Tu tarea "${task.title.slice(0, 80)}" ${phrase}`,
        entityType: 'Task',
        entityId: task.id,
        actionUrl: `/dashboard/tasks`,
        // One notification per task per type, ever.
        dedupeKey: `${type}:${task.id}`,
      })
      .catch(() => null);
    return Boolean(created);
  }
}
