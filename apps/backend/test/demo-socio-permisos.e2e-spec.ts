import {
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtStrategy } from '../src/modules/auth/jwt.strategy';
import { PrismaService } from '../src/prisma/prisma.service';
import { ContactsController } from '../src/modules/contacts/contacts.controller';
import { ContactsService } from '../src/modules/contacts/contacts.service';
import { ContactsEliminacionService } from '../src/modules/contacts/contacts-eliminacion.service';
import { PerfilComercialService } from '../src/modules/contacts/perfil-comercial.service';
import { AnalyticsController } from '../src/modules/analytics/analytics.controller';
import { AnalyticsService } from '../src/modules/analytics/analytics.service';
import { AutomationsController } from '../src/modules/automations/automations.controller';
import { AutomationsService } from '../src/modules/automations/automations.service';
import { AutomationRunsService } from '../src/modules/automations/automation-runs.service';
import { PlatformAuditLogService } from '../src/modules/platform/platform-audit-log.service';
import {
  buildFakeSessionPrisma,
  encodeSid,
} from './helpers/fake-session-prisma';

const SECRETO = 'e2e-demo-permisos-secret-do-not-use-in-prod';
const EMPRESA_DEMO = 'company-demo';
const EMPRESA_AJENA = 'company-otra';

/**
 * QUE PUEDE HACER CADA CUENTA DEMO, con peticiones reales.
 *
 * Son las dos identidades que va a usar quien evalue el producto, asi que lo
 * que se comprueba aqui es exactamente lo que esa persona vera: el ADMIN entra
 * a las pantallas de administracion y el AGENT se topa con la puerta cerrada,
 * no con una pantalla en blanco ni con un error de servidor.
 *
 * Y lo segundo, que importa mas: ninguno de los dos alcanza datos de otra
 * empresa. El `companyId` sale SIEMPRE de la sesion; uno enviado en la
 * peticion no cambia nada.
 */
