import { INestApplication, ValidationPipe } from '@nestjs/common';
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
import { PlatformAuditLogService } from '../src/modules/platform/platform-audit-log.service';
import {
  buildFakeSessionPrisma,
  encodeSid,
} from './helpers/fake-session-prisma';

const SECRETO = 'e2e-contactos-listado-secret-do-not-use-in-prod';
const EMPRESA_A = 'company-a';

/**
 * LA SUPERFICIE HTTP DE LA PANTALLA DE CONTACTOS (3.z, mockup 02).
 *
 * Comprueba tres cosas que solo se ven pasando por el enrutador de verdad:
 *
 *   1. Que `/contacts/listado` la atiende el listado y NO la ruta `:id`. Con
 *      las rutas declaradas al reves, el servidor busca un contacto llamado
 *      «listado» y responde 404. Es un fallo que no se ve leyendo el servicio,
 *      porque el servicio esta perfecto.
 *   2. Que el `companyId` que se usa sale SIEMPRE de la sesion, y que uno
 *      enviado por el cliente no puede cambiarlo.
 *   3. Que archivar y restaurar los puede hacer el asesor, y que la
 *      eliminacion definitiva no.
 */
describe('Pantalla de Contactos: listado, archivar y restaurar (e2e HTTP)', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;

  const contacts = {
    listado: jest.fn().mockResolvedValue({
      items: [],
      total: 0,
      contadores: { activos: 0, archivados: 0 },
    }),
    findAll: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue({ id: 'c1' }),
    remove: jest.fn().mockResolvedValue({ archivado: true, yaEstaba: false }),
    restore: jest.fn().mockResolvedValue({ restaurado: true, yaEstaba: false }),
    create: jest.fn(),
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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [ContactsController],
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
  const superAdminSinEmpresa = () => token('SUPER_ADMIN', null);

  describe('orden de rutas', () => {
    it('`/contacts/listado` la atiende el LISTADO, no la ruta `:id`', async () => {
      const r = await request(app.getHttpServer())
        .get('/api/contacts/listado')
        .set('Authorization', `Bearer ${agente()}`)
        .expect(200);

      expect(contacts.listado).toHaveBeenCalledTimes(1);
      // La prueba de verdad: `findById` NO se ha llamado con «listado».
      expect(contacts.findById).not.toHaveBeenCalled();
      expect(r.body).toHaveProperty('contadores');
    });

    it('`/contacts/:id` sigue funcionando para un id normal', async () => {
      await request(app.getHttpServer())
        .get('/api/contacts/cmxxxx')
        .set('Authorization', `Bearer ${agente()}`)
        .expect(200);

      expect(contacts.findById).toHaveBeenCalledWith('cmxxxx', EMPRESA_A);
      expect(contacts.listado).not.toHaveBeenCalled();
    });
  });

  describe('aislamiento por empresa', () => {
    it('el `companyId` sale de la SESION, no de la peticion', async () => {
      await request(app.getHttpServer())
        .get('/api/contacts/listado?vista=activos&companyId=otra-empresa')
        .set('Authorization', `Bearer ${agente()}`)
        .expect(200);

      expect(contacts.listado).toHaveBeenCalledWith(
        EMPRESA_A,
        expect.objectContaining({ vista: 'activos' }),
      );
      // El `companyId` del cliente no viaja al servicio por ninguna via.
      const opciones = contacts.listado.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(opciones).not.toHaveProperty('companyId');
    });

    it('sin sesion no se lista nada', async () => {
      await request(app.getHttpServer())
        .get('/api/contacts/listado')
        .expect(401);

      expect(contacts.listado).not.toHaveBeenCalled();
    });

    it('un SUPER_ADMIN sin empresa no entra: no tiene inquilino', async () => {
      await request(app.getHttpServer())
        .get('/api/contacts/listado')
        .set('Authorization', `Bearer ${superAdminSinEmpresa()}`)
        .expect(403);

      expect(contacts.listado).not.toHaveBeenCalled();
    });
  });

  describe('vista y parametros', () => {
    it('`vista=papelera` llega tal cual al servicio', async () => {
      await request(app.getHttpServer())
        .get('/api/contacts/listado?vista=papelera&search=ana&limit=25')
        .set('Authorization', `Bearer ${agente()}`)
        .expect(200);

      expect(contacts.listado).toHaveBeenCalledWith(EMPRESA_A, {
        vista: 'papelera',
        search: 'ana',
        limit: '25',
        offset: undefined,
      });
    });

    it('una vista desconocida cae en `activos`, no en un estado raro', async () => {
      await request(app.getHttpServer())
        .get('/api/contacts/listado?vista=loquesea')
        .set('Authorization', `Bearer ${agente()}`)
        .expect(200);

      expect(contacts.listado).toHaveBeenCalledWith(
        EMPRESA_A,
        expect.objectContaining({ vista: 'activos' }),
      );
    });
  });

  describe('matriz de roles del incremento', () => {
    it('el AGENT SI puede archivar: es su trabajo diario', async () => {
      await request(app.getHttpServer())
        .delete('/api/contacts/c1')
        .set('Authorization', `Bearer ${agente()}`)
        .send({ motivo: 'ya no es cliente' })
        .expect(200);

      expect(contacts.remove).toHaveBeenCalledWith(
        'c1',
        EMPRESA_A,
        'ya no es cliente',
      );
      // Archivar queda auditado.
      expect(auditoria.record).toHaveBeenCalled();
    });

    it('el AGENT SI puede restaurar desde la papelera', async () => {
      await request(app.getHttpServer())
        .post('/api/contacts/c1/restore')
        .set('Authorization', `Bearer ${agente()}`)
        .expect(201);

      expect(contacts.restore).toHaveBeenCalledWith('c1', EMPRESA_A);
      expect(auditoria.record).toHaveBeenCalled();
    });

    it('el AGENT NO puede eliminar definitivamente', async () => {
      await request(app.getHttpServer())
        .delete('/api/contacts/c1/definitivo')
        .set('Authorization', `Bearer ${agente()}`)
        .send({ confirmacion: 'ELIMINAR DEFINITIVAMENTE' })
        .expect(403);

      expect(eliminacion.eliminarDefinitivo).not.toHaveBeenCalled();
    });

    it('el ADMIN si puede eliminar definitivamente', async () => {
      await request(app.getHttpServer())
        .delete('/api/contacts/c1/definitivo')
        .set('Authorization', `Bearer ${admin()}`)
        .send({ confirmacion: 'ELIMINAR DEFINITIVAMENTE' })
        .expect(200);

      expect(eliminacion.eliminarDefinitivo).toHaveBeenCalled();
    });
  });
});
