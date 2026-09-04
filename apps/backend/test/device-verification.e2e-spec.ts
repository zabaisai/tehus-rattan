// FASE 4.5 — verificación de dispositivo, de extremo a extremo por HTTP contra
// PostgreSQL real.
//
// Se levanta la aplicación COMPLETA (middlewares, guardas, ValidationPipe con
// lista blanca, filtro de excepciones, sesiones reales) con un único doble:
// `MailService`, que captura el código exactamente como lo leería una persona
// en su correo. El código NUNCA se lee de la base de datos: si la prueba
// pudiera sacarlo de ahí, dejaría de probar el camino real.
//
// El interruptor se mueve con `ConfigService.set`, no escribiendo en
// `process.env`: `ConfigModule` congela lo que encuentra al arrancar (incluido
// el `.env` de la máquina), así que una variable de entorno cambiada después
// no se vería. `set` escribe en la configuración interna, que es lo primero
// que `get` consulta, de modo que la suite manda sobre el entorno local sea
// cual sea.
process.env.THROTTLE_AUTH_LIMIT = '1000'; // aquí no se prueba el límite de peticiones

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MailService } from '../src/modules/mail/mail.service';
import type { SendDeviceVerificationInput } from '../src/modules/mail/mail.service';
import { AuthController } from '../src/modules/auth/auth.controller';
import { THROTTLE_LIMITS } from '../src/common/throttle/throttle.config';
import { REFRESH_TOKEN_COOKIE } from '../src/modules/sessions/sessions.constants';
import {
  AUDIT_CHALLENGE_CREATED,
  AUDIT_CHALLENGE_SUCCEEDED,
  AUDIT_TRUSTED_DEVICE_CREATED,
  CHALLENGE_GENERIC_ERROR,
  CHALLENGE_MAX_ATTEMPTS,
  TRUSTED_DEVICE_COOKIE_PLAIN_NAME,
} from '../src/modules/auth/device-verification/device-verification.constants';

/** Todo lo que crea esta suite lleva este prefijo y se borra por id exacto. */
const PREFIJO = 'E2E-DV45';
const SELLO = `${Date.now()}`;
const DOMINIO = 'dv45.test';
const ORIGEN = 'http://localhost:3000';
const ORIGEN_AJENO = 'https://evil.example.com';
const CLAVE = 'Dv45Fuerte!2026';
// Constante de prueba, no un secreto de producción: solo existe en este fichero.
const HMAC_PRUEBAS = 'e2e-dv45-hmac-solo-para-pruebas-0123456789';

const CLAVE_INTERRUPTOR = 'AUTH_DEVICE_VERIFICATION_ENABLED';
const CLAVE_SECRETO = 'AUTH_CHALLENGE_HMAC_SECRET';
const CLAVE_LISTA = 'AUTH_DEVICE_VERIFICATION_ALLOWLIST';

const correoDe = (etiqueta: string) =>
  `${PREFIJO.toLowerCase()}-${etiqueta}-${SELLO}@${DOMINIO}`;

/**
 * Doble del correo: guarda lo que se «envió» para que la prueba conozca el
 * código igual que lo conocería su destinatario. Nunca sale de aquí.
 */
class MailCapturador {
  enviados: SendDeviceVerificationInput[] = [];

  isEnabled() {
    return true;
  }

  async sendDeviceVerificationEmail(input: SendDeviceVerificationInput) {
    this.enviados.push(input);
  }

  async sendPasswordResetEmail() {
    /* no se usa en esta suite */
  }

  /** Último código enviado a esa dirección. */
  codigoPara(correo: string): string {
    const ultimo = [...this.enviados]
      .reverse()
      .find((m) => m.to.toLowerCase() === correo.toLowerCase());
    if (!ultimo) throw new Error('No se envió ningún código a esa cuenta');
    return ultimo.code;
  }
}

