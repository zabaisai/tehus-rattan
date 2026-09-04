// FASE 4.5 — dispositivos confiables, de extremo a extremo por HTTP contra
// PostgreSQL real.
//
// La otra mitad de `device-verification.e2e-spec.ts`: qué pasa cuando alguien
// marca «recordar este dispositivo». Un dispositivo confiable solo evita el
// segundo factor; nunca sustituye a la contraseña y muere en cuanto la cuenta
// pierde sus sesiones. Aquí se comprueban las dos cosas.
//
// Igual que en la otra suite: aplicación completa, `MailService` doblado para
// capturar el código (y el enlace de restablecimiento), y el interruptor movido
// con `ConfigService.set`, que manda sobre el `.env` de la máquina.
process.env.THROTTLE_AUTH_LIMIT = '1000'; // aquí no se prueba el límite de peticiones
process.env.THROTTLE_PASSWORD_RESET_LIMIT = '1000';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  MailService,
  type SendDeviceVerificationInput,
  type SendPasswordResetInput,
} from '../src/modules/mail/mail.service';
import { SessionsService } from '../src/modules/sessions/sessions.service';
import { UsersService } from '../src/modules/users/users.service';
import { REFRESH_TOKEN_COOKIE } from '../src/modules/sessions/sessions.constants';
import {
  TRUSTED_DEVICE_COOKIE_PLAIN_NAME,
  TRUSTED_DEVICE_COOKIE_PLAIN_PATH,
  TRUSTED_DEVICE_COOKIE_SECURE_NAME,
} from '../src/modules/auth/device-verification/device-verification.constants';

const PREFIJO = 'E2E-DV45';
const SELLO = `${Date.now()}`;
// Dominio propio de esta suite: ninguna otra prueba borra por este sufijo.
const DOMINIO = 'dv45dev.test';
const ORIGEN = 'http://localhost:3000';
const CLAVE = 'Dv45Fuerte!2026';
const CLAVE_NUEVA = 'Dv45Renovada!2027';
const HMAC_PRUEBAS = 'e2e-dv45-hmac-solo-para-pruebas-0123456789';

const correoDe = (etiqueta: string) =>
  `${PREFIJO.toLowerCase()}-${etiqueta}-${SELLO}@${DOMINIO}`;

class MailCapturador {
  codigos: SendDeviceVerificationInput[] = [];
  restablecimientos: SendPasswordResetInput[] = [];

  isEnabled() {
    return true;
  }

  async sendDeviceVerificationEmail(input: SendDeviceVerificationInput) {
    this.codigos.push(input);
  }

  async sendPasswordResetEmail(input: SendPasswordResetInput) {
    this.restablecimientos.push(input);
  }

  codigoPara(correo: string): string {
    const ultimo = [...this.codigos]
      .reverse()
      .find((m) => m.to.toLowerCase() === correo.toLowerCase());
    if (!ultimo) throw new Error('No se envió ningún código a esa cuenta');
    return ultimo.code;
  }

  tokenDeRestablecimientoPara(correo: string): string {
    const ultimo = [...this.restablecimientos]
      .reverse()
      .find((m) => m.to.toLowerCase() === correo.toLowerCase());
    const encontrado = ultimo?.resetUrl.match(/token=([^&]+)/);
    if (!encontrado) throw new Error('No se envió ningún enlace a esa cuenta');
    return decodeURIComponent(encontrado[1]);
  }
}

