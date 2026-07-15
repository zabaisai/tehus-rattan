import {
  ForbiddenException,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtStrategy } from '../src/modules/auth/jwt.strategy';
import { PrismaService } from '../src/prisma/prisma.service';
import { ContactsController } from '../src/modules/contacts/contacts.controller';
import { ContactsService } from '../src/modules/contacts/contacts.service';
import { SupportSessionsController } from '../src/modules/platform/support-sessions.controller';
import { SupportSessionsService } from '../src/modules/platform/support-sessions.service';
import {
  buildFakeSessionPrisma,
  encodeSid,
} from './helpers/fake-session-prisma';

// Test-only secret, never read from .env and never logged.
const TEST_JWT_SECRET = 'e2e-test-only-secret-do-not-use-in-prod';

// SupportSessionsController only depends on SupportSessionsService, so
// mocking that one service here is enough to exercise the real
// AuthGuard('jwt') + PlatformGuard + ValidationPipe pipeline without ever
// touching Prisma or a real database. ContactsController rides along to
// prove BusinessTenantGuard on ordinary business endpoints is unaffected.
const supportSessionsServiceMock = {
  createSession: jest.fn(),
  endSession: jest.fn(),
  listSessions: jest.fn(),
  listSessionConversations: jest.fn(),
  getSessionConversationDetail: jest.fn(),
};

const contactsServiceMock = {
  findAll: jest.fn(),
};