describe('Fase 4.5 — verificación de dispositivo (HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let config: ConfigService;
  let server: import('http').Server;
  let mail: MailCapturador;

  /** Cuentas de la suite, todas en la misma empresa temporal. */
  const cuentas: Record<'a' | 'b' | 'c' | 'd' | 'e' | 'f', string> = {
    a: correoDe('a'),
    b: correoDe('b'),
    c: correoDe('c'),
    d: correoDe('d'),
    e: correoDe('e'),
    f: correoDe('f'),
  };
  const ids: Record<string, string> = {};
  let inicioDeSuite: Date;

  // --- utilidades de petición ---------------------------------------------

  const acceder = (
    correo: string,
    clave = CLAVE,
    opciones: { origen?: string | null; cookies?: string[] } = {},
  ) => {
    const r = request(server).post('/api/auth/login');
    const origen = opciones.origen === undefined ? ORIGEN : opciones.origen;
    if (origen) r.set('Origin', origen);
    if (opciones.cookies?.length) r.set('Cookie', opciones.cookies);
    return r.send({ email: correo, password: clave });
  };

  const verificar = (cuerpo: object, origen: string | null = ORIGEN) => {
    const r = request(server).post('/api/auth/verify-device');
    if (origen) r.set('Origin', origen);
    return r.send(cuerpo);
  };

  const reenviar = (cuerpo: object) =>
    request(server)
      .post('/api/auth/verify-device/resend')
      .set('Origin', ORIGEN)
      .send(cuerpo);

  const cookiesDe = (res: request.Response): string[] =>
    (res.headers['set-cookie'] as unknown as string[]) ?? [];

  const cookieLlamada = (res: request.Response, nombre: string) =>
    cookiesDe(res).find((c) => c.startsWith(`${nombre}=`)) ?? null;

  // --- interruptor ---------------------------------------------------------

  /** Enciende la verificación; `allowlist` limita el despliegue si se pasa. */
  function encender(allowlist = '') {
    config.set(CLAVE_INTERRUPTOR, 'true');
    config.set(CLAVE_SECRETO, HMAC_PRUEBAS);
    config.set(CLAVE_LISTA, allowlist);
  }

  /**
   * Apaga el interruptor dejando el secreto puesto: así se comprueba que basta
   * el interruptor para volver al comportamiento anterior a la fase, sin que
   * la respuesta dependa de si la máquina tiene el secreto configurado.
   */
  function apagar() {
    config.set(CLAVE_INTERRUPTOR, 'false');
    config.set(CLAVE_SECRETO, HMAC_PRUEBAS);
    config.set(CLAVE_LISTA, '');
  }

  /** Repite hasta que la condición se cumple: hay escrituras no esperadas. */
  async function esperarA<T>(
    obtener: () => Promise<T | null | undefined | false>,
    intentos = 40,
  ): Promise<T> {
    for (let i = 0; i < intentos; i += 1) {
      const valor = await obtener();
      if (valor) return valor;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('La condición no se cumplió a tiempo');
  }

  /**
   * Recorrido completo hasta tener un reto vivo: acceso con la contraseña
   * correcta y el código que llegó «por correo».
   */
  async function pedirReto(
    correo: string,
  ): Promise<{ challengeId: string; codigo: string }> {
    const res = await acceder(correo).expect(201);
    expect(res.body.status).toBe('verification_required');
    return {
      challengeId: res.body.challengeId as string,
      codigo: mail.codigoPara(correo),
    };
  }

  const otroCodigo = (codigo: string) =>
    codigo === '000000' ? '111111' : '000000';

  // --- ciclo de vida -------------------------------------------------------

  beforeAll(async () => {
    mail = new MailCapturador();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue(mail)
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
    config = app.get(ConfigService);

    await limpiar();

    const hash = bcrypt.hashSync(CLAVE, 10);
    const empresa = await prisma.company.create({
      data: { name: `${PREFIJO} Empresa ${SELLO}`, status: 'ACTIVE' },
      select: { id: true },
    });

    for (const [clave, correo] of Object.entries(cuentas)) {
      const usuario = await prisma.user.create({
        data: {
          email: correo,
          password: hash,
          name: `${PREFIJO} ${clave.toUpperCase()}`,
          role: clave === 'a' ? 'ADMIN' : 'AGENT',
          companyId: empresa.id,
        },
        select: { id: true },
      });
      ids[clave] = usuario.id;
    }

    inicioDeSuite = new Date();
  });

  afterAll(async () => {
    delete process.env.THROTTLE_AUTH_LIMIT;
    await limpiar();
    await app.close();
    await prisma.$disconnect().catch(() => undefined);
  });

  /** Borra por id exacto, en orden de dependencias. Nunca por rangos. */
  async function limpiar() {
    const usuarios = await prisma.user.findMany({
      where: { email: { endsWith: `@${DOMINIO}` } },
      select: { id: true },
    });
    const userIds = usuarios.map((u) => u.id);
    if (userIds.length) {
      await prisma.deviceVerificationChallenge.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.trustedDevice.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.passwordResetToken.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.userSession.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.loginEvent.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.auditLog.deleteMany({
        where: { actorUserId: { in: userIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.loginEvent.deleteMany({
      where: { emailAttempted: { endsWith: `@${DOMINIO}` } },
    });
    await prisma.company.deleteMany({
      where: { name: { startsWith: `${PREFIJO} ` } },
    });
  }

  // -------------------------------------------------------------------------
  // El interruptor apagado es la garantía de «no cambió nada para nadie».
  // -------------------------------------------------------------------------
  describe('interruptor apagado — nada cambia para nadie', () => {
    beforeEach(() => apagar());

    it('el acceso devuelve sesión autenticada, con token y cookie de refresco', async () => {
      const res = await acceder(cuentas.a).expect(201);

      expect(res.body.status).toBe('authenticated');
      expect(typeof res.body.token).toBe('string');
      expect(res.body.user.id).toBe(ids.a);
      expect(cookieLlamada(res, REFRESH_TOKEN_COOKIE)).toBeTruthy();
      expect(res.body).not.toHaveProperty('challengeId');
    });

    it('no se crea ningún reto de verificación', async () => {
      await acceder(cuentas.a).expect(201);

      const retos = await prisma.deviceVerificationChallenge.count({
        where: { userId: ids.a },
      });
      expect(retos).toBe(0);
    });

    it('verify-device con el cuerpo vacío se rechaza por validación', async () => {
      await verificar({}).expect(400);
    });

    it('verify-device con un reto inexistente no autentica a nadie', async () => {
      const antes = await prisma.userSession.count({
        where: { userId: ids.a },
      });

      const res = await verificar({
        challengeId: 'reto-que-no-existe',
        code: '123456',
      });

      // 400 con el secreto configurado, 503 sin él: lo que importa es que
      // jamás devuelve una sesión.
      expect([400, 404, 503]).toContain(res.status);
      expect(res.body).not.toHaveProperty('token');
      const despues = await prisma.userSession.count({
        where: { userId: ids.a },
      });
      expect(despues).toBe(antes);
    });
  });

  // -------------------------------------------------------------------------
  describe('interruptor encendido — dispositivo nuevo', () => {
    beforeEach(() => encender());

    it('pide verificación: sin token, sin cookie de refresco y sin sesión abierta', async () => {
      const res = await acceder(cuentas.b).expect(201);

      expect(res.body.status).toBe('verification_required');
      expect(res.body).not.toHaveProperty('token');
      expect(res.body.attemptsRemaining).toBe(CHALLENGE_MAX_ATTEMPTS);
      expect(typeof res.body.challengeId).toBe('string');
      expect(cookieLlamada(res, REFRESH_TOKEN_COOKIE)).toBeNull();

      const sesiones = await prisma.userSession.count({
        where: { userId: ids.b },
      });
      expect(sesiones).toBe(0);
    });

    it('solo expone el correo enmascarado, nunca la dirección completa', async () => {
      const res = await acceder(cuentas.b).expect(201);

      const enmascarado = res.body.maskedEmail as string;
      const parteLocal = cuentas.b.split('@')[0];
      expect(enmascarado).toContain('***');
      expect(enmascarado).not.toContain(parteLocal);
      expect(enmascarado).not.toBe(cuentas.b);
      expect(JSON.stringify(res.body)).not.toContain(parteLocal);
    });

    it('el reto guarda una huella del código, nunca el código', async () => {
      const { challengeId, codigo } = await pedirReto(cuentas.b);

      const reto = await prisma.deviceVerificationChallenge.findUniqueOrThrow({
        where: { id: challengeId },
        select: { codeDigest: true, consumedAt: true, revokedAt: true },
      });
      expect(reto.codeDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(reto.codeDigest).not.toContain(codigo);
      expect(reto.consumedAt).toBeNull();
      expect(reto.revokedAt).toBeNull();
    });

    it('sin token, /auth/me responde 401', async () => {
      await acceder(cuentas.b).expect(201);
      await request(server).get('/api/auth/me').expect(401);
    });
  });

  // -------------------------------------------------------------------------
  describe('credenciales inválidas con el interruptor encendido', () => {
    beforeEach(() => encender());

    it('la contraseña incorrecta da 401 genérico, no crea reto y deja un LoginEvent FAILED', async () => {
      const retosAntes = await prisma.deviceVerificationChallenge.count({
        where: { userId: ids.c },
      });

      const res = await acceder(cuentas.c, 'ContraseñaEquivocada!9').expect(
        401,
      );
      expect(res.body.message).toBe('Credenciales inválidas');

      const retosDespues = await prisma.deviceVerificationChallenge.count({
        where: { userId: ids.c },
      });
      expect(retosDespues).toBe(retosAntes);

      // El evento se escribe fuera del camino del error, así que se espera.
      const evento = await esperarA(() =>
        prisma.loginEvent.findFirst({
          where: {
            userId: ids.c,
            status: 'FAILED',
            failureReason: 'INVALID_CREDENTIALS',
          },
          select: { id: true },
        }),
      );
      expect(evento).toBeTruthy();
    });

    it('un correo inexistente responde exactamente igual y tampoco crea reto', async () => {
      const desconocido = correoDe('fantasma');

      const malaClave = await acceder(cuentas.c, 'OtraEquivocada!9').expect(
        401,
      );
      const inexistente = await acceder(desconocido).expect(401);

      // Byte a byte: nada en la respuesta permite enumerar cuentas.
      expect(JSON.stringify(inexistente.body)).toBe(
        JSON.stringify(malaClave.body),
      );

      const retos = await prisma.deviceVerificationChallenge.count({
        where: { user: { email: desconocido } },
      });
      expect(retos).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('verificación del código', () => {
    beforeEach(() => encender());

    it('el código correcto abre la sesión y su token sirve en /auth/me', async () => {
      const { challengeId, codigo } = await pedirReto(cuentas.d);

      const res = await verificar({ challengeId, code: codigo }).expect(201);
      expect(res.body.status).toBe('authenticated');
      expect(res.body.user.id).toBe(ids.d);
      expect(cookieLlamada(res, REFRESH_TOKEN_COOKIE)).toBeTruthy();

      const sesiones = await prisma.userSession.count({
        where: { userId: ids.d, status: 'ACTIVE' },
      });
      expect(sesiones).toBe(1);

      const reto = await prisma.deviceVerificationChallenge.findUniqueOrThrow({
        where: { id: challengeId },
        select: { consumedAt: true },
      });
      expect(reto.consumedAt).not.toBeNull();

      const me = await request(server)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${res.body.token}`)
        .expect(200);
      expect(me.body.id).toBe(ids.d);
    });

    it('un código incorrecto responde 400 genérico, gasta un intento y no abre sesión', async () => {
      const { challengeId, codigo } = await pedirReto(cuentas.e);
      const sesionesAntes = await prisma.userSession.count({
        where: { userId: ids.e },
      });

      const res = await verificar({
        challengeId,
        code: otroCodigo(codigo),
      }).expect(400);
      expect(res.body.message).toBe(CHALLENGE_GENERIC_ERROR);

      const reto = await prisma.deviceVerificationChallenge.findUniqueOrThrow({
        where: { id: challengeId },
        select: { attempts: true, consumedAt: true },
      });
      expect(reto.attempts).toBe(1);
      expect(reto.consumedAt).toBeNull();

      const sesionesDespues = await prisma.userSession.count({
        where: { userId: ids.e },
      });
      expect(sesionesDespues).toBe(sesionesAntes);
    });

    it('un código ya usado no vuelve a servir', async () => {
      const { challengeId, codigo } = await pedirReto(cuentas.e);

      await verificar({ challengeId, code: codigo }).expect(201);
      const segunda = await verificar({ challengeId, code: codigo }).expect(
        400,
      );
      expect(segunda.body.message).toBe(CHALLENGE_GENERIC_ERROR);
    });

    it('un código vencido no sirve', async () => {
      const { challengeId, codigo } = await pedirReto(cuentas.e);
      await prisma.deviceVerificationChallenge.update({
        where: { id: challengeId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await verificar({ challengeId, code: codigo }).expect(400);
      expect(res.body.message).toBe(CHALLENGE_GENERIC_ERROR);
    });

    it('agotados los cinco intentos, ni el código correcto abre sesión', async () => {
      const { challengeId, codigo } = await pedirReto(cuentas.f);
      const sesionesAntes = await prisma.userSession.count({
        where: { userId: ids.f },
      });

      for (let i = 0; i < CHALLENGE_MAX_ATTEMPTS; i += 1) {
        await verificar({ challengeId, code: otroCodigo(codigo) }).expect(400);
      }

      const res = await verificar({ challengeId, code: codigo }).expect(400);
      expect(res.body.message).toBe(CHALLENGE_GENERIC_ERROR);

      const reto = await prisma.deviceVerificationChallenge.findUniqueOrThrow({
        where: { id: challengeId },
        select: { attempts: true, consumedAt: true },
      });
      expect(reto.attempts).toBe(CHALLENGE_MAX_ATTEMPTS);
      expect(reto.consumedAt).toBeNull();

      const sesionesDespues = await prisma.userSession.count({
        where: { userId: ids.f },
      });
      expect(sesionesDespues).toBe(sesionesAntes);
    });
  });

  // -------------------------------------------------------------------------
  describe('reenvío del código', () => {
    beforeEach(() => encender());

    it('reenviar antes de tiempo responde 400 pidiendo esperar', async () => {
      const { challengeId } = await pedirReto(cuentas.e);

      const res = await reenviar({ challengeId }).expect(400);
      expect(res.body.message).toMatch(/Espera \d+ segundos/);
    });

    it('pasada la espera emite un reto nuevo: el anterior queda revocado y su código ya no sirve', async () => {
      const primero = await pedirReto(cuentas.e);
      await prisma.deviceVerificationChallenge.update({
        where: { id: primero.challengeId },
        data: { resendAvailableAt: new Date(Date.now() - 1000) },
      });

      // El reenvío tiene @HttpCode(200): es la continuación de un reto vivo.
      const res = await reenviar({ challengeId: primero.challengeId }).expect(
        200,
      );
      expect(res.body.status).toBe('verification_required');
      const nuevoId = res.body.challengeId as string;
      expect(nuevoId).not.toBe(primero.challengeId);

      const anterior =
        await prisma.deviceVerificationChallenge.findUniqueOrThrow({
          where: { id: primero.challengeId },
          select: { revokedAt: true },
        });
      expect(anterior.revokedAt).not.toBeNull();

      // El código viejo muere con su reto, incluso presentándolo en el nuevo.
      await verificar({
        challengeId: primero.challengeId,
        code: primero.codigo,
      }).expect(400);
      await verificar({ challengeId: nuevoId, code: primero.codigo }).expect(
        400,
      );

      const nuevoCodigo = mail.codigoPara(cuentas.e);
      const ok = await verificar({
        challengeId: nuevoId,
        code: nuevoCodigo,
      }).expect(201);
      expect(ok.body.status).toBe('authenticated');
    });
  });

  // -------------------------------------------------------------------------
  // La lista blanca del ValidationPipe es parte de la seguridad del endpoint:
  // el reto identifica a la persona, así que el cuerpo no puede hacerlo.
  // -------------------------------------------------------------------------
  describe('rigor del DTO de verify-device', () => {
    beforeEach(() => encender());

    it.each([['userId'], ['companyId'], ['role']])(
      'una clave desconocida (%s) se rechaza con 400 y no abre sesión',
      async (clave) => {
        const { challengeId, codigo } = await pedirReto(cuentas.d);
        const sesionesAntes = await prisma.userSession.count({
          where: { userId: ids.d },
        });

        await verificar({
          challengeId,
          code: codigo,
          [clave]: ids.a,
        }).expect(400);

        const sesionesDespues = await prisma.userSession.count({
          where: { userId: ids.d },
        });
        expect(sesionesDespues).toBe(sesionesAntes);
      },
    );

    it.each([
      ['con letras', 'abc123'],
      ['demasiado corto', '12345'],
      ['demasiado largo', '1234567'],
      ['vacío', ''],
    ])('un código %s se rechaza con 400', async (_etiqueta, code) => {
      const { challengeId } = await pedirReto(cuentas.d);
      await verificar({ challengeId, code }).expect(400);
    });

    it('sin challengeId se rechaza con 400', async () => {
      await verificar({ code: '123456' }).expect(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('auditoría', () => {
    beforeEach(() => encender());

    it('registra reto y dispositivo sin código, huella, token ni correo completo', async () => {
      const { challengeId, codigo } = await pedirReto(cuentas.d);
      const res = await verificar({
        challengeId,
        code: codigo,
        trustDevice: true,
      }).expect(201);
      const cookie = cookieLlamada(res, TRUSTED_DEVICE_COOKIE_PLAIN_NAME);
      expect(cookie).toBeTruthy();
      const tokenDeDispositivo = cookie!.split(';')[0].split('=')[1];

      const filas = await prisma.auditLog.findMany({
        where: {
          actorUserId: ids.d,
          action: {
            in: [
              AUDIT_CHALLENGE_CREATED,
              AUDIT_CHALLENGE_SUCCEEDED,
              AUDIT_TRUSTED_DEVICE_CREATED,
            ],
          },
        },
        select: { action: true, metadata: true, ipAddress: true },
      });
      const acciones = filas.map((f) => f.action);
      expect(acciones).toContain(AUDIT_CHALLENGE_CREATED);
      expect(acciones).toContain(AUDIT_CHALLENGE_SUCCEEDED);
      expect(acciones).toContain(AUDIT_TRUSTED_DEVICE_CREATED);

      const huella = await prisma.deviceVerificationChallenge.findUniqueOrThrow(
        {
          where: { id: challengeId },
          select: { codeDigest: true },
        },
      );

      const volcado = JSON.stringify(filas);
      expect(volcado).not.toContain(codigo);
      expect(volcado).not.toContain(huella.codeDigest);
      expect(volcado).not.toContain(tokenDeDispositivo);
      expect(volcado).not.toContain(cuentas.d);
      expect(volcado).not.toContain(cuentas.d.split('@')[0]);
    });
  });

  // -------------------------------------------------------------------------
  describe('despliegue controlado por allowlist', () => {
    it('solo la cuenta de la lista necesita verificar; el resto entra como siempre', async () => {
      encender(cuentas.a);

      const dentro = await acceder(cuentas.a).expect(201);
      expect(dentro.body.status).toBe('verification_required');

      const fuera = await acceder(cuentas.c).expect(201);
      expect(fuera.body.status).toBe('authenticated');
      expect(typeof fuera.body.token).toBe('string');
      expect(cookieLlamada(fuera, REFRESH_TOKEN_COOKIE)).toBeTruthy();

      const retosDeC = await prisma.deviceVerificationChallenge.count({
        where: { userId: ids.c },
      });
      expect(retosDeC).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('guarda de origen', () => {
    beforeEach(() => encender());

    it('un Origin ajeno en /auth/login responde 403', async () => {
      await acceder(cuentas.a, CLAVE, { origen: ORIGEN_AJENO }).expect(403);
    });

    it('un Origin ajeno en /auth/verify-device responde 403', async () => {
      await verificar(
        { challengeId: 'da-igual', code: '123456' },
        ORIGEN_AJENO,
      ).expect(403);
    });
  });

  // -------------------------------------------------------------------------
  // El límite de peticiones es global (AppThrottlerGuard como APP_GUARD) y ya
  // tiene su propia suite; aquí solo se fija el contrato: probar códigos no
  // puede salir más barato que probar contraseñas. Se comprueba sobre los
  // metadatos del decorador, no midiendo peticiones.
  // -------------------------------------------------------------------------
  describe('límite de peticiones', () => {
    // Claves que @Throttle escribe en el manejador, para el bucket 'default'.
    const LIMITE = 'THROTTLER:LIMITdefault';
    const VENTANA = 'THROTTLER:TTLdefault';
    const proto = AuthController.prototype;

    it.each([
      ['verify-device', proto.verifyDevice],
      ['verify-device/resend', proto.resendDeviceVerification],
    ])('%s comparte el límite estricto del acceso', (_nombre, manejador) => {
      expect(Reflect.getMetadata(LIMITE, manejador)).toBe(THROTTLE_LIMITS.auth);
      expect(Reflect.getMetadata(VENTANA, manejador)).toBe(
        Reflect.getMetadata(VENTANA, proto.login),
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('higiene de datos', () => {
    it('no deja filas de verificación fuera de las cuentas de la suite', async () => {
      const propios = Object.values(ids);

      // Cuentas que no son de pruebas: ninguna suite puede escribir retos ni
      // dispositivos sobre una cuenta real. Se excluyen los dominios de
      // fixtures (`.test`, `.local`, o correos con «e2e») para que otra suite
      // corriendo en paralelo sobre la misma base no vuelva esto inestable.
      const ajenas = {
        createdAt: { gte: inicioDeSuite },
        userId: { notIn: propios },
        user: {
          AND: [
            { email: { not: { endsWith: '.test' } } },
            { email: { not: { endsWith: '.local' } } },
            { email: { not: { contains: 'e2e' } } },
          ],
        },
      };

      const retosAjenos = await prisma.deviceVerificationChallenge.count({
        where: ajenas,
      });
      const dispositivosAjenos = await prisma.trustedDevice.count({
        where: ajenas,
      });

      expect(retosAjenos).toBe(0);
      expect(dispositivosAjenos).toBe(0);
    });
  });
});
