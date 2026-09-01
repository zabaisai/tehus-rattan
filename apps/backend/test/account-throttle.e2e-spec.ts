// Límite por cuenta ACTIVO de verdad (sin bypass por NODE_ENV): la e2e deja el
// AccountThrottleGuard vivo dentro del AppModule real y comprueba que un mismo
// email —normalizado— acumula intentos y acaba en 429 con mensaje genérico.
//
// El límite se baja a 3 por env para no depender de tiempos. El guard cuenta
// ANTES de validar credenciales, así que emails inexistentes sirven igual (no
// hace falta sembrar usuarios).
process.env.THROTTLE_ACCOUNT_LIMIT = '3';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('AccountThrottleGuard ACTIVO en el AppModule real (e2e)', () => {
  let app: INestApplication;
  const ORIGIN = 'http://localhost:3000';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
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
  });

  afterAll(async () => {
    await app.close();
  });

  const login = (email: string, password = 'lo-que-sea') =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .send({ email, password });

  it('acumula por cuenta NORMALIZADA y al superar el límite responde 429 genérico', async () => {
    const email = 'acct-throttle-a@qa.invalid';
    // 3 intentos (variando mayúsculas/espacios: MISMA cuenta normalizada).
    await login(email); // 1
    await login(`  ${email.toUpperCase()}  `); // 2 (misma cuenta)
    await login(email); // 3
    // El 4º supera el límite por cuenta → 429 ANTES que el límite por IP (10).
    const cuarto = await login(email);
    expect(cuarto.status).toBe(429);
    // Mensaje genérico: no revela la cuenta.
    const msg = JSON.stringify(cuarto.body);
    expect(msg).not.toContain(email);
    expect(msg).toMatch(/Demasiados intentos/i);
  });

  it('otra cuenta distinta no se ve afectada por el bloqueo de la primera', async () => {
    // Cuenta nueva: su primer intento NO es 429 (bucket independiente).
    const otra = await login('acct-throttle-b@qa.invalid');
    expect(otra.status).not.toBe(429);
  });
});