describe('Fase 4.5 — dispositivos confiables (HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;
  let mail: MailCapturador;
  let config: ConfigService;
  let sesiones: SessionsService;
  let usuarios: UsersService;

  const cuentas = {
    a: correoDe('a'),
    b: correoDe('b'),
    revocar: correoDe('revocar'),
    sesiones: correoDe('sesiones'),
    clave: correoDe('clave'),
    baja: correoDe('baja'),
    vencido: correoDe('vencido'),
  };
  const ids: Record<string, string> = {};
  let empresaId = '';
  let inicioDeSuite: Date;

  // --- utilidades de petición ---------------------------------------------

  const acceder = (
    correo: string,
    opciones: { clave?: string; cookies?: string[] } = {},
  ) => {
    const r = request(server).post('/api/auth/login').set('Origin', ORIGEN);
    if (opciones.cookies?.length) r.set('Cookie', opciones.cookies);
    return r.send({ email: correo, password: opciones.clave ?? CLAVE });
  };

  const verificar = (cuerpo: object) =>
    request(server)
      .post('/api/auth/verify-device')
      .set('Origin', ORIGEN)
      .send(cuerpo);

  const cookiesDe = (res: request.Response): string[] =>
    (res.headers['set-cookie'] as unknown as string[]) ?? [];

  const cookieLlamada = (res: request.Response, nombre: string) =>
    cookiesDe(res).find((c) => c.startsWith(`${nombre}=`)) ?? null;

  /** `nombre=valor`, listo para reenviar con `.set('Cookie', ...)`. */
  const parEnviable = (cookie: string) => cookie.split(';')[0];

  /**
   * `set` escribe en la configuración interna, que es lo primero que `get`
   * consulta: así el interruptor de la suite gana al `.env` local, tenga lo
   * que tenga.
   */
  function encender() {
    config.set('AUTH_DEVICE_VERIFICATION_ENABLED', 'true');
    config.set('AUTH_CHALLENGE_HMAC_SECRET', HMAC_PRUEBAS);
    config.set('AUTH_DEVICE_VERIFICATION_ALLOWLIST', '');
  }

  /**
   * Recorrido completo: acceso → código del correo → verificación. Devuelve la
   * respuesta de la verificación (con sus cookies) para poder inspeccionarla.
   */
  async function confiarDispositivo(
    correo: string,
    opciones: { trustDevice?: boolean; clave?: string } = {},
  ) {
    const login = await acceder(correo, { clave: opciones.clave }).expect(201);
    expect(login.body.status).toBe('verification_required');
    const cuerpo: Record<string, unknown> = {
      challengeId: login.body.challengeId,
      code: mail.codigoPara(correo),
    };
    if (opciones.trustDevice !== undefined) {
      cuerpo.trustDevice = opciones.trustDevice;
    }
    const res = await verificar(cuerpo).expect(201);
    expect(res.body.status).toBe('authenticated');
    return res;
  }

  /** La cookie de confianza de un recorrido completo, lista para reenviar. */
  async function cookieDeConfianza(correo: string): Promise<string> {
    const res = await confiarDispositivo(correo, { trustDevice: true });
    const cookie = cookieLlamada(res, TRUSTED_DEVICE_COOKIE_PLAIN_NAME);
    expect(cookie).toBeTruthy();
    return parEnviable(cookie!);
  }

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
    sesiones = app.get(SessionsService);
    usuarios = app.get(UsersService);

    await limpiar();

    const hash = bcrypt.hashSync(CLAVE, 10);
    const empresa = await prisma.company.create({
      data: { name: `${PREFIJO} Confianza ${SELLO}`, status: 'ACTIVE' },
      select: { id: true },
    });
    empresaId = empresa.id;

    for (const [clave, correo] of Object.entries(cuentas)) {
      const usuario = await prisma.user.create({
        data: {
          email: correo,
          password: hash,
          name: `${PREFIJO} ${clave}`,
          role: 'ADMIN',
          companyId: empresa.id,
        },
        select: { id: true },
      });
      ids[clave] = usuario.id;
    }

    inicioDeSuite = new Date();
    encender();
  });

  afterAll(async () => {
    delete process.env.THROTTLE_AUTH_LIMIT;
    delete process.env.THROTTLE_PASSWORD_RESET_LIMIT;
    await limpiar();
    await app.close();
    await prisma.$disconnect().catch(() => undefined);
  });

  async function limpiar() {
    const encontrados = await prisma.user.findMany({
      where: { email: { endsWith: `@${DOMINIO}` } },
      select: { id: true },
    });
    const userIds = encontrados.map((u) => u.id);
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
      where: { name: { startsWith: `${PREFIJO} Confianza` } },
    });
  }

  // -------------------------------------------------------------------------
  describe('recordar el dispositivo', () => {
    it('emite una cookie httpOnly, SameSite=Lax, acotada a /api/auth y sin Domain', async () => {
      const res = await confiarDispositivo(cuentas.a, { trustDevice: true });

      // Fuera de producción no cabe el prefijo `__Host-` (exige HTTPS y Path=/).
      expect(cookieLlamada(res, TRUSTED_DEVICE_COOKIE_SECURE_NAME)).toBeNull();
      const cookie = cookieLlamada(res, TRUSTED_DEVICE_COOKIE_PLAIN_NAME);
      expect(cookie).toBeTruthy();
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toContain(`Path=${TRUSTED_DEVICE_COOKIE_PLAIN_PATH}`);
      // Sin `Domain` la cookie queda atada al host exacto: ningún subdominio
      // vecino puede escribirla ni leerla.
      expect(cookie).not.toMatch(/Domain=/i);
      // La sesión también nace aquí, no en el acceso.
      expect(cookieLlamada(res, REFRESH_TOKEN_COOKIE)).toBeTruthy();
    });

    it('la fila guarda una huella del token, nunca el token en claro', async () => {
      const res = await confiarDispositivo(cuentas.b, { trustDevice: true });
      const cookie = cookieLlamada(res, TRUSTED_DEVICE_COOKIE_PLAIN_NAME)!;
      const token = parEnviable(cookie).split('=')[1];

      const filas = await prisma.trustedDevice.findMany({
        where: { userId: ids.b, revokedAt: null },
        select: { tokenHash: true, expiresAt: true },
      });
      expect(filas).toHaveLength(1);
      expect(filas[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
      expect(filas[0].tokenHash).not.toBe(token);
      expect(filas[0].tokenHash).not.toContain(token);
      expect(filas[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('el siguiente acceso desde esa cookie entra directo, sin reto', async () => {
      const cookie = await cookieDeConfianza(cuentas.a);
      const retosAntes = await prisma.deviceVerificationChallenge.count({
        where: { userId: ids.a },
      });

      const res = await acceder(cuentas.a, { cookies: [cookie] }).expect(201);

      expect(res.body.status).toBe('authenticated');
      expect(typeof res.body.token).toBe('string');
      expect(cookieLlamada(res, REFRESH_TOKEN_COOKIE)).toBeTruthy();
      const retosDespues = await prisma.deviceVerificationChallenge.count({
        where: { userId: ids.a },
      });
      expect(retosDespues).toBe(retosAntes);
    });

    it('sin la cookie (ventana privada) vuelve a pedir el código', async () => {
      await cookieDeConfianza(cuentas.a);

      const res = await acceder(cuentas.a).expect(201);

      expect(res.body.status).toBe('verification_required');
      expect(res.body).not.toHaveProperty('token');
    });

    it('sin trustDevice no se emite cookie ni se crea fila', async () => {
      await prisma.trustedDevice.deleteMany({ where: { userId: ids.b } });

      // `trustDevice` ausente: confiar es una decisión explícita, no un valor
      // por defecto del cliente.
      const res = await confiarDispositivo(cuentas.b);

      expect(cookieLlamada(res, TRUSTED_DEVICE_COOKIE_PLAIN_NAME)).toBeNull();
      expect(cookieLlamada(res, TRUSTED_DEVICE_COOKIE_SECURE_NAME)).toBeNull();
      const filas = await prisma.trustedDevice.count({
        where: { userId: ids.b },
      });
      expect(filas).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('el token está atado a su dueño', () => {
    it('otra cuenta que presenta la cookie ajena sigue necesitando el código', async () => {
      const cookieDeA = await cookieDeConfianza(cuentas.a);

      const res = await acceder(cuentas.b, { cookies: [cookieDeA] }).expect(
        201,
      );

      expect(res.body.status).toBe('verification_required');
      expect(res.body).not.toHaveProperty('token');
      // Y la cookie de A sigue sirviendo solo para A.
      const suyo = await acceder(cuentas.a, { cookies: [cookieDeA] }).expect(
        201,
      );
      expect(suyo.body.status).toBe('authenticated');
    });
  });

  // -------------------------------------------------------------------------
  describe('revocación de la confianza', () => {
    it('POST /auth/trusted-devices/revoke-all la retira y el siguiente acceso vuelve a pedir código', async () => {
      const cookie = await cookieDeConfianza(cuentas.revocar);
      const entrada = await acceder(cuentas.revocar, {
        cookies: [cookie],
      }).expect(201);
      expect(entrada.body.status).toBe('authenticated');

      const res = await request(server)
        .post('/api/auth/trusted-devices/revoke-all')
        .set('Authorization', `Bearer ${entrada.body.token}`)
        .send()
        .expect(200);
      expect(res.body.revoked).toBeGreaterThanOrEqual(1);

      const vivos = await prisma.trustedDevice.count({
        where: { userId: ids.revocar, revokedAt: null },
      });
      expect(vivos).toBe(0);

      const despues = await acceder(cuentas.revocar, {
        cookies: [cookie],
      }).expect(201);
      expect(despues.body.status).toBe('verification_required');
    });

    it('revoke-all sin token responde 401', async () => {
      await request(server)
        .post('/api/auth/trusted-devices/revoke-all')
        .send()
        .expect(401);
    });

    it('cerrar todas las sesiones retira también la confianza', async () => {
      const cookie = await cookieDeConfianza(cuentas.sesiones);

      const cerradas = await sesiones.revokeAllActiveForUser(
        ids.sesiones,
        null,
      );
      expect(cerradas).toBeGreaterThanOrEqual(1);

      const vivos = await prisma.trustedDevice.count({
        where: { userId: ids.sesiones, revokedAt: null },
      });
      expect(vivos).toBe(0);

      const res = await acceder(cuentas.sesiones, {
        cookies: [cookie],
      }).expect(201);
      expect(res.body.status).toBe('verification_required');
    });

    it('restablecer la contraseña retira la confianza (camino real por HTTP)', async () => {
      const cookie = await cookieDeConfianza(cuentas.clave);

      await request(server)
        .post('/api/auth/forgot-password')
        .set('Origin', ORIGEN)
        .send({ email: cuentas.clave })
        .expect(200);
      const token = mail.tokenDeRestablecimientoPara(cuentas.clave);

      await request(server)
        .post('/api/auth/reset-password')
        .set('Origin', ORIGEN)
        .send({
          token,
          password: CLAVE_NUEVA,
          passwordConfirmation: CLAVE_NUEVA,
        })
        .expect(200);

      const vivos = await prisma.trustedDevice.count({
        where: { userId: ids.clave, revokedAt: null },
      });
      expect(vivos).toBe(0);

      // Si la contraseña dejó de ser secreta, el dispositivo recordado no
      // puede seguir abriendo la puerta.
      const res = await acceder(cuentas.clave, {
        clave: CLAVE_NUEVA,
        cookies: [cookie],
      }).expect(201);
      expect(res.body.status).toBe('verification_required');
    });

    it('desactivar la cuenta cierra sus sesiones y retira la confianza', async () => {
      await cookieDeConfianza(cuentas.baja);

      await usuarios.deactivate(ids.baja, empresaId);

      const activas = await prisma.userSession.count({
        where: { userId: ids.baja, status: 'ACTIVE' },
      });
      const vivos = await prisma.trustedDevice.count({
        where: { userId: ids.baja, revokedAt: null },
      });
      expect(activas).toBe(0);
      expect(vivos).toBe(0);
    });

    it('un dispositivo vencido ya no evita el reto', async () => {
      const cookie = await cookieDeConfianza(cuentas.vencido);
      await prisma.trustedDevice.updateMany({
        where: { userId: ids.vencido, revokedAt: null },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await acceder(cuentas.vencido, {
        cookies: [cookie],
      }).expect(201);

      expect(res.body.status).toBe('verification_required');
      expect(res.body).not.toHaveProperty('token');
    });
  });

  // -------------------------------------------------------------------------
  describe('higiene de datos', () => {
    it('no deja dispositivos ni retos fuera de las cuentas de la suite', async () => {
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

      const dispositivosAjenos = await prisma.trustedDevice.count({
        where: ajenas,
      });
      const retosAjenos = await prisma.deviceVerificationChallenge.count({
        where: ajenas,
      });

      expect(dispositivosAjenos).toBe(0);
      expect(retosAjenos).toBe(0);
    });
  });
});
