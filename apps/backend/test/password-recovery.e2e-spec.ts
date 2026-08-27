// Comprehensive password-recovery e2e against the real local database, with the
// MailService replaced by a capturing mock (so the plaintext token is available
// to drive the reset without ever sending mail). Never calls a real SMTP server.
process.env.THROTTLE_PASSWORD_RESET_LIMIT = '1000'; // don't throttle the functional cases

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { AppModule } from '../src/app.module';
import { AccountThrottleGuard } from '../src/common/throttle/account-throttle.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  MailService,
  type SendPasswordResetInput,
} from '../src/modules/mail/mail.service';

const ORIGIN = 'http://localhost:3000';
const STRONG = 'OldStrong!2026';
const NEW_STRONG = 'BrandNew!2027';

// Capturing mock. `failNext` makes the next send throw (to test compensation).
class MockMailService {
  sent: SendPasswordResetInput[] = [];
  failNext = false;
  isEnabled() {
    return true;
  }
  async sendPasswordResetEmail(input: SendPasswordResetInput) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('smtp failure (test)');
    }
    this.sent.push(input);
  }
  tokenFor(email: string): string | null {
    const mail = [...this.sent]
      .reverse()
      .find((m) => m.to.toLowerCase() === email.toLowerCase());
    if (!mail) return null;
    const match = mail.resetUrl.match(/token=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }
}