describe('SupportSessionsController (e2e)', () => {
  let app: INestApplication<App>;
  let jwtService: JwtService;

  const signToken = (role: string, companyId: string | null) =>
    jwtService.sign(
      {
        sub: 'user-1',
        email: 'platform@tehus.test',
        role,
        companyId,
        sid: encodeSid('user-1', companyId),
      },
      { expiresIn: '5m' },
    );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [SupportSessionsController, ContactsController],
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              if (key === 'JWT_SECRET') return TEST_JWT_SECRET;
              throw new Error(`Unexpected config key requested: ${key}`);
            },
          },
        },
        { provide: PrismaService, useValue: buildFakeSessionPrisma() },
        {
          provide: SupportSessionsService,
          useValue: supportSessionsServiceMock,
        },
        { provide: ContactsService, useValue: contactsServiceMock },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirrors src/main.ts: global prefix + global ValidationPipe, so this
    // e2e suite exercises the real production request pipeline.
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    jwtService = new JwtService({ secret: TEST_JWT_SECRET });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/platform/support-sessions', () => {
    const validBody = {
      companyId: 'company-a',
      reason: 'Cliente pidió soporte para revisar un caso puntual',
    };

    it('allows a global SUPER_ADMIN and returns 201', async () => {
      supportSessionsServiceMock.createSession.mockResolvedValue({
        id: 'session-1',
        status: 'ACTIVE',
      });
      const token = signToken('SUPER_ADMIN', null);

      await request(app.getHttpServer())
        .post('/api/platform/support-sessions')
        .set('Authorization', `Bearer ${token}`)
        .send(validBody)
        .expect(201);

      expect(supportSessionsServiceMock.createSession).toHaveBeenCalledWith(
        validBody,
        expect.objectContaining({
          actorUserId: 'user-1',
          actorRole: 'SUPER_ADMIN',
        }),
      );
    });

    it('rejects ADMIN with 403', async () => {
      const token = signToken('ADMIN', 'company-a');

      await request(app.getHttpServer())
        .post('/api/platform/support-sessions')
        .set('Authorization', `Bearer ${token}`)
        .send(validBody)
        .expect(403);

      expect(supportSessionsServiceMock.createSession).not.toHaveBeenCalled();
    });

    it('rejects a SUPER_ADMIN scoped to a company with 403', async () => {
      const token = signToken('SUPER_ADMIN', 'company-a');

      await request(app.getHttpServer())
        .post('/api/platform/support-sessions')
        .set('Authorization', `Bearer ${token}`)
        .send(validBody)
        .expect(403);

      expect(supportSessionsServiceMock.createSession).not.toHaveBeenCalled();
    });

    it('rejects a request without a token with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/platform/support-sessions')
        .send(validBody)
        .expect(401);

      expect(supportSessionsServiceMock.createSession).not.toHaveBeenCalled();
    });

    it('rejects an invalid DTO (missing reason) with 400', async () => {
      const token = signToken('SUPER_ADMIN', null);

      await request(app.getHttpServer())
        .post('/api/platform/support-sessions')
        .set('Authorization', `Bearer ${token}`)
        .send({ companyId: 'company-a' })
        .expect(400);

      expect(supportSessionsServiceMock.createSession).not.toHaveBeenCalled();
    });

    it('rejects a reason longer than 500 characters with 400', async () => {
      const token = signToken('SUPER_ADMIN', null);

      await request(app.getHttpServer())
        .post('/api/platform/support-sessions')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...validBody, reason: 'a'.repeat(501) })
        .expect(400);

      expect(supportSessionsServiceMock.createSession).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/platform/support-sessions', () => {
    it('allows a global SUPER_ADMIN to list their sessions', async () => {
      supportSessionsServiceMock.listSessions.mockResolvedValue([]);
      const token = signToken('SUPER_ADMIN', null);

      await request(app.getHttpServer())
        .get('/api/platform/support-sessions')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(supportSessionsServiceMock.listSessions).toHaveBeenCalledWith(
        'user-1',
        { companyId: undefined, status: undefined },
      );
    });

    it('rejects ADMIN with 403', async () => {
      const token = signToken('ADMIN', 'company-a');

      await request(app.getHttpServer())
        .get('/api/platform/support-sessions')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(supportSessionsServiceMock.listSessions).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/platform/support-sessions/:id/end', () => {
    it('allows a global SUPER_ADMIN to end their own session', async () => {
      supportSessionsServiceMock.endSession.mockResolvedValue({
        id: 'session-1',
        status: 'ENDED',
      });
      const token = signToken('SUPER_ADMIN', null);

      await request(app.getHttpServer())
        .post('/api/platform/support-sessions/session-1/end')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect(supportSessionsServiceMock.endSession).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ actorUserId: 'user-1' }),
      );
    });

    it('rejects a SUPER_ADMIN scoped to a company with 403', async () => {
      const token = signToken('SUPER_ADMIN', 'company-a');

      await request(app.getHttpServer())
        .post('/api/platform/support-sessions/session-1/end')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(supportSessionsServiceMock.endSession).not.toHaveBeenCalled();
    });

    it('rejects ADMIN with 403', async () => {
      const token = signToken('ADMIN', 'company-a');

      await request(app.getHttpServer())
        .post('/api/platform/support-sessions/session-1/end')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(supportSessionsServiceMock.endSession).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/platform/support-sessions/:id/conversations', () => {
    const safeConversation = {
      id: 'conv-1',
      status: 'OPEN',
      channel: 'whatsapp',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      contact: { id: 'contact-1', name: 'Jane Doe' },
      assignedUser: { id: 'user-1', name: 'Agent A' },
    };

    it('allows a global SUPER_ADMIN with a valid session to list conversations', async () => {
      supportSessionsServiceMock.listSessionConversations.mockResolvedValue([
        safeConversation,
      ]);
      const token = signToken('SUPER_ADMIN', null);

      const res = await request(app.getHttpServer())
        .get('/api/platform/support-sessions/session-1/conversations')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(
        supportSessionsServiceMock.listSessionConversations,
      ).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ actorUserId: 'user-1' }),
        { page: undefined, limit: undefined },
      );
      expect(res.body).toEqual([safeConversation]);
    });

    it('rejects ADMIN with 403', async () => {
      const token = signToken('ADMIN', 'company-a');

      await request(app.getHttpServer())
        .get('/api/platform/support-sessions/session-1/conversations')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(
        supportSessionsServiceMock.listSessionConversations,
      ).not.toHaveBeenCalled();
    });

    it('rejects a SUPER_ADMIN scoped to a company with 403', async () => {
      const token = signToken('SUPER_ADMIN', 'company-a');

      await request(app.getHttpServer())
        .get('/api/platform/support-sessions/session-1/conversations')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(
        supportSessionsServiceMock.listSessionConversations,
      ).not.toHaveBeenCalled();
    });

    it('rejects a request without a token with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/platform/support-sessions/session-1/conversations')
        .expect(401);

      expect(
        supportSessionsServiceMock.listSessionConversations,
      ).not.toHaveBeenCalled();
    });

    it('blocks access when the session is invalid (expired/ENDED)', async () => {
      supportSessionsServiceMock.listSessionConversations.mockRejectedValue(
        new ForbiddenException('La sesión de soporte no está activa'),
      );
      const token = signToken('SUPER_ADMIN', null);

      await request(app.getHttpServer())
        .get('/api/platform/support-sessions/session-1/conversations')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('blocks access when the session belongs to another actor', async () => {
      supportSessionsServiceMock.listSessionConversations.mockRejectedValue(
        new NotFoundException('Sesión de soporte no encontrada'),
      );
      const token = signToken('SUPER_ADMIN', null);

      await request(app.getHttpServer())
        .get('/api/platform/support-sessions/session-1/conversations')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('never returns messages', async () => {
      supportSessionsServiceMock.listSessionConversations.mockResolvedValue([
        safeConversation,
      ]);
      const token = signToken('SUPER_ADMIN', null);

      const res = await request(app.getHttpServer())
        .get('/api/platform/support-sessions/session-1/conversations')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(JSON.stringify(res.body)).not.toContain('messages');
      expect(JSON.stringify(res.body)).not.toContain('lastMessage');
    });
  });

  describe('GET /api/platform/support-sessions/:id/conversations/:conversationId', () => {
    const safeDetail = {
      conversation: {
        id: 'conv-1',
        status: 'OPEN',
        channel: 'whatsapp',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        contact: { id: 'contact-1', name: 'Jane Doe' },
        assignedUser: { id: 'user-1', name: 'Agent A' },
      },
      messages: [
        {
          id: 'msg-1',
          direction: 'INBOUND',
          type: 'TEXT',
          status: 'RECEIVED',
          body: 'Hola, necesito ayuda',
          createdAt: '2026-01-01T10:00:00.000Z',
        },
      ],
      page: 1,
      limit: 50,
    };

    it('allows a global SUPER_ADMIN with a valid session to see the detail', async () => {
      supportSessionsServiceMock.getSessionConversationDetail.mockResolvedValue(
        safeDetail,
      );
      const token = signToken('SUPER_ADMIN', null);

      const res = await request(app.getHttpServer())
        .get('/api/platform/support-sessions/session-1/conversations/conv-1')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(
        supportSessionsServiceMock.getSessionConversationDetail,
      ).toHaveBeenCalledWith(
        'session-1',
        'conv-1',
        expect.objectContaining({ actorUserId: 'user-1' }),
        { page: undefined, limit: undefined },
      );
      expect(res.body).toEqual(safeDetail);
    });

    it('rejects ADMIN with 403', async () => {
      const token = signToken('ADMIN', 'company-a');

      await request(app.getHttpServer())
        .get('/api/platform/support-sessions/session-1/conversations/conv-1')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(
        supportSessionsServiceMock.getSessionConversationDetail,
      ).not.toHaveBeenCalled();
    });

    it('rejects a SUPER_ADMIN scoped to a company with 403', async () => {
      const token = signToken('SUPER_ADMIN', 'company-a');

      await request(app.getHttpServer())
        .get('/api/platform/support-sessions/session-1/conversations/conv-1')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(
        supportSessionsServiceMock.getSessionConversationDetail,
      ).not.toHaveBeenCalled();
    });

    it('rejects a request without a token with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/platform/support-sessions/session-1/conversations/conv-1')
        .expect(401);

      expect(
        supportSessionsServiceMock.getSessionConversationDetail,
      ).not.toHaveBeenCalled();
    });

    it('blocks access when the session is invalid (expired/ENDED) with 403', async () => {
      supportSessionsServiceMock.getSessionConversationDetail.mockRejectedValue(
        new ForbiddenException('La sesión de soporte no está activa'),
      );
      const token = signToken('SUPER_ADMIN', null);

      await request(app.getHttpServer())
        .get('/api/platform/support-sessions/session-1/conversations/conv-1')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('blocks access when the session belongs to another actor with 404', async () => {
      supportSessionsServiceMock.getSessionConversationDetail.mockRejectedValue(
        new NotFoundException('Sesión de soporte no encontrada'),
      );
      const token = signToken('SUPER_ADMIN', null);

      await request(app.getHttpServer())
        .get('/api/platform/support-sessions/session-1/conversations/conv-1')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('returns 404 for a conversation belonging to another company', async () => {
      supportSessionsServiceMock.getSessionConversationDetail.mockRejectedValue(
        new NotFoundException('Conversación no encontrada'),
      );
      const token = signToken('SUPER_ADMIN', null);

      await request(app.getHttpServer())
        .get(
          '/api/platform/support-sessions/session-1/conversations/conv-other-company',
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('includes messages with body in the response', async () => {
      supportSessionsServiceMock.getSessionConversationDetail.mockResolvedValue(
        safeDetail,
      );
      const token = signToken('SUPER_ADMIN', null);

      const res = await request(app.getHttpServer())
        .get('/api/platform/support-sessions/session-1/conversations/conv-1')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.messages).toHaveLength(1);
      expect(res.body.messages[0].body).toBe('Hola, necesito ayuda');
    });

    it('never returns wamid, notes, tokens, password, or hash', async () => {
      supportSessionsServiceMock.getSessionConversationDetail.mockResolvedValue(
        safeDetail,
      );
      const token = signToken('SUPER_ADMIN', null);

      const res = await request(app.getHttpServer())
        .get('/api/platform/support-sessions/session-1/conversations/conv-1')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const serialized = JSON.stringify(res.body).toLowerCase();
      ['wamid', 'notes', 'password', 'hash', 'accesstokenencrypted'].forEach(
        (needle) => {
          expect(serialized).not.toContain(needle);
        },
      );
      expect(serialized).not.toContain('"token"');
    });
  });

  describe('platform endpoints stay under /api and do not affect BusinessTenantGuard', () => {
    it('rejects a global SUPER_ADMIN from an ordinary business endpoint with 403', async () => {
      const token = signToken('SUPER_ADMIN', null);

      const res = await request(app.getHttpServer())
        .get('/api/contacts')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(res.body.message).toBe(
        'Este endpoint requiere un usuario asociado a una empresa',
      );
      expect(contactsServiceMock.findAll).not.toHaveBeenCalled();
    });

    it('still allows an ADMIN with a companyId on the business endpoint', async () => {
      contactsServiceMock.findAll.mockResolvedValue([]);
      const token = signToken('ADMIN', 'company-a');

      await request(app.getHttpServer())
        .get('/api/contacts')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(contactsServiceMock.findAll).toHaveBeenCalled();
    });
  });
});
