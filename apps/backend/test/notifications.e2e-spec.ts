import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtStrategy } from '../src/modules/auth/jwt.strategy';
import { PrismaService } from '../src/prisma/prisma.service';
import { MailService } from '../src/modules/mail/mail.service';
import { NotificationsController } from '../src/modules/notifications/notifications.controller';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { RealtimeEmitter } from '../src/common/realtime/realtime.emitter';
import {
  buildFakeSessionPrisma,
  encodeSid,
} from './helpers/fake-session-prisma';

const TEST_JWT_SECRET = 'e2e-test-only-secret-do-not-use-in-prod';

// In-memory notification + preference store, enough for the HTTP-pipeline e2e.
function buildFakePrisma() {
  const notifications: any[] = [];
  const prefs: any[] = [];
  let seq = 0;
  const matches = (n: any, where: any) =>
    n.recipientUserId === where.recipientUserId &&
    n.companyId === where.companyId &&
    (where.readAt === null ? n.readAt === null : true) &&
    (!where.category || n.category === where.category);

  const client: any = {
    ...buildFakeSessionPrisma(),
    notification: {
      create: async ({ data }: any) => {
        const row = { id: `n${++seq}`, readAt: null, ...data };
        notifications.push(row);
        return row;
      },
      findMany: async ({ where, take }: any) =>
        notifications
          .filter((n) => matches(n, where))
          .sort((a, b) => (a.id < b.id ? 1 : -1))
          .slice(0, take ?? 20),
      count: async ({ where }: any) =>
        notifications.filter((n) => matches(n, where)).length,
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const n of notifications) {
          if (
            (where.id ? n.id === where.id : true) &&
            n.recipientUserId === where.recipientUserId &&
            (where.companyId ? n.companyId === where.companyId : true) &&
            (where.readAt === null ? n.readAt === null : true)
          ) {
            Object.assign(n, data);
            count++;
          }
        }
        return { count };
      },
    },
    notificationPreference: {
      findUnique: async ({ where }: any) =>
        prefs.find(
          (p) =>
            p.userId === where.userId_category.userId &&
            p.category === where.userId_category.category,
        ) ?? null,
      findMany: async ({ where }: any) =>
        prefs.filter(
          (p) => p.userId === where.userId && p.companyId === where.companyId,
        ),
      upsert: async ({ where, create, update }: any) => {
        const existing = prefs.find(
          (p) =>
            p.userId === where.userId_category.userId &&
            p.category === where.userId_category.category,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        prefs.push(create);
        return create;
      },
    },
    user: { findUnique: async () => null, findMany: async () => [] },
  };
  return { client, notifications, prefs };
}

describe('Notifications (e2e)', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  let store: ReturnType<typeof buildFakePrisma>;
  let svc: NotificationsService;

  const token = (userId: string, companyId: string, role = 'AGENT') =>
    jwt.sign(
      {
        sub: userId,
        email: 'u@e2e.local',
        role,
        companyId,
        sid: encodeSid(userId, companyId),
      },
      { expiresIn: '5m' },
    );

  beforeAll(async () => {
    store = buildFakePrisma();
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [NotificationsController],
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (k: string) => {
              if (k === 'JWT_SECRET') return TEST_JWT_SECRET;
              throw new Error(k);
            },
          },
        },
        { provide: PrismaService, useValue: store.client },
        {
          provide: MailService,
          useValue: { sendNotificationEmail: jest.fn() },
        },
        {
          provide: RealtimeEmitter,
          useValue: { notificationCreated: jest.fn() },
        },
        NotificationsService,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    jwt = new JwtService({ secret: TEST_JWT_SECRET });
    svc = moduleRef.get(NotificationsService);
  });

  afterAll(async () => app?.close());

  beforeAll(async () => {
    // Seed: 2 for user-a@company-a, 1 for user-b@company-a, 1 for user-c@company-b.
    await svc.create({
      companyId: 'company-a',
      recipientUserId: 'user-a',
      type: 'TASK_ASSIGNED',
      title: 'A1',
    });
    await svc.create({
      companyId: 'company-a',
      recipientUserId: 'user-a',
      type: 'LEAD_ASSIGNED',
      title: 'A2',
    });
    await svc.create({
      companyId: 'company-a',
      recipientUserId: 'user-b',
      type: 'TASK_ASSIGNED',
      title: 'B1',
    });
    await svc.create({
      companyId: 'company-b',
      recipientUserId: 'user-c',
      type: 'TASK_ASSIGNED',
      title: 'C1',
    });
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/api/notifications').expect(401);
  });

  it('lists only the caller-owned notifications (no cross-user leak)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token('user-a', 'company-a')}`)
      .expect(200);
    expect(res.body.items).toHaveLength(2);
    const titles = res.body.items.map((n: any) => n.title).sort();
    expect(titles).toEqual(['A1', 'A2']);
    // No secret / token fields.
    expect(JSON.stringify(res.body)).not.toMatch(/token|password|secret/i);
  });

  it('never leaks another company/user (company-b user sees only their own)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token('user-c', 'company-b')}`)
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].title).toBe('C1');
  });

  it('unread-count is per user', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${token('user-a', 'company-a')}`)
      .expect(200);
    expect(res.body.count).toBe(2);
  });

  it('a user cannot mark another user notification as read', async () => {
    const other = store.notifications.find(
      (n) => n.recipientUserId === 'user-b',
    );
    const res = await request(app.getHttpServer())
      .post(`/api/notifications/${other.id}/read`)
      .set('Authorization', `Bearer ${token('user-a', 'company-a')}`)
      .expect(200);
    expect(res.body.updated).toBe(false);
    expect(other.readAt).toBeFalsy();
  });

  it('marks all own as read and drops the unread count to 0', async () => {
    await request(app.getHttpServer())
      .post('/api/notifications/read-all')
      .set('Authorization', `Bearer ${token('user-a', 'company-a')}`)
      .expect(200);
    const res = await request(app.getHttpServer())
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${token('user-a', 'company-a')}`)
      .expect(200);
    expect(res.body.count).toBe(0);
  });

  it('rejects a non-whitelisted / invalid query (DTO whitelist)', async () => {
    await request(app.getHttpServer())
      .get('/api/notifications?category=BOGUS')
      .set('Authorization', `Bearer ${token('user-a', 'company-a')}`)
      .expect(400);
  });

  it('gets and updates preferences (per user)', async () => {
    const get = await request(app.getHttpServer())
      .get('/api/notifications/preferences')
      .set('Authorization', `Bearer ${token('user-a', 'company-a')}`)
      .expect(200);
    expect(get.body).toHaveLength(10);
    const put = await request(app.getHttpServer())
      .put('/api/notifications/preferences')
      .set('Authorization', `Bearer ${token('user-a', 'company-a')}`)
      .send({ preferences: [{ category: 'TASK', emailEnabled: true }] })
      .expect(200);
    const task = put.body.find((p: any) => p.category === 'TASK');
    expect(task.emailEnabled).toBe(true);
  });
});