describe('Password recovery (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: MockMailService;
  let server: import('http').Server;

  const ids: Record<string, string> = {};

  beforeAll(async () => {
    mail = new MockMailService();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue(mail)
      // Este e2e hace varios logins con las mismas cuentas y NO prueba el límite
      // por cuenta; se desactiva ese guard de forma explícita (su e2e dedicada
      // lo deja activo). El límite por IP y el resto de guards siguen vigentes.
      .overrideGuard(AccountThrottleGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    await cleanup();

    const hash = await bcrypt.hash(STRONG, 10);
    const coA = await prisma.company.create({ data: { name: 'PR_E2E_A' } });
    const coB = await prisma.company.create({ data: { name: 'PR_E2E_B' } });
    const coC = await prisma.company.create({
      data: { name: 'PR_E2E_C', status: 'SUSPENDED' },
    });
    ids.coA = coA.id;
    ids.coB = coB.id;

    const mk = async (
      key: string,
      email: string,
      role: string,
      companyId: string | null,
      isActive = true,
    ) => {
      const u = await prisma.user.create({
        data: {
          email,
          password: hash,
          name: email,
          role: role as any,
          isActive,
          companyId,
        },
      });
      ids[key] = u.id;
    };
    await mk('superAdmin', 'pr.super@e2e.local', 'SUPER_ADMIN', null);
    await mk('adminA', 'pr.admina@e2e.local', 'ADMIN', coA.id);
    await mk('adminA2', 'pr.admina2@e2e.local', 'ADMIN', coA.id);
    await mk('agentA', 'pr.agenta@e2e.local', 'AGENT', coA.id);
    await mk('adminB', 'pr.adminb@e2e.local', 'ADMIN', coB.id);
    await mk('agentB', 'pr.agentb@e2e.local', 'AGENT', coB.id);
    await mk('inactive', 'pr.inactive@e2e.local', 'AGENT', coA.id, false);
    await mk('agentC', 'pr.agentc@e2e.local', 'AGENT', coC.id);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  async function cleanup() {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: '@e2e.local' } },
      select: { id: true },
    });
    const uids = users.map((u) => u.id);
    if (uids.length) {
      await prisma.passwordResetToken.deleteMany({
        where: { userId: { in: uids } },
      });
      await prisma.userSession.deleteMany({ where: { userId: { in: uids } } });
      await prisma.loginEvent
        .deleteMany({ where: { userId: { in: uids } } })
        .catch(() => undefined);
      await prisma.auditLog
        .deleteMany({ where: { actorUserId: { in: uids } } })
        .catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: { in: uids } } });
    }
    await prisma.company.deleteMany({
      where: { name: { startsWith: 'PR_E2E_' } },
    });
  }

  const forgot = (email: string, origin: string | null = ORIGIN) => {
    const r = request(server)
      .post('/api/auth/forgot-password')
      .set('Content-Type', 'application/json');
    if (origin) r.set('Origin', origin);
    return r.send({ email });
  };
  const reset = (body: object, origin: string | null = ORIGIN) => {
    const r = request(server)
      .post('/api/auth/reset-password')
      .set('Content-Type', 'application/json');
    if (origin) r.set('Origin', origin);
    return r.send(body);
  };
  const login = (email: string, password: string) =>
    request(server)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .send({ email, password });

  const GENERIC = 'Si existe una cuenta';

  // ---- anti-enumeration ----------------------------------------------------
  describe('anti-enumeration', () => {
    it('active user → 200 generic + token issued', async () => {
      const before = mail.sent.length;
      const res = await forgot('pr.admina@e2e.local').expect(200);
      expect(res.body.message).toContain(GENERIC);
      expect(mail.sent.length).toBe(before + 1);
      expect(mail.tokenFor('pr.admina@e2e.local')).toBeTruthy();
    });

    it.each([
      ['non-existent', 'nobody-xyz@e2e.local'],
      ['inactive user', 'pr.inactive@e2e.local'],
      ['user in suspended company', 'pr.agentc@e2e.local'],
    ])('%s → identical 200 generic + NO email', async (_label, email) => {
      const before = mail.sent.length;
      const res = await forgot(email).expect(200);
      expect(res.body.message).toContain(GENERIC);
      expect(mail.sent.length).toBe(before); // no email issued
    });

    it('SUPER_ADMIN (companyId null) is eligible', async () => {
      const before = mail.sent.length;
      await forgot('pr.super@e2e.local').expect(200);
      expect(mail.sent.length).toBe(before + 1);
    });

    it('normalizes the email (spaces + uppercase)', async () => {
      const before = mail.sent.length;
      await forgot('  PR.AGENTA@E2E.LOCAL  ').expect(200);
      expect(mail.sent.length).toBe(before + 1);
      expect(mail.tokenFor('pr.agenta@e2e.local')).toBeTruthy();
    });
  });

  // ---- token lifecycle & reset --------------------------------------------
  describe('reset & token lifecycle', () => {
    it('happy path: valid token resets the password (old fails, new works)', async () => {
      await forgot('pr.adminb@e2e.local').expect(200);
      const token = mail.tokenFor('pr.adminb@e2e.local')!;
      await login('pr.adminb@e2e.local', STRONG).expect(201); // creates a session to revoke

      const res = await reset({
        token,
        password: NEW_STRONG,
        passwordConfirmation: NEW_STRONG,
      }).expect(200);
      expect(res.body.message).toContain('actualizada');

      await login('pr.adminb@e2e.local', STRONG).expect(401);
      await login('pr.adminb@e2e.local', NEW_STRONG).expect(201);
    });

    it('is single-use: reusing a consumed token → 400', async () => {
      await forgot('pr.agentb@e2e.local').expect(200);
      const token = mail.tokenFor('pr.agentb@e2e.local')!;
      await reset({
        token,
        password: 'FirstNew!2027',
        passwordConfirmation: 'FirstNew!2027',
      }).expect(200);
      await reset({
        token,
        password: 'SecondNew!2027',
        passwordConfirmation: 'SecondNew!2027',
      }).expect(400);
    });

    it('rejects an expired token → 400', async () => {
      await forgot('pr.admina2@e2e.local').expect(200);
      const token = mail.tokenFor('pr.admina2@e2e.local')!;
      // expire it
      await prisma.passwordResetToken.updateMany({
        where: { tokenHash: sha256(token) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await reset({
        token,
        password: NEW_STRONG,
        passwordConfirmation: NEW_STRONG,
      }).expect(400);
    });

    it('issuing a new token revokes the prior one → old token 400', async () => {
      await forgot('pr.agenta@e2e.local').expect(200);
      const first = mail.tokenFor('pr.agenta@e2e.local')!;
      // backdate the first token past the resend cooldown so a second issues
      await prisma.passwordResetToken.updateMany({
        where: { tokenHash: sha256(first) },
        data: { createdAt: new Date(Date.now() - 5 * 60_000) },
      });
      await forgot('pr.agenta@e2e.local').expect(200);
      const second = mail.tokenFor('pr.agenta@e2e.local')!;
      expect(second).not.toBe(first);
      // the FIRST (now revoked) token must fail
      await reset({
        token: first,
        password: NEW_STRONG,
        passwordConfirmation: NEW_STRONG,
      }).expect(400);
      // the SECOND still works
      await reset({
        token: second,
        password: NEW_STRONG,
        passwordConfirmation: NEW_STRONG,
      }).expect(200);
    });

    it.each([
      [
        'tampered/nonexistent token',
        {
          token: 'deadbeef'.repeat(8),
          password: NEW_STRONG,
          passwordConfirmation: NEW_STRONG,
        },
      ],
      [
        'password mismatch',
        {
          token: 'x'.repeat(64),
          password: NEW_STRONG,
          passwordConfirmation: 'Different!2027',
        },
      ],
      [
        'weak password',
        {
          token: 'x'.repeat(64),
          password: 'weak',
          passwordConfirmation: 'weak',
        },
      ],
    ])('rejects %s → 400', async (_label, body) => {
      await reset(body).expect(400);
    });

    it('rejects a new password equal to the current one → 400', async () => {
      // adminA still has STRONG (never reset). Issue a token and try to set STRONG again.
      await prisma.passwordResetToken.deleteMany({
        where: { userId: ids.adminA },
      });
      await forgot('pr.admina@e2e.local').expect(200);
      const token = mail.tokenFor('pr.admina@e2e.local')!;
      await reset({
        token,
        password: STRONG,
        passwordConfirmation: STRONG,
      }).expect(400);
    });
  });

  // ---- session revocation --------------------------------------------------
  describe('session revocation after reset', () => {
    it('revokes ALL active sessions; old refresh cookie can no longer refresh', async () => {
      // two logins → two sessions (distinct device cookies)
      const l1 = await login('pr.agentb@e2e.local', 'FirstNew!2027').expect(
        201,
      );
      const cookies1 = (l1.headers['set-cookie'] as unknown as string[]) || [];

      await forgot('pr.agentb@e2e.local').expect(200);
      // backdate to bypass cooldown already-used? new forgot issues (prior consumed)
      const token = mail.tokenFor('pr.agentb@e2e.local')!;
      await reset({
        token,
        password: 'Third!Pass2027',
        passwordConfirmation: 'Third!Pass2027',
      }).expect(200);

      // the pre-reset refresh cookie must now fail to refresh (session revoked)
      const refreshRes = await request(server)
        .post('/api/auth/refresh')
        .set('Origin', ORIGIN)
        .set('Cookie', cookies1)
        .send();
      expect(refreshRes.status).toBe(401);

      const active = await prisma.userSession.count({
        where: { userId: ids.agentB, status: 'ACTIVE' },
      });
      expect(active).toBe(0);
    });
  });

  // ---- admin permissions & tenant isolation --------------------------------
  describe('admin-initiated recovery', () => {
    async function bearer(email: string, password: string): Promise<string> {
      const res = await login(email, password).expect(201);
      return res.body.token as string;
    }

    it('SUPER_ADMIN can send for any active user (no token in response)', async () => {
      const token = await bearer('pr.super@e2e.local', STRONG);
      await prisma.passwordResetToken.deleteMany({
        where: { userId: ids.adminA },
      }); // clear cooldown
      const before = mail.sent.length;
      const res = await request(server)
        .post(`/api/platform/users/${ids.adminA}/send-password-reset`)
        .set('Authorization', `Bearer ${token}`)
        .send()
        .expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(/token|reset-password\?/i);
      expect(mail.sent.length).toBe(before + 1);
    });

    it('ADMIN can send for an AGENT of the SAME company', async () => {
      const token = await bearer('pr.admina@e2e.local', STRONG);
      await prisma.passwordResetToken.deleteMany({
        where: { userId: ids.agentA },
      }); // clear cooldown
      const before = mail.sent.length;
      await request(server)
        .post(`/api/users/${ids.agentA}/send-password-reset`)
        .set('Authorization', `Bearer ${token}`)
        .send()
        .expect(200);
      expect(mail.sent.length).toBe(before + 1);
    });

    it('ADMIN CANNOT send for an AGENT of ANOTHER company → 404 (tenant isolation)', async () => {
      const token = await bearer('pr.admina@e2e.local', STRONG);
      await request(server)
        .post(`/api/users/${ids.agentB}/send-password-reset`)
        .set('Authorization', `Bearer ${token}`)
        .send()
        .expect(404);
    });

    it('ADMIN CANNOT send for another ADMIN → 403', async () => {
      const token = await bearer('pr.admina@e2e.local', STRONG);
      await request(server)
        .post(`/api/users/${ids.adminA2}/send-password-reset`)
        .set('Authorization', `Bearer ${token}`)
        .send()
        .expect(403);
    });

    it('AGENT cannot use the admin endpoint → 403', async () => {
      const token = await bearer('pr.agenta@e2e.local', NEW_STRONG); // agentA was reset earlier
      await request(server)
        .post(`/api/users/${ids.agentA}/send-password-reset`)
        .set('Authorization', `Bearer ${token}`)
        .send()
        .expect(403);
    });

    it('AGENT cannot use the platform endpoint → 403', async () => {
      const token = await bearer('pr.agenta@e2e.local', NEW_STRONG);
      await request(server)
        .post(`/api/platform/users/${ids.agentA}/send-password-reset`)
        .set('Authorization', `Bearer ${token}`)
        .send()
        .expect(403);
    });

    it('an unauthenticated admin request → 401', async () => {
      await request(server)
        .post(`/api/users/${ids.agentA}/send-password-reset`)
        .send()
        .expect(401);
    });
  });

  // ---- Origin / CSRF -------------------------------------------------------
  describe('Origin/CSRF', () => {
    it('rejects a foreign Origin on forgot-password → 403', async () => {
      await forgot('pr.admina@e2e.local', 'https://evil.example.com').expect(
        403,
      );
    });
    it('rejects a foreign Origin on reset-password → 403', async () => {
      await reset(
        {
          token: 'x'.repeat(64),
          password: NEW_STRONG,
          passwordConfirmation: NEW_STRONG,
        },
        'https://evil.example.com',
      ).expect(403);
    });
  });

  // ---- SMTP failure compensation ------------------------------------------
  describe('SMTP failure', () => {
    it('keeps a generic 200 but revokes the just-issued token (unusable)', async () => {
      await prisma.passwordResetToken.deleteMany({
        where: { userId: ids.adminA },
      });
      mail.failNext = true;
      const before = mail.sent.length;
      await forgot('pr.admina@e2e.local').expect(200);
      expect(mail.sent.length).toBe(before); // send failed → not captured
      // a token row was created then revoked → no ACTIVE token remains
      const usable = await prisma.passwordResetToken.count({
        where: {
          userId: ids.adminA,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      expect(usable).toBe(0);
    });
  });

  // ---- audit ---------------------------------------------------------------
  describe('audit', () => {
    it('records reset events without any token/password/url', async () => {
      const rows = await prisma.auditLog.findMany({
        where: { action: { startsWith: 'PASSWORD_RESET' } },
        select: { action: true, metadata: true, ipAddress: true },
        take: 50,
      });
      expect(rows.length).toBeGreaterThan(0);
      const dump = JSON.stringify(rows);
      expect(dump).not.toMatch(/token=|reset-password\?token|[a-f0-9]{64}/i);
    });
  });
});

function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}
