import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtStrategy } from '../src/modules/auth/jwt.strategy';
import { PrismaService } from '../src/prisma/prisma.service';
import { AutomationsController } from '../src/modules/automations/automations.controller';
import { AutomationsService } from '../src/modules/automations/automations.service';
import { AutomationRunsService } from '../src/modules/automations/automation-runs.service';
import { ChatbotController } from '../src/modules/chatbot/chatbot.controller';
import { ChatbotFlowsService } from '../src/modules/chatbot/chatbot-flows.service';
import { NotificationsController } from '../src/modules/notifications/notifications.controller';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { PlatformCompaniesController } from '../src/modules/platform/platform-companies.controller';
import { PlatformCompaniesService } from '../src/modules/platform/platform-companies.service';
import {
  buildFakeSessionPrisma,
  encodeSid,
} from './helpers/fake-session-prisma';

const SECRETO = 'e2e-permissions-secret-do-not-use-in-prod';
const EMPRESA_A = 'company-a';

/**
 * Matriz de permisos con peticiones REALES para los tres roles.
 *
 * Cubre las tres clases de endpoint que existen, con un representante de
 * cada una:
 *
 *   · negocio abierto al asesor  → notificaciones
 *   · negocio restringido a admin → automatizaciones, chatbot
 *   · plataforma                  → empresas
 *
 * Lo que se comprueba no es solo el codigo de estado: tambien que el servicio
 * NO llega a ejecutarse cuando se rechaza. Un 403 devuelto DESPUES de haber
 * leido o escrito datos sigue siendo una fuga.
 *
 * La cobertura de que ningun controlador se queda sin guardas la da
 * `security-policy.spec.ts`, que recorre el arbol entero. Esta prueba
 * comprueba que las guardas, ademas de estar puestas, hacen lo que dicen.
 */
