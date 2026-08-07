import { INestApplication, ValidationPipe } from '@nestjs/common';
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
import { ContactsEliminacionService } from '../src/modules/contacts/contacts-eliminacion.service';
import { PerfilComercialService } from '../src/modules/contacts/perfil-comercial.service';
import { PlatformAuditLogService } from '../src/modules/platform/platform-audit-log.service';
import { PlatformCompaniesController } from '../src/modules/platform/platform-companies.controller';
import { PlatformCompaniesService } from '../src/modules/platform/platform-companies.service';
import { WebhookController } from '../src/modules/webhook/webhook.controller';
import { WebhookService } from '../src/modules/webhook/webhook.service';
import {
  buildFakeSessionPrisma,
  encodeSid,
} from './helpers/fake-session-prisma';

// Test-only secret, never read from .env and never logged.
const TEST_JWT_SECRET = 'e2e-test-only-secret-do-not-use-in-prod';

// Exercises BusinessTenantGuard against a representative business
// controller (contacts) side by side with a platform controller
// (platform/companies), to prove the guard blocks a global SUPER_ADMIN
// from the former while never affecting the latter. Both services are
// mocked — no Prisma, no real database.
const contactsServiceMock = {
  findAll: jest.fn(),
};

const companiesServiceMock = {
  listCompanies: jest.fn(),
};

const webhookServiceMock = {
  processWebhook: jest.fn(),
};

describe('BusinessTenantGuard (e2e)', () => {
  let app: INestApplication<App>;
  let jwtService: JwtService;

  const signToken = (role: string, companyId: string | null) =>
    jwtService.sign(
      {
        sub: 'user-1',
        email: 'user@example.com',
        role,
        companyId,
        sid: encodeSid('user-1', companyId),
      },
      { expiresIn: '5m' },
    );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [
        ContactsController,
        PlatformCompaniesController,
        WebhookController,
      ],
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              if (key === 'JWT_SECRET') return TEST_JWT_SECRET;
              throw new Error(`Unexpected config key requested: ${key}`);
            },
            // WhatsAppSignatureGuard (on POST /api/webhook) reads this.
            get: (key: string) =>
              key === 'WHATSAPP_APP_SECRET'
                ? 'e2e-test-only-app-secret'
                : undefined,
          },
        },
        { provide: PrismaService, useValue: buildFakeSessionPrisma() },
        { provide: ContactsService, useValue: contactsServiceMock },
        // La eliminacion definitiva vive en su propio servicio. Aqui no se
        // ejercita: se registra para que el controlador se pueda construir.
        { provide: ContactsEliminacionService, useValue: {} },
        { provide: PerfilComercialService, useValue: {} },
        // `ContactsController` registra el archivado de contactos. Aquí no se
        // ejercita esa ruta, pero sin el proveedor Nest no puede construir el
        // controlador y caen todas las pruebas de guardas.
        { provide: PlatformAuditLogService, useValue: { record: jest.fn() } },
        { provide: PlatformCompaniesService, useValue: companiesServiceMock },
        { provide: WebhookService, useValue: webhookServiceMock },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
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

  describe('GET /api/contacts (business endpoint)', () => {
    it('rejects a global SUPER_ADMIN (companyId null) with 403, not 500', async () => {
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

    it('allows an ADMIN with a companyId', async () => {
      contactsServiceMock.findAll.mockResolvedValue([]);
      const token = signToken('ADMIN', 'company-a');

      await request(app.getHttpServer())
        .get('/api/contacts')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(contactsServiceMock.findAll).toHaveBeenCalledWith(
        'company-a',
        expect.any(Object),
      );
    });

    it('allows an AGENT with a companyId', async () => {
      contactsServiceMock.findAll.mockResolvedValue([]);
      const token = signToken('AGENT', 'company-a');

      await request(app.getHttpServer())
        .get('/api/contacts')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(contactsServiceMock.findAll).toHaveBeenCalled();
    });

    it('rejects a request without a token with 401 (unrelated to this guard)', async () => {
      await request(app.getHttpServer()).get('/api/contacts').expect(401);

      expect(contactsServiceMock.findAll).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/platform/companies (platform endpoint, unaffected)', () => {
    it('still works for a global SUPER_ADMIN', async () => {
      companiesServiceMock.listCompanies.mockResolvedValue([]);
      const token = signToken('SUPER_ADMIN', null);

      await request(app.getHttpServer())
        .get('/api/platform/companies')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(companiesServiceMock.listCompanies).toHaveBeenCalled();
    });
  });

  describe('POST /api/webhook (no JWT — gated by signature, not by tenant/auth guards)', () => {
    it('is not rejected by BusinessTenantGuard/AuthGuard, but the signature guard blocks an unsigned request (401, not 403/tenant)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/webhook')
        .send({ entry: [] })
        .expect(401);

      // 401 from the WhatsApp signature guard — NOT the tenant guard's 403
      // message, proving the block is signature-based, not JWT/tenant-based.
      expect(res.body.message).not.toBe(
        'Este endpoint requiere un usuario asociado a una empresa',
      );
      expect(webhookServiceMock.processWebhook).not.toHaveBeenCalled();
    });
  });
});
