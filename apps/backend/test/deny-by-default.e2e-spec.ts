import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// Stub: este test comprueba el ROUTING de guards, no la base. Una ruta privada
// se rechaza en el guard global ANTES de llegar al controlador, así que Prisma
// no hace falta.
const prismaServiceStub = {
  $connect: jest.fn(),
  $disconnect: jest.fn(),
};

/**
 * Deny-by-default: con el guard global de autenticación, TODA ruta HTTP exige
 * JWT salvo las marcadas @Public(). Este test arranca el AppModule REAL (con sus
 * APP_GUARD) y comprueba las dos caras: una ruta pública responde, una ruta
 * privada se rechaza con 401 sin token.
 */
describe('Deny-by-default (guard global de auth, e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaServiceStub)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('ruta pública (liveness) responde sin token', () => {
    // health/live no depende de la base (Prisma está stubbeado), así que un 200
    // demuestra que la ruta es pública y no la corta el guard global.
    return request(app.getHttpServer()).get('/api/health/live').expect(200);
  });

  it('raíz pública responde sin token', () => {
    return request(app.getHttpServer()).get('/api/').expect(200);
  });

  it('ruta privada (contacts) se rechaza con 401 sin token', () => {
    return request(app.getHttpServer()).get('/api/contacts').expect(401);
  });

  it('otra ruta privada (users) se rechaza con 401 sin token', () => {
    return request(app.getHttpServer()).get('/api/users').expect(401);
  });

  it('ruta privada de plataforma se rechaza con 401 sin token', () => {
    return request(app.getHttpServer())
      .get('/api/platform/companies')
      .expect(401);
  });
});
