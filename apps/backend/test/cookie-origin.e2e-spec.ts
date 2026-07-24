import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { CookieOriginGuard } from '../src/common/guards/cookie-origin.guard';

const ALLOWED_ORIGIN = 'https://crm-staging.tehusrattan.com';

// AuthService is fully mocked — this only proves the CookieOriginGuard is wired
// on the cookie-based auth POSTs and that it allows the configured origin,
// rejects a foreign one, and allows a missing Origin (non-browser clients).
const authServiceMock = {
  login: jest.fn().mockResolvedValue({
    refreshToken: 'opaque-refresh',
    token: 'access-jwt',
    user: { id: 'u1', email: 'a@co.test', name: 'A' },
  }),
  logout: jest.fn().mockResolvedValue(undefined),
};

describe('CookieOriginGuard on auth endpoints (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        CookieOriginGuard,
        { provide: AuthService, useValue: authServiceMock },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              ({ FRONTEND_URL: ALLOWED_ORIGIN, NODE_ENV: 'production' } as Record<string, string>)[key],
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  afterAll(async () => await app.close());
  beforeEach(() => jest.clearAllMocks());

  const creds = { email: 'a@co.test', password: 'secret123' };

  it('allows POST /api/auth/login from the configured Origin', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Origin', ALLOWED_ORIGIN)
      .send(creds)
      .expect(201);
    expect(authServiceMock.login).toHaveBeenCalled();
  });

  it('rejects POST /api/auth/login from a foreign Origin with 403 and never calls the service', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example.com')
      .send(creds)
      .expect(403);
    expect(authServiceMock.login).not.toHaveBeenCalled();
  });

  it('allows a request with no Origin header (curl / server-to-server)', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send(creds)
      .expect(201);
    expect(authServiceMock.login).toHaveBeenCalled();
  });

  it('rejects POST /api/auth/logout from a foreign Origin', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Origin', 'https://evil.example.com')
      .expect(403);
    expect(authServiceMock.logout).not.toHaveBeenCalled();
  });
});
