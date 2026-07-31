import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeEmitter } from '../../common/realtime/realtime.emitter';
import { MailService } from '../mail/mail.service';
import {
  ALL_CATEGORIES,
  defaultPreference,
  EMAIL_ELIGIBLE_CATEGORIES,
  NOTIFICATION_TYPE_META,
  NotificationType,
} from './notification-types';

export interface CreateNotificationInput {
  companyId: string;
  recipientUserId: string;
  type: NotificationType;
  title: string;
  bodyPreview?: string;
  actorUserId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  actionUrl?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  dedupeKey?: string | null;
  expiresAt?: Date | null;
}

export interface ListNotificationsQuery {
  unread?: boolean;
  category?: string;
  priority?: string;
  cursor?: string;
  limit?: number;
}

// Any Prisma client capable of writing a notification — the main service or an
// interactive-transaction client, so a notification can be created inside the
// same transaction as the event it describes.
type NotificationWriter = Pick<PrismaService, 'notification'>;

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
    private realtime: RealtimeEmitter,
  ) {}

  // Creates one notification, honoring the recipient's in-app preference and
  // the unique dedupeKey (a burst of the same event collapses to one row).
  // Returns the created notification, or null when suppressed (preference off
  // or duplicate). Emails are dispatched best-effort, out of band.
  async create(
    input: CreateNotificationInput,
    writer: NotificationWriter = this.prisma,
  ) {
    const meta = NOTIFICATION_TYPE_META[input.type];
    if (!meta) {
      this.logger.warn(`Unknown notification type: ${input.type}`);
      return null;
    }

    const pref = await this.effectivePreference(
      input.recipientUserId,
      meta.category,
    );
    if (!pref.inAppEnabled) return null;

    try {
      const created = await writer.notification.create({
        data: {
          companyId: input.companyId,
          recipientUserId: input.recipientUserId,
          actorUserId: input.actorUserId ?? null,
          type: input.type,
          category: meta.category,
          priority: meta.priority,
          title: input.title,
          bodyPreview: input.bodyPreview ?? null,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          actionUrl: input.actionUrl ?? null,
          metadata: input.metadata ?? Prisma.JsonNull,
          dedupeKey: input.dedupeKey ?? null,
          expiresAt: input.expiresAt ?? null,
        },
      });

      if (
        pref.emailEnabled &&
        EMAIL_ELIGIBLE_CATEGORIES.includes(meta.category)
      ) {
        void this.dispatchEmail(input, meta.category);
      }
      return created;
    } catch (error) {
      // Duplicate dedupeKey → the event was already recorded; not an error.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return null;
      }
      throw error;
    }
  }

  // Best-effort fan-out that never throws — for out-of-band emission where a
  // notification failure must not break the triggering operation.
  async emit(input: CreateNotificationInput): Promise<void> {
    try {
      const created = await this.create(input);
      // El aviso en vivo se emite AQUI y no dentro de `create`: ese metodo
      // acepta un writer transaccional, y emitir antes del commit haria que
      // el cliente recargara y no encontrara todavia la notificacion. Este
      // camino es fuera de transaccion, asi que la fila ya es visible.
      if (created) {
        this.realtime.notificationCreated(created.recipientUserId, created.id);
      }
    } catch (error) {
      this.logger.warn(
        `Notification emit failed [${input.type}]: ${(error as Error).message}`,
      );
    }
  }

  async emitMany(inputs: CreateNotificationInput[]): Promise<void> {
    for (const input of inputs) await this.emit(input);
  }

  // Best-effort fan-out to every ACTIVE user of a company holding one of the
  // given roles (e.g. ADMIN/SUPER_ADMIN for WhatsApp alerts). Never throws.
  // A per-recipient dedupeKey is derived so the same event collapses per user.
  async emitToCompanyRoles(
    companyId: string,
    roles: string[],
    base: Omit<CreateNotificationInput, 'companyId' | 'recipientUserId'>,
  ): Promise<void> {
    try {
      const users = await this.prisma.user.findMany({
        where: {
          companyId,
          isActive: true,
          role: { in: roles as never },
        },
        select: { id: true },
      });
      for (const u of users) {
        await this.emit({
          ...base,
          companyId,
          recipientUserId: u.id,
          dedupeKey: base.dedupeKey ? `${base.dedupeKey}:${u.id}` : null,
        });
      }
    } catch (error) {
      this.logger.warn(
        `emitToCompanyRoles failed [${base.type}]: ${(error as Error).message}`,
      );
    }
  }

  async listForUser(
    userId: string,
    companyId: string,
    query: ListNotificationsQuery,
  ) {
    const limit = Math.min(
      Math.max(query.limit ?? DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );
    const where: Prisma.NotificationWhereInput = {
      recipientUserId: userId,
      companyId,
    };
    if (query.unread) where.readAt = null;
    if (query.category && ALL_CATEGORIES.includes(query.category as never)) {
      where.category = query.category as never;
    }
    if (query.priority) where.priority = query.priority as never;

    const items = await this.prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: this.safeSelect(),
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async unreadCount(userId: string, companyId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { recipientUserId: userId, companyId, readAt: null },
    });
  }

  // Marks one notification read — only if it belongs to the caller.
  async markRead(id: string, userId: string): Promise<boolean> {
    const result = await this.prisma.notification.updateMany({
      where: { id, recipientUserId: userId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count === 1;
  }

  async markAllRead(userId: string, companyId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { recipientUserId: userId, companyId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  // Returns every category merged with the user's stored preference (or the
  // default when absent), so the UI always has a complete list.
  async getPreferences(userId: string, companyId: string) {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId, companyId },
    });
    const byCategory = new Map(rows.map((r) => [r.category, r]));
    return ALL_CATEGORIES.map((category) => {
      const row = byCategory.get(category);
      const def = defaultPreference(category);
      return {
        category,
        inAppEnabled: row?.inAppEnabled ?? def.inAppEnabled,
        emailEnabled: row?.emailEnabled ?? def.emailEnabled,
      };
    });
  }

  async updatePreferences(
    userId: string,
    companyId: string,
    updates: {
      category: string;
      inAppEnabled?: boolean;
      emailEnabled?: boolean;
    }[],
  ) {
    for (const u of updates) {
      if (!ALL_CATEGORIES.includes(u.category as never)) continue;
      const def = defaultPreference(u.category as never);
      await this.prisma.notificationPreference.upsert({
        where: {
          userId_category: { userId, category: u.category as never },
        },
        create: {
          userId,
          companyId,
          category: u.category as never,
          inAppEnabled: u.inAppEnabled ?? def.inAppEnabled,
          emailEnabled: u.emailEnabled ?? def.emailEnabled,
        },
        update: {
          ...(u.inAppEnabled !== undefined
            ? { inAppEnabled: u.inAppEnabled }
            : {}),
          ...(u.emailEnabled !== undefined
            ? { emailEnabled: u.emailEnabled }
            : {}),
        },
      });
    }
    return this.getPreferences(userId, companyId);
  }

  // ── helpers ────────────────────────────────────────────────

  private async effectivePreference(userId: string, category: string) {
    const row = await this.prisma.notificationPreference.findUnique({
      where: {
        userId_category: { userId, category: category as never },
      },
    });
    const def = defaultPreference(category as never);
    return {
      inAppEnabled: row?.inAppEnabled ?? def.inAppEnabled,
      emailEnabled: row?.emailEnabled ?? def.emailEnabled,
    };
  }

  private async dispatchEmail(
    input: CreateNotificationInput,
    category: string,
  ): Promise<void> {
    try {
      const recipient = await this.prisma.user.findUnique({
        where: { id: input.recipientUserId },
        select: {
          email: true,
          name: true,
          isActive: true,
          company: { select: { status: true } },
        },
      });
      if (
        !recipient?.isActive ||
        !recipient.email ||
        recipient.company?.status !== 'ACTIVE'
      ) {
        return;
      }
      await this.mail.sendNotificationEmail({
        to: recipient.email,
        name: recipient.name,
        title: input.title,
        preview: input.bodyPreview ?? '',
        actionUrl: input.actionUrl ?? null,
        category,
      });
    } catch (error) {
      this.logger.warn(
        `Notification email dispatch failed [${input.type}]: ${(error as Error).message}`,
      );
    }
  }

  // The projection returned to clients — never includes internal-only columns
  // beyond what the UI needs. (No token/secret is ever stored here anyway.)
  private safeSelect() {
    return {
      id: true,
      type: true,
      category: true,
      priority: true,
      title: true,
      bodyPreview: true,
      entityType: true,
      entityId: true,
      actionUrl: true,
      readAt: true,
      createdAt: true,
    } satisfies Prisma.NotificationSelect;
  }
}