describe('Cuentas demo: matriz de permisos y aislamiento (e2e HTTP)', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;

  const contacts = {
    listado: jest.fn().mockResolvedValue({
      items: [],
      total: 0,
      contadores: { activos: 0, archivados: 0 },
    }),
    findAll: jest.fn().mockResolvedValue([]),
    findById: jest.fn(),
    remove: jest.fn().mockResolvedValue({ archivado: true, yaEstaba: false }),
    restore: jest.fn().mockResolvedValue({ restaurado: true, yaEstaba: false }),
    create: jest.fn().mockResolvedValue({ id: 'c1' }),
    update: jest.fn(),
    block: jest.fn(),
  };
  const eliminacion = {
    papelera: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    impacto: jest.fn(),
    eliminarDefinitivo: jest.fn().mockResolvedValue({
      accion: 'anonimizado',
      impacto: { relaciones: {}, totalRelaciones: 0 },
    }),
  };
  const perfil = { perfil: jest.fn().mockResolvedValue({}) };
  const auditoria = { record: jest.fn().mockResolvedValue(undefined) };
  const analytics = {
    getOverview: jest.fn().mockResolvedValue({}),
    getLeadsByStage: jest.fn().mockResolvedValue([]),
    getAgentPerformance: jest.fn().mockResolvedValue([]),
    getLostReasons: jest.fn().mockResolvedValue([]),
    getOverdueTasksCount: jest.fn().mockResolvedValue(0),
    getPendingConversationsCount: jest.fn().mockResolvedValue(0),
    getSalesTrend: jest.fn().mockResolvedValue({}),
    getRecentActivity: jest.fn().mockResolvedValue([]),
  };
  const automations = { findAll: jest.fn().mockResolvedValue([]) };
  const automationRuns = { listar: jest.fn().mockResolvedValue([]) };

  const todosLosDobles = [
    contacts.listado,
    contacts.findAll,
    contacts.findById,
    contacts.create,
    eliminacion.papelera,
    eliminacion.eliminarDefinitivo,
    analytics.getOverview,
    analytics.getLeadsByStage,
    automations.findAll,
    automationRuns.listar,
  ];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [
        ContactsController,
        AnalyticsController,
        AutomationsController,
      ],
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (k: string) => {
              if (k === 'JWT_SECRET') return SECRETO;
              throw new Error(k);
            },
          },
        },
        { provide: PrismaService, useValue: buildFakeSessionPrisma() },
        { provide: ContactsService, useValue: contacts },
        { provide: ContactsEliminacionService, useValue: eliminacion },
        { provide: PerfilComercialService, useValue: perfil },
        { provide: PlatformAuditLogService, useValue: auditoria },
        { provide: AnalyticsService, useValue: analytics },
        { provide: AutomationsService, useValue: automations },
        { provide: AutomationRunsService, useValue: automationRuns },
      ],
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
    jwt = new JwtService({ secret: SECRETO });
  });

  afterAll(async () => app?.close());
  beforeEach(() => jest.clearAllMocks());

  const token = (
    role: string,
    companyId: string | null,
    sub = `user-${role}`,
  ) =>
    jwt.sign(
      {
        sub,
        email: `${role}@example.invalid`,
        role,
        companyId,
        sid: encodeSid(sub, companyId),
      },
      { expiresIn: '5m' },
    );

  const adminDemo = () => token('ADMIN', EMPRESA_DEMO, 'demo-admin');
  const agentDemo = () => token('AGENT', EMPRESA_DEMO, 'demo-agent');

  const get = (ruta: string, t: string) =>
    request(app.getHttpServer()).get(ruta).set('Authorization', `Bearer ${t}`);

  const ningunServicioEjecutado = () => {
    for (const d of todosLosDobles) expect(d).not.toHaveBeenCalled();
  };

  describe('lo que los DOS pueden hacer: el trabajo diario', () => {
    it.each([
      ['/api/contacts/listado'],
      ['/api/contacts'],
      ['/api/contacts/papelera/listado'],
    ])('%s lo ven ADMIN y AGENT', async (ruta) => {
      await get(ruta, adminDemo()).expect(200);
      await get(ruta, agentDemo()).expect(200);
    });

    it('el AGENT puede archivar y restaurar', async () => {
      await request(app.getHttpServer())
        .delete('/api/contacts/c1')
        .set('Authorization', `Bearer ${agentDemo()}`)
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/contacts/c1/restore')
        .set('Authorization', `Bearer ${agentDemo()}`)
        .expect(201);

      expect(contacts.remove).toHaveBeenCalledWith(
        'c1',
        EMPRESA_DEMO,
        undefined,
      );
      expect(contacts.restore).toHaveBeenCalledWith('c1', EMPRESA_DEMO);
    });
  });

  describe('lo que SOLO puede el ADMIN', () => {
    it.each([
      ['/api/analytics/overview'],
      ['/api/analytics/leads-by-stage'],
      ['/api/automations'],
    ])('%s: ADMIN 200, AGENT 403', async (ruta) => {
      await get(ruta, adminDemo()).expect(200);
      jest.clearAllMocks();

      await get(ruta, agentDemo()).expect(403);
      // Un 403 devuelto DESPUES de leer datos seguiria siendo una fuga.
      ningunServicioEjecutado();
    });

    it('la eliminación definitiva de un contacto: ADMIN sí, AGENT no', async () => {
      await request(app.getHttpServer())
        .delete('/api/contacts/c1/definitivo')
        .set('Authorization', `Bearer ${agentDemo()}`)
        .send({ confirmacion: 'ELIMINAR DEFINITIVAMENTE' })
        .expect(403);
      expect(eliminacion.eliminarDefinitivo).not.toHaveBeenCalled();

      await request(app.getHttpServer())
        .delete('/api/contacts/c1/definitivo')
        .set('Authorization', `Bearer ${adminDemo()}`)
        .send({ confirmacion: 'ELIMINAR DEFINITIVAMENTE' })
        .expect(200);
      expect(eliminacion.eliminarDefinitivo).toHaveBeenCalled();
    });
  });

  describe('aislamiento: ninguna de las dos cuentas alcanza otra empresa', () => {
    it('el companyId sale de la SESIÓN, no de la petición', async () => {
      await get(
        `/api/contacts/listado?companyId=${EMPRESA_AJENA}`,
        adminDemo(),
      ).expect(200);
      expect(contacts.listado).toHaveBeenCalledWith(
        EMPRESA_DEMO,
        expect.anything(),
      );

      jest.clearAllMocks();
      await get(
        `/api/contacts/listado?companyId=${EMPRESA_AJENA}`,
        agentDemo(),
      ).expect(200);
      expect(contacts.listado).toHaveBeenCalledWith(
        EMPRESA_DEMO,
        expect.anything(),
      );
    });

    it('buscar un contacto ajeno consulta acotado a la empresa demo', async () => {
      // Un `NotFoundException` de verdad: es lo que lanza el servicio real
      // cuando el id no pertenece a la empresa de la sesion.
      contacts.findById.mockRejectedValueOnce(
        new NotFoundException('Contacto no encontrado'),
      );
      await get('/api/contacts/contacto-de-otra-empresa', agentDemo()).expect(
        404,
      );

      // La consulta llevó el companyId de la sesión: por eso no lo encuentra.
      expect(contacts.findById).toHaveBeenCalledWith(
        'contacto-de-otra-empresa',
        EMPRESA_DEMO,
      );
    });

    it('un token sin empresa no entra a ningún endpoint de negocio', async () => {
      await get('/api/contacts/listado', token('SUPER_ADMIN', null)).expect(
        403,
      );
      ningunServicioEjecutado();
    });

    it('sin sesión, nada', async () => {
      await request(app.getHttpServer())
        .get('/api/contacts/listado')
        .expect(401);
      ningunServicioEjecutado();
    });
  });
});