describe('Matriz de permisos (e2e, SUPER_ADMIN / ADMIN / AGENT)', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;

  const automations = { findAll: jest.fn().mockResolvedValue([]) };
  const automationRuns = { listar: jest.fn().mockResolvedValue([]) };
  const chatbotFlows = {
    findAll: jest.fn().mockResolvedValue([]),
    sessions: jest.fn().mockResolvedValue([]),
  };
  const notifications = {
    listForUser: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    unreadCount: jest.fn().mockResolvedValue({ count: 0 }),
  };
  const platformCompanies = { listCompanies: jest.fn().mockResolvedValue([]) };

  const todosLosDobles = [
    automations.findAll,
    automationRuns.listar,
    chatbotFlows.findAll,
    chatbotFlows.sessions,
    notifications.listForUser,
    notifications.unreadCount,
    platformCompanies.listCompanies,
  ];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [
        AutomationsController,
        ChatbotController,
        NotificationsController,
        PlatformCompaniesController,
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
        { provide: AutomationsService, useValue: automations },
        { provide: AutomationRunsService, useValue: automationRuns },
        { provide: ChatbotFlowsService, useValue: chatbotFlows },
        { provide: NotificationsService, useValue: notifications },
        { provide: PlatformCompaniesService, useValue: platformCompanies },
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

  const token = (role: string, companyId: string | null) =>
    jwt.sign(
      {
        sub: `user-${role}`,
        email: `${role}@example.test`,
        role,
        companyId,
        sid: encodeSid(`user-${role}`, companyId),
      },
      { expiresIn: '5m' },
    );

  const agente = () => token('AGENT', EMPRESA_A);
  const admin = () => token('ADMIN', EMPRESA_A);
  const superAdminPlataforma = () => token('SUPER_ADMIN', null);
  const superAdminDeEmpresa = () => token('SUPER_ADMIN', EMPRESA_A);

  const pedir = (ruta: string, jwtToken?: string) => {
    const peticion = request(app.getHttpServer()).get(ruta);
    return jwtToken
      ? peticion.set('Authorization', `Bearer ${jwtToken}`)
      : peticion;
  };

  /** Ningun servicio debe haberse ejecutado tras un rechazo. */
  const ningunServicioEjecutado = () => {
    for (const doble of todosLosDobles) {
      expect(doble).not.toHaveBeenCalled();
    }
  };

  describe('sin sesion', () => {
    it.each([
      ['/api/notifications'],
      ['/api/automations'],
      ['/api/chatbot/flows'],
      ['/api/platform/companies'],
    ])('%s responde 401', async (ruta) => {
      await pedir(ruta).expect(401);
      ningunServicioEjecutado();
    });

    it('un token firmado con otro secreto no vale', async () => {
      const falsificado = new JwtService({ secret: 'otro' }).sign({
        sub: 'x',
        role: 'ADMIN',
        companyId: EMPRESA_A,
      });

      await pedir('/api/automations', falsificado).expect(401);
      ningunServicioEjecutado();
    });
  });

  describe('AGENT', () => {
    it('SI puede ver sus notificaciones: es su trabajo diario', async () => {
      await pedir('/api/notifications', agente()).expect(200);

      expect(notifications.listForUser).toHaveBeenCalled();
    });

    it('NO puede ver las automatizaciones', async () => {
      // Mandan mensajes reales a clientes reales en nombre de la empresa.
      await pedir('/api/automations', agente()).expect(403);
      ningunServicioEjecutado();
    });

    it('NO puede ver los flujos del chatbot', async () => {
      await pedir('/api/chatbot/flows', agente()).expect(403);
      ningunServicioEjecutado();
    });

    it('NO puede ver el historial de ejecuciones', async () => {
      // La restriccion es de CLASE, no de metodo: un endpoint nuevo en un
      // controlador restringido nace protegido.
      await pedir('/api/automations/runs', agente()).expect(403);
      ningunServicioEjecutado();
    });

    it('NO alcanza el panel de plataforma', async () => {
      await pedir('/api/platform/companies', agente()).expect(403);
      ningunServicioEjecutado();
    });
  });

  describe('ADMIN', () => {
    it('SI puede ver y configurar automatizaciones', async () => {
      await pedir('/api/automations', admin()).expect(200);

      expect(automations.findAll).toHaveBeenCalledWith(EMPRESA_A);
    });

    it('SI puede ver los flujos del chatbot', async () => {
      await pedir('/api/chatbot/flows', admin()).expect(200);

      expect(chatbotFlows.findAll).toHaveBeenCalledWith(EMPRESA_A);
    });

    it('NO alcanza el panel de plataforma', async () => {
      // Administrar la propia empresa no da acceso a las demas.
      await pedir('/api/platform/companies', admin()).expect(403);
      ningunServicioEjecutado();
    });

    it('el companyId sale del TOKEN, no de la peticion', async () => {
      // Es la garantia que sostiene todo el aislamiento: aunque el cliente
      // mande otra empresa, el servicio recibe la suya.
      await request(app.getHttpServer())
        .get('/api/automations?companyId=company-INTRUSA')
        .set('Authorization', `Bearer ${admin()}`)
        .expect(200);

      expect(automations.findAll).toHaveBeenCalledWith(EMPRESA_A);
    });
  });

  describe('SUPER_ADMIN de plataforma (sin empresa)', () => {
    it('SI alcanza el panel de plataforma', async () => {
      await pedir('/api/platform/companies', superAdminPlataforma()).expect(
        200,
      );

      expect(platformCompanies.listCompanies).toHaveBeenCalled();
    });

    it('NO alcanza los endpoints de negocio, ni siquiera los abiertos', async () => {
      // El panel esta deliberadamente aislado. Que la consulta "no devuelva
      // nada" por no tener empresa seria una casualidad de los datos, no una
      // garantia del control de acceso.
      await pedir('/api/notifications', superAdminPlataforma()).expect(403);
      ningunServicioEjecutado();
    });

    it('NO alcanza las automatizaciones de una empresa', async () => {
      await pedir('/api/automations', superAdminPlataforma()).expect(403);
      ningunServicioEjecutado();
    });
  });

  describe('SUPER_ADMIN atado a una empresa', () => {
    it('NO alcanza el panel de plataforma', async () => {
      // El panel no es un ROL, es un AMBITO: exige rol SUPER_ADMIN **y**
      // companyId nulo. Si bastara el rol, cualquier super admin creado
      // dentro de una empresa vería a todas las demás.
      await pedir('/api/platform/companies', superAdminDeEmpresa()).expect(403);
      ningunServicioEjecutado();
    });

    it('SI opera sobre su propia empresa', async () => {
      await pedir('/api/automations', superAdminDeEmpresa()).expect(200);

      expect(automations.findAll).toHaveBeenCalledWith(EMPRESA_A);
    });
  });

  describe('el rechazo no filtra informacion', () => {
    it('el 403 no dice que existe ni cuantas empresas hay', async () => {
      const res = await pedir('/api/platform/companies', agente()).expect(403);

      const cuerpo = JSON.stringify(res.body);
      expect(cuerpo).not.toContain('company');
      expect(cuerpo.length).toBeLessThan(200);
    });
  });
});
