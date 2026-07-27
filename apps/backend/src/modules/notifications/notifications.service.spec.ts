import { Prisma } from '@prisma/client';
import { NotificationsService } from './notifications.service';

function buildPrisma() {
  return {
    notification: {
      create: jest.fn().mockResolvedValue({ id: 'n1' }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    notificationPreference: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    },
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as any;
}

function build() {
  const prisma = buildPrisma();
  const mail = {
    sendNotificationEmail: jest.fn().mockResolvedValue(undefined),
  } as any;
  const service = new NotificationsService(prisma, mail);
  return { service, prisma, mail };
}

const baseInput = {
  companyId: 'company-a',
  recipientUserId: 'user-1',
  type: 'TASK_ASSIGNED' as const,
  title: 'Tarea asignada',
};

describe('NotificationsService', () => {
  describe('create', () => {
    it('creates an in-app notification with the type category/priority', async () => {
      const { service, prisma } = build();
      await service.create(baseInput);
      const data = prisma.notification.create.mock.calls[0][0].data;
      expect(data.category).toBe('TASK');
      expect(data.priority).toBe('NORMAL');
      expect(data.recipientUserId).toBe('user-1');
      expect(data.companyId).toBe('company-a');
    });

    it('suppresses the notification when the user disabled in-app for the category', async () => {
      const { service, prisma } = build();
      prisma.notificationPreference.findUnique.mockResolvedValue({
        inAppEnabled: false,
        emailEnabled: false,
      });
      const res = await service.create(baseInput);
      expect(res).toBeNull();
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('treats a duplicate dedupeKey (P2002) as an already-recorded event, not an error', async () => {
      const { service, prisma } = build();
      prisma.notification.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );
      const res = await service.create({ ...baseInput, dedupeKey: 'k' });
      expect(res).toBeNull();
    });

    it('dispatches an email only when the category is email-eligible AND the preference is on', async () => {
      const { service, prisma, mail } = build();
      prisma.notificationPreference.findUnique.mockResolvedValue({
        inAppEnabled: true,
        emailEnabled: true,
      });
      prisma.user.findUnique.mockResolvedValue({
        email: 'a@co.test',
        name: 'A',
        isActive: true,
        company: { status: 'ACTIVE' },
      });
      // WHATSAPP is email-eligible.
      await service.create({
        ...baseInput,
        type: 'WHATSAPP_REAUTH_REQUIRED',
        title: 'Reauth',
      });
      await new Promise((r) => setImmediate(r));
      expect(mail.sendNotificationEmail).toHaveBeenCalled();
    });

    it('never emails a category that is not email-eligible even if the preference says so', async () => {
      const { service, prisma, mail } = build();
      prisma.notificationPreference.findUnique.mockResolvedValue({
        inAppEnabled: true,
        emailEnabled: true,
      });
      // LEAD is not in EMAIL_ELIGIBLE_CATEGORIES.
      await service.create({
        ...baseInput,
        type: 'LEAD_ASSIGNED',
        title: 'Lead',
      });
      await new Promise((r) => setImmediate(r));
      expect(mail.sendNotificationEmail).not.toHaveBeenCalled();
    });
  });

  describe('emit / emitToCompanyRoles', () => {
    it('emit never throws even if create fails', async () => {
      const { service, prisma } = build();
      prisma.notification.create.mockRejectedValue(new Error('db down'));
      await expect(service.emit(baseInput)).resolves.toBeUndefined();
    });

    it('fans out to every active user with the given roles, with a per-recipient dedupeKey', async () => {
      const { service, prisma } = build();
      prisma.user.findMany.mockResolvedValue([
        { id: 'admin-1' },
        { id: 'admin-2' },
      ]);
      await service.emitToCompanyRoles('company-a', ['ADMIN', 'SUPER_ADMIN'], {
        type: 'WHATSAPP_CONNECTED',
        title: 'Conectado',
        dedupeKey: 'WHATSAPP_CONNECTED:company-a',
      });
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            companyId: 'company-a',
            isActive: true,
          }),
        }),
      );
      const keys = prisma.notification.create.mock.calls.map(
        (c: any) => c[0].data.dedupeKey,
      );
      expect(keys).toEqual([
        'WHATSAPP_CONNECTED:company-a:admin-1',
        'WHATSAPP_CONNECTED:company-a:admin-2',
      ]);
    });
  });

  describe('listForUser', () => {
    it('scopes to the user + company and supports unread + category filters and cursor', async () => {
      const { service, prisma } = build();
      prisma.notification.findMany.mockResolvedValue(
        Array.from({ length: 21 }, (_, i) => ({ id: `n${i}` })),
      );
      const res = await service.listForUser('user-1', 'company-a', {
        unread: true,
        category: 'TASK',
        limit: 20,
      });
      const args = prisma.notification.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({
        recipientUserId: 'user-1',
        companyId: 'company-a',
        readAt: null,
        category: 'TASK',
      });
      expect(args.take).toBe(21);
      // 21 returned with limit 20 → hasMore, nextCursor set.
      expect(res.items).toHaveLength(20);
      expect(res.nextCursor).toBe('n19');
    });
  });

  describe('markRead / markAllRead', () => {
    it('markRead only affects the caller-owned unread row', async () => {
      const { service, prisma } = build();
      prisma.notification.updateMany.mockResolvedValue({ count: 1 });
      expect(await service.markRead('n1', 'user-1')).toBe(true);
      expect(
        prisma.notification.updateMany.mock.calls[0][0].where,
      ).toMatchObject({
        id: 'n1',
        recipientUserId: 'user-1',
        readAt: null,
      });
    });

    it('markRead returns false when the row is not owned by the caller', async () => {
      const { service, prisma } = build();
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });
      expect(await service.markRead('n1', 'attacker')).toBe(false);
    });

    it('markAllRead scopes to user + company', async () => {
      const { service, prisma } = build();
      prisma.notification.updateMany.mockResolvedValue({ count: 5 });
      expect(await service.markAllRead('user-1', 'company-a')).toBe(5);
      expect(
        prisma.notification.updateMany.mock.calls[0][0].where,
      ).toMatchObject({
        recipientUserId: 'user-1',
        companyId: 'company-a',
        readAt: null,
      });
    });
  });

  describe('preferences', () => {
    it('merges stored rows with defaults for every category', async () => {
      const { service, prisma } = build();
      prisma.notificationPreference.findMany.mockResolvedValue([
        { category: 'TASK', inAppEnabled: false, emailEnabled: true },
      ]);
      const prefs = await service.getPreferences('user-1', 'company-a');
      expect(prefs).toHaveLength(10);
      const task = prefs.find((p) => p.category === 'TASK')!;
      expect(task).toMatchObject({ inAppEnabled: false, emailEnabled: true });
      const security = prefs.find((p) => p.category === 'SECURITY')!;
      // Default: in-app on, email on for SECURITY.
      expect(security).toMatchObject({
        inAppEnabled: true,
        emailEnabled: true,
      });
    });

    it('upserts each valid preference and ignores unknown categories', async () => {
      const { service, prisma } = build();
      await service.updatePreferences('user-1', 'company-a', [
        { category: 'TASK', emailEnabled: true },
        { category: 'NOPE', inAppEnabled: false },
      ]);
      expect(prisma.notificationPreference.upsert).toHaveBeenCalledTimes(1);
      expect(
        prisma.notificationPreference.upsert.mock.calls[0][0].where,
      ).toMatchObject({
        userId_category: { userId: 'user-1', category: 'TASK' },
      });
    });
  });
});
