import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtStrategy } from '../src/modules/auth/jwt.strategy';
import { PrismaService } from '../src/prisma/prisma.service';
import { SearchController } from '../src/modules/search/search.controller';
import { SearchService } from '../src/modules/search/search.service';
import { buildFakeSessionPrisma, encodeSid } from './helpers/fake-session-prisma';

const TEST_JWT_SECRET = 'e2e-test-only-secret-do-not-use-in-prod';

// Ejercita la tubería HTTP completa —token, guardas y validación— con el
// servicio simulado. Lo que se prueba aquí es el CONTRATO: quién entra, qué
// entradas se rechazan y que el `companyId` no se pueda inyectar.
const searchServiceMock = { buscar: jest.fn() };

describe('GET /api/search (e2e)', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;

  const token = (role: string, companyId: string | null) =>
    jwt.sign(
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
      controllers: [SearchController],
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              if (key === 'JWT_SECRET') return TEST_JWT_SECRET;
              throw new Error(`Unexpected config key requested: ${key}`);
            },
            get: () => undefined,
          },
        },
        { provide: PrismaService, useValue: buildFakeSessionPrisma() },
        { provide: SearchService, useValue: searchServiceMock },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    jwt = new JwtService({ secret: TEST_JWT_SECRET });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    searchServiceMock.buscar.mockResolvedValue({ consulta: 'x', total: 0, grupos: [] });
  });

  describe('quién puede buscar', () => {
    it('sin token: 401', async () => {
      await request(app.getHttpServer()).get('/api/search?q=laura').expect(401);
    });

    it.each(['ADMIN', 'MANAGER', 'AGENT'])(
      'un %s de la empresa puede buscar',
      async (role) => {
        await request(app.getHttpServer())
          .get('/api/search?q=laura')
          .set('Authorization', `Bearer ${token(role, 'empresa-1')}`)
          .expect(200);
      },
    );

    it('un SUPER_ADMIN de plataforma SIN empresa queda fuera: no hay «buscar en todas»', async () => {
      await request(app.getHttpServer())
        .get('/api/search?q=laura')
        .set('Authorization', `Bearer ${token('SUPER_ADMIN', null)}`)
        .expect(403);

      expect(searchServiceMock.buscar).not.toHaveBeenCalled();
    });
  });

  describe('la empresa sale del token, nunca del cliente', () => {
    it('busca con el companyId del token', async () => {
      await request(app.getHttpServer())
        .get('/api/search?q=laura')
        .set('Authorization', `Bearer ${token('ADMIN', 'empresa-1')}`)
        .expect(200);

      expect(searchServiceMock.buscar).toHaveBeenCalledWith(
        'empresa-1',
        expect.objectContaining({ q: 'laura' }),
      );
    });

    it('mandar companyId por query es rechazado, no ignorado en silencio', async () => {
      // `forbidNonWhitelisted` convierte el intento en un 400. Ignorarlo sin
      // más dejaría creer que el parámetro hace algo.
      await request(app.getHttpServer())
        .get('/api/search?q=laura&companyId=empresa-2')
        .set('Authorization', `Bearer ${token('ADMIN', 'empresa-1')}`)
        .expect(400);

      expect(searchServiceMock.buscar).not.toHaveBeenCalled();
    });
  });

  describe('contrato de entrada', () => {
    it('sin q: 400', async () => {
      await request(app.getHttpServer())
        .get('/api/search')
        .set('Authorization', `Bearer ${token('ADMIN', 'empresa-1')}`)
        .expect(400);
    });

    it('q de un solo carácter: 400', async () => {
      await request(app.getHttpServer())
        .get('/api/search?q=a')
        .set('Authorization', `Bearer ${token('ADMIN', 'empresa-1')}`)
        .expect(400);
    });

    it('un tipo inventado: 400', async () => {
      await request(app.getHttpServer())
        .get('/api/search?q=laura&tipos=facturas')
        .set('Authorization', `Bearer ${token('ADMIN', 'empresa-1')}`)
        .expect(400);
    });

    it('límite por encima del máximo: 400', async () => {
      await request(app.getHttpServer())
        .get('/api/search?q=laura&limite=500')
        .set('Authorization', `Bearer ${token('ADMIN', 'empresa-1')}`)
        .expect(400);
    });

    it('acepta tipos separados por coma', async () => {
      await request(app.getHttpServer())
        .get('/api/search?q=laura&tipos=contactos,productos')
        .set('Authorization', `Bearer ${token('ADMIN', 'empresa-1')}`)
        .expect(200);

      expect(searchServiceMock.buscar).toHaveBeenCalledWith(
        'empresa-1',
        expect.objectContaining({ tipos: ['contactos', 'productos'] }),
      );
    });

    it('incluirPapelera llega como booleano, no como la cadena "true"', async () => {
      await request(app.getHttpServer())
        .get('/api/search?q=laura&incluirPapelera=true')
        .set('Authorization', `Bearer ${token('ADMIN', 'empresa-1')}`)
        .expect(200);

      expect(searchServiceMock.buscar).toHaveBeenCalledWith(
        'empresa-1',
        expect.objectContaining({ incluirPapelera: true }),
      );
    });
  });
});
