import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtStrategy } from '../src/modules/auth/jwt.strategy';
import { PrismaService } from '../src/prisma/prisma.service';
import { PlatformAuditLogService } from '../src/modules/platform/platform-audit-log.service';
import { SupportSessionsService } from '../src/modules/platform/support-sessions.service';
import { FlowBotController } from '../src/modules/flowbot/api/flowbot.controller';
import { FlowBotAdminService } from '../src/modules/flowbot/api/flowbot.admin.service';
import { FlowBotTriggersService } from '../src/modules/flowbot/api/flowbot.triggers.service';
import { FlowBotExecutionsService } from '../src/modules/flowbot/api/flowbot.executions.service';
import { FlowBotMetricsService } from '../src/modules/flowbot/api/flowbot.metrics.service';
import { FlowBotSimulatorService } from '../src/modules/flowbot/api/flowbot.simulator.service';
import { FlowBotSupportGuard } from '../src/modules/flowbot/api/flowbot-support.guard';
import { FlowBotReferenciasService } from '../src/modules/flowbot/graph/flowbot.referencias.service';
import { CABECERA_SOPORTE } from '../src/modules/flowbot/api/flowbot-support.guard';

/**
 * ACCESO DE PLATAFORMA A FLOWBOT — por HTTP y contra la base real.
 *
 * Las unitarias del guarda prueban su lógica aislada. Lo que solo se ve aquí es
 * si esa lógica llega a ejecutarse: una guarda correcta colocada después de la
 * que exige empresa nunca corre, porque un usuario de plataforma no tiene
 * empresa y le rechazan antes. Ese fallo no lo enseña ningún mock, porque en un
 * mock el orden lo pone quien escribe la prueba.
 *
 * También se comprueba contra filas de verdad que una sesión caducada o cerrada
 * no sirve —eso lo decide la base comparando fechas, no el guarda— y que la
 * auditoría que queda escrita dice quién fue de verdad.
 *
 * Datos con prefijo E2E-SOP, limpiados al final.
 */
const prisma = new PrismaClient();
const PREFIJO = 'E2E-SOP';
const SECRETO = 'e2e-test-only-secret-do-not-use-in-prod';

const FLUJO = {
  schemaVersion: 1,
  startNodeId: 'inicio',
  nodes: [
    {
      id: 'inicio',
      type: 'trigger.inbound_message',
      position: { x: 0, y: 0 },
      config: {},
    },
    {
      id: 'saluda',
      type: 'send.text',
      position: { x: 260, y: 0 },
      config: { text: 'Hola' },
    },
    { id: 'fin', type: 'control.end', position: { x: 520, y: 0 }, config: {} },
  ],
  edges: [
    { id: 'e1', from: 'inicio', fromPort: 'next', to: 'saluda' },
    { id: 'e2', from: 'saluda', fromPort: 'next', to: 'fin' },
  ],
};

