import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule, AuthGuard } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtStrategy } from '../src/modules/auth/jwt.strategy';

// Test-only secret, never read from .env and never logged.
const TEST_JWT_SECRET = 'e2e-test-only-secret-do-not-use-in-prod';
const WRONG_JWT_SECRET = 'e2e-test-only-wrong-secret';

// JwtStrategy only reads the payload fields below; it does not query
// PrismaService, so no Prisma mock is required for this guard.
@Controller('protected')
class ProtectedTestController {
  @UseGuards(AuthGuard('jwt'))
  @Get()
  getProtected() {
    return { ok: true };
  }
}

describe('AuthGuard (jwt) e2e', () => {
  let app: INestApplication<App>;
  let validJwtService: JwtService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [ProtectedTestController],
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
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    validJwtService = new JwtService({ secret: TEST_JWT_SECRET });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /protected without Authorization header returns 401', async () => {
    await request(app.getHttpServer()).get('/protected').expect(401);
  });

  it('GET /protected with a badly signed token returns 401', async () => {
    const wrongSecretJwtService = new JwtService({ secret: WRONG_JWT_SECRET });
    const badlySignedToken = wrongSecretJwtService.sign({
      sub: 'user-1',
      email: 'user@example.com',
      role: 'AGENT',
      companyId: 'company-a',
    });

    await request(app.getHttpServer())
      .get('/protected')
      .set('Authorization', `Bearer ${badlySignedToken}`)
      .expect(401);
  });

  it('GET /protected with an expired token returns 401', async () => {
    const expiredToken = validJwtService.sign({
      sub: 'user-1',
      email: 'user@example.com',
      role: 'AGENT',
      companyId: 'company-a',
      exp: Math.floor(Date.now() / 1000) - 60,
    });

    await request(app.getHttpServer())
      .get('/protected')
      .set('Authorization', `Bearer ${expiredToken}`)
      .expect(401);
  });

  it('GET /protected with a valid token returns 200 and { ok: true }', async () => {
    const validToken = validJwtService.sign(
      {
        sub: 'user-1',
        email: 'user@example.com',
        role: 'AGENT',
        companyId: 'company-a',
      },
      { expiresIn: '5m' },
    );

    await request(app.getHttpServer())
      .get('/protected')
      .set('Authorization', `Bearer ${validToken}`)
      .expect(200)
      .expect({ ok: true });
  });
});