describe('Acceso de soporte a FlowBot (e2e, HTTP + base real)', () => {
  const servicioPrisma = prisma as unknown as PrismaService;

  let app: INestApplication<App>;
  let jwt: JwtService;

  let empresaA: string;
  let empresaB: string;
  let adminA: string;
  let plataforma: string;
  let sidAdminA: string;
  let sidPlataforma: string;
  let botA: string;
  let botB: string;
  let sesionActiva: string;
  let sesionCaducada: string;
  let sesionCerrada: string;
  let sesionAjena: string;

  /** Un stub de ejecuciones: aquí se prueba la puerta, no la operación. */
  const ejecucionesStub = {
    listar: jest.fn().mockResolvedValue({ items: [], siguienteCursor: null }),
    detalle: jest.fn(),
    cancelar: jest.fn().mockResolvedValue({ cancelada: true }),
    pausar: jest.fn().mockResolvedValue({ pausada: true }),
    reanudar: jest.fn().mockResolvedValue({ reanudada: true }),
    reintentar: jest.fn().mockResolvedValue({ reintentada: true, estado: 'X' }),
    forzarHandoff: jest.fn().mockResolvedValue({ handoff: true }),
  };

  const token = (
    userId: string,
    role: string,
    companyId: string | null,
    sid: string,
  ) =>
    jwt.sign(
      { sub: userId, email: `${userId}@ejemplo.test`, role, companyId, sid },
      { expiresIn: '5m' },
    );

  const sesionDeUsuario = async (userId: string, companyId: string | null) => {
    const s = await prisma.userSession.create({
      data: {
        userId,
        companyId,
        deviceIdHash: `${PREFIJO}-${userId}`,
        refreshTokenHash: `${PREFIJO}-${userId}-${Math.random()}`,
      },
    });
    return s.id;
  };

  beforeAll(async () => {
    process.env.QUEUE_ENABLED = 'false';

    const a = await prisma.company.create({
      data: { name: `${PREFIJO}-A`, status: 'ACTIVE' },
    });
    const b = await prisma.company.create({
      data: { name: `${PREFIJO}-B`, status: 'ACTIVE' },
    });
    empresaA = a.id;
    empresaB = b.id;

    const ua = await prisma.user.create({
      data: {
        companyId: empresaA,
        email: `${PREFIJO.toLowerCase()}-admin-a@ejemplo.test`,
        password: 'x',
        name: 'Admin A',
        role: 'ADMIN',
      },
    });
    adminA = ua.id;

    // El usuario de plataforma NO tiene empresa. Ese es justo el caso que el
    // guarda de empresa rechaza si se le pone delante.
    const up = await prisma.user.create({
      data: {
        companyId: null,
        email: `${PREFIJO.toLowerCase()}-plataforma@ejemplo.test`,
        password: 'x',
        name: 'Soporte',
        role: 'SUPER_ADMIN',
      },
    });
    plataforma = up.id;

    const otro = await prisma.user.create({
      data: {
        companyId: null,
        email: `${PREFIJO.toLowerCase()}-otro@ejemplo.test`,
        password: 'x',
        name: 'Otro soporte',
        role: 'SUPER_ADMIN',
      },
    });

    sidAdminA = await sesionDeUsuario(adminA, empresaA);
    sidPlataforma = await sesionDeUsuario(plataforma, null);

    const bot = (companyId: string, nombre: string) =>
      prisma.flowBot.create({
        data: {
          companyId,
          name: nombre,
          status: 'DRAFT',
          draftGraph: FLUJO,
          draftRevision: 1,
        },
      });
    botA = (await bot(empresaA, `${PREFIJO}-bot-A`)).id;
    botB = (await bot(empresaB, `${PREFIJO}-bot-B`)).id;

    const enMinutos = (m: number) => new Date(Date.now() + m * 60_000);
    const crearSesion = (
      actorUserId: string,
      companyId: string,
      extra: Record<string, unknown>,
    ) =>
      prisma.supportSession.create({
        data: {
          actorUserId,
          companyId,
          reason: 'El cliente reporta que su bot no contesta',
          expiresAt: enMinutos(30),
          ...extra,
        },
      });

    sesionActiva = (await crearSesion(plataforma, empresaA, {})).id;
    sesionCaducada = (
      await crearSesion(plataforma, empresaA, { expiresAt: enMinutos(-1) })
    ).id;
    sesionCerrada = (
      await crearSesion(plataforma, empresaA, {
        status: 'ENDED',
        endedAt: new Date(),
      })
    ).id;
    // Una sesión válida pero de OTRO operador: el id no es una llave que se
    // pueda pasar de mano en mano.
    sesionAjena = (await crearSesion(otro.id, empresaA, {})).id;

    const referencias = new FlowBotReferenciasService(servicioPrisma);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [FlowBotController],
      providers: [
        JwtStrategy,
        FlowBotSupportGuard,
        // Servicios REALES: soporte, auditoría y administración de bots. Lo
        // que se quiere comprobar es que el filtro de empresa que aplican
        // esos servicios recibe la empresa de la sesión y ninguna otra.
        SupportSessionsService,
        PlatformAuditLogService,
        { provide: PrismaService, useValue: servicioPrisma },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (k: string) => {
              if (k === 'JWT_SECRET') return SECRETO;
              throw new Error(`Config inesperada: ${k}`);
            },
          },
        },
        {
          provide: FlowBotAdminService,
          useValue: new FlowBotAdminService(servicioPrisma, referencias),
        },
        {
          provide: FlowBotTriggersService,
          useValue: new FlowBotTriggersService(servicioPrisma),
        },
        { provide: FlowBotExecutionsService, useValue: ejecucionesStub },
        {
          provide: FlowBotMetricsService,
          useValue: new FlowBotMetricsService(servicioPrisma),
        },
        {
          provide: FlowBotSimulatorService,
          useValue: new FlowBotSimulatorService(servicioPrisma, referencias),
        },
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

    jwt = new JwtService({ secret: SECRETO });
  });

  afterAll(async () => {
    await app?.close();
    const empresas = [empresaA, empresaB];
    await prisma.auditLog.deleteMany({
      where: { affectedCompanyId: { in: empresas } },
    });
    await prisma.supportSession.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.flowBot.updateMany({
      where: { companyId: { in: empresas } },
      data: { publishedVersionId: null },
    });
    await prisma.flowBotVersion.deleteMany({
      where: { flowBot: { companyId: { in: empresas } } },
    });
    await prisma.flowBot.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.userSession.deleteMany({
      where: { deviceIdHash: { startsWith: PREFIJO } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: PREFIJO.toLowerCase() } },
    });
    await prisma.company.deleteMany({ where: { id: { in: empresas } } });
    await prisma.$disconnect();
  });

  beforeEach(() => jest.clearAllMocks());

  const comoPlataforma = (sesion?: string) => {
    const req = request(app.getHttpServer());
    return {
      get: (ruta: string) => {
        const r = req
          .get(ruta)
          .set(
            'Authorization',
            `Bearer ${token(plataforma, 'SUPER_ADMIN', null, sidPlataforma)}`,
          );
        return sesion ? r.set(CABECERA_SOPORTE, sesion) : r;
      },
      post: (ruta: string, cuerpo: Record<string, unknown> = {}) => {
        const r = request(app.getHttpServer())
          .post(ruta)
          .set(
            'Authorization',
            `Bearer ${token(plataforma, 'SUPER_ADMIN', null, sidPlataforma)}`,
          )
          .send(cuerpo);
        return sesion ? r.set(CABECERA_SOPORTE, sesion) : r;
      },
    };
  };

  describe('sin sesión de soporte activa: 403', () => {
    it('403 al listar bots sin cabecera de sesión', async () => {
      const res = await comoPlataforma().get('/api/flowbots');

      expect(res.status).toBe(403);
      // El mensaje tiene que decir QUÉ falta. Si respondiera «necesitas una
      // empresa» —lo que pasaba con el guarda mal colocado— quien depure
      // buscaría un problema de cuenta y no abriría una sesión de soporte.
      expect(String(res.body.message)).toContain('sesión de soporte');
    });

    it('403 al leer un bot concreto de otra empresa sin sesión', async () => {
      const res = await comoPlataforma().get(`/api/flowbots/${botA}`);
      expect(res.status).toBe(403);
    });

    it('403 al crear un bot sin sesión', async () => {
      const res = await comoPlataforma().post('/api/flowbots', {
        nombre: `${PREFIJO}-no`,
      });
      expect(res.status).toBe(403);
      expect(
        await prisma.flowBot.count({ where: { name: `${PREFIJO}-no` } }),
      ).toBe(0);
    });

    it('403 con una sesión CADUCADA', async () => {
      const res = await comoPlataforma(sesionCaducada).get('/api/flowbots');
      expect(res.status).toBe(403);
    });

    it('403 con una sesión CERRADA', async () => {
      const res = await comoPlataforma(sesionCerrada).get('/api/flowbots');
      expect(res.status).toBe(403);
    });

    it('404 con la sesión de OTRO operador: el id no es transferible', async () => {
      const res = await comoPlataforma(sesionAjena).get('/api/flowbots');
      // Soporte responde 404 y no 403 a propósito: confirmar que un id existe
      // ya sería filtrar que alguien está atendiendo a esa empresa.
      expect(res.status).toBe(404);
    });

    it('403 con un id de sesión inventado', async () => {
      const res = await comoPlataforma('no-existe').get('/api/flowbots');
      expect([403, 404]).toContain(res.status);
    });
  });

  describe('con sesión activa', () => {
    it('entra y ve SOLO la empresa soportada', async () => {
      const res = await comoPlataforma(sesionActiva).get('/api/flowbots');

      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ id: string }>).map((b) => b.id);
      expect(ids).toContain(botA);
      // Cero acceso transversal: el bot de la otra empresa no aparece aunque
      // quien pregunta sea SUPER_ADMIN.
      expect(ids).not.toContain(botB);
    });

    it('404 al pedir un bot de una empresa que NO es la de la sesión', async () => {
      const res = await comoPlataforma(sesionActiva).get(
        `/api/flowbots/${botB}`,
      );
      expect(res.status).toBe(404);
    });

    it('la cabecera no puede apuntar a otra empresa cambiando el cuerpo', async () => {
      // No hay forma de decir «crea esto en la empresa B»: el `companyId` sale
      // de la sesión, y el cuerpo con campos de más lo rechaza el ValidationPipe.
      const res = await comoPlataforma(sesionActiva).post('/api/flowbots', {
        nombre: `${PREFIJO}-intento`,
        companyId: empresaB,
      });
      expect(res.status).toBe(400);
    });
  });

  describe('la auditoría dice quién fue de verdad', () => {
    it('crear deja registrado el operador de plataforma y la empresa soportada', async () => {
      const res = await comoPlataforma(sesionActiva).post('/api/flowbots', {
        nombre: `${PREFIJO}-creado-por-soporte`,
      });
      expect(res.status).toBe(201);

      const registro = await prisma.auditLog.findFirst({
        where: { action: 'flowbot.create', entityId: res.body.id },
      });

      expect(registro).toBeTruthy();
      // Quien actúa es la persona de plataforma, no un admin de la empresa.
      expect(registro?.actorUserId).toBe(plataforma);
      expect(registro?.actorRole).toBe('SUPER_ADMIN');
      expect(registro?.affectedCompanyId).toBe(empresaA);
      // Y queda el motivo escrito al abrir la sesión: sin él el registro dice
      // qué pasó pero no por qué, que es la pregunta que se hace después.
      expect(registro?.reason).toContain('no contesta');
      expect(registro?.metadata).toMatchObject({
        viaSoporte: true,
        supportSessionId: sesionActiva,
        empresaSoportada: empresaA,
      });
    });

    it('publicar, cancelar, reanudar y forzar handoff quedan igual de firmados', async () => {
      const creado = await comoPlataforma(sesionActiva).post('/api/flowbots', {
        nombre: `${PREFIJO}-publicable`,
      });
      const id = creado.body.id as string;

      // La revisión se lee, no se supone: guardar con una revisión que no es
      // la actual es justamente lo que el control de conflicto rechaza.
      const borrador = await comoPlataforma(sesionActiva).get(
        `/api/flowbots/${id}/draft`,
      );
      const guardado = await comoPlataforma(sesionActiva).post(
        `/api/flowbots/${id}/draft`,
        { graph: FLUJO, revision: borrador.body.revision },
      );
      expect(guardado.status).toBe(201);
      const publicado = await comoPlataforma(sesionActiva).post(
        `/api/flowbots/${id}/publish`,
        { nota: 'desde soporte' },
      );
      expect(publicado.status).toBe(201);

      await comoPlataforma(sesionActiva).post(
        '/api/flowbots/executions/ejec-1/cancel',
        { motivo: 'el cliente lo pidió' },
      );
      await comoPlataforma(sesionActiva).post(
        '/api/flowbots/executions/ejec-1/resume',
      );
      await comoPlataforma(sesionActiva).post(
        '/api/flowbots/executions/ejec-1/handoff',
        { motivo: 'lo atiende una persona' },
      );

      const acciones = [
        'flowbot.publish',
        'flowbot.execution.cancel',
        'flowbot.execution.resume',
        'flowbot.execution.handoff',
      ];
      for (const accion of acciones) {
        const registro = await prisma.auditLog.findFirst({
          where: { action: accion, affectedCompanyId: empresaA },
          orderBy: { createdAt: 'desc' },
        });
        expect([accion, registro?.actorUserId]).toEqual([accion, plataforma]);
        expect([accion, registro?.metadata]).toEqual([
          accion,
          expect.objectContaining({
            viaSoporte: true,
            supportSessionId: sesionActiva,
            empresaSoportada: empresaA,
          }),
        ]);
      }
    });
  });

  describe('los usuarios de empresa no cambian', () => {
    const comoAdminA = () =>
      request(app.getHttpServer())
        .get('/api/flowbots')
        .set(
          'Authorization',
          `Bearer ${token(adminA, 'ADMIN', empresaA, sidAdminA)}`,
        );

    it('un ADMIN entra sin cabecera de soporte, como siempre', async () => {
      const res = await comoAdminA();
      expect(res.status).toBe(200);
      expect((res.body as Array<{ id: string }>).map((b) => b.id)).toContain(
        botA,
      );
    });

    it('una cabecera de soporte NO le sirve para saltar a otra empresa', async () => {
      // La sesión de soporte es de la empresa A; aunque apuntara a la B, un
      // usuario con empresa propia ni siquiera pasa por esa rama del guarda.
      const res = await request(app.getHttpServer())
        .get('/api/flowbots')
        .set(
          'Authorization',
          `Bearer ${token(adminA, 'ADMIN', empresaA, sidAdminA)}`,
        )
        .set(CABECERA_SOPORTE, sesionActiva);

      expect(res.status).toBe(200);
      expect(
        (res.body as Array<{ id: string }>).map((b) => b.id),
      ).not.toContain(botB);
    });

    it('sigue haciendo falta un token válido: sin él, 401', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/flowbots')
        .set(CABECERA_SOPORTE, sesionActiva);
      expect(res.status).toBe(401);
    });
  });
});
