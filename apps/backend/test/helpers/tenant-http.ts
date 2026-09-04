import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { App } from 'supertest/types';
import { JwtStrategy } from '../../src/modules/auth/jwt.strategy';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Peticiones HTTP REALES contra la base REAL, con sesiones reales.
 *
 * A diferencia de `fake-session-prisma.ts` (que dobla la sesión para probar
 * guardas), aquí `JwtStrategy` resuelve el `sid` contra `user_sessions` de
 * verdad: lo que se prueba es el recorrido completo —token → sesión →
 * guardas → ValidationPipe → controlador → transacción → PostgreSQL—.
 *
 * Los datos llevan un prefijo por suite y se borran por ID exacto.
 */
export const JWT_SECRET_E2E = 'e2e-tenant-http-secret-do-not-use-in-prod';

export async function crearAppHttp(opts: {
  prisma: PrismaService;
  controllers: any[];
  providers: any[];
}): Promise<{ app: INestApplication<App>; jwt: JwtService }> {
  const moduleRef = await Test.createTestingModule({
    imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
    controllers: opts.controllers,
    providers: [
      JwtStrategy,
      {
        provide: ConfigService,
        useValue: {
          getOrThrow: (k: string) => {
            if (k === 'JWT_SECRET') return JWT_SECRET_E2E;
            throw new Error(k);
          },
          get: () => undefined,
        },
      },
      { provide: PrismaService, useValue: opts.prisma },
      ...opts.providers,
    ],
  }).compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>();
  app.setGlobalPrefix('api');
  // La misma configuración que main.ts: sin esto la lista blanca no se prueba.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();
  return { app, jwt: new JwtService({ secret: JWT_SECRET_E2E }) };
}

export interface UsuarioE2E {
  userId: string;
  sessionId: string;
  role: 'ADMIN' | 'AGENT';
}

export interface EmpresaE2E {
  companyId: string;
  admin: UsuarioE2E;
  agent: UsuarioE2E;
}

let n = 0;

/**
 * Empresa + administrador + asesor, cada uno con una sesión ACTIVA real.
 * `settings` se guarda tal cual (null = empresa sin settings, v1, v2…).
 */
export async function crearEmpresaE2E(
  prisma: PrismaService,
  prefijo: string,
  data: {
    settings?: unknown;
    country?: string | null;
    timezone?: string;
    currency?: string;
    locale?: string;
    businessType?: string | null;
  } = {},
): Promise<EmpresaE2E> {
  const id = ++n;
  const stamp = `${Date.now()}-${id}`;
  const company = await prisma.company.create({
    data: {
      name: `${prefijo} Empresa ${id}`,
      status: 'ACTIVE',
      ...(data.settings !== undefined && {
        settings: data.settings as never,
      }),
      ...(data.country !== undefined && { country: data.country }),
      ...(data.timezone !== undefined && { timezone: data.timezone }),
      ...(data.currency !== undefined && { currency: data.currency }),
      ...(data.locale !== undefined && { locale: data.locale }),
      ...(data.businessType !== undefined && {
        businessType: data.businessType,
      }),
    },
    select: { id: true },
  });

  async function usuario(role: 'ADMIN' | 'AGENT'): Promise<UsuarioE2E> {
    const user = await prisma.user.create({
      data: {
        email: `${prefijo.toLowerCase()}-${role.toLowerCase()}-${stamp}@example.test`,
        // Hash ficticio: nadie inicia sesión con contraseña en estas pruebas.
        password: 'e2e-not-a-real-hash',
        name: `${prefijo} ${role} ${id}`,
        role,
        companyId: company.id,
      },
      select: { id: true },
    });
    const session = await prisma.userSession.create({
      data: {
        userId: user.id,
        companyId: company.id,
        deviceIdHash: `e2e-device-${role}-${stamp}`,
        refreshTokenHash: `e2e-refresh-${role}-${stamp}`,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    return { userId: user.id, sessionId: session.id, role };
  }

  return {
    companyId: company.id,
    admin: await usuario('ADMIN'),
    agent: await usuario('AGENT'),
  };
}

export function tokenDe(
  jwt: JwtService,
  empresa: EmpresaE2E,
  quien: 'admin' | 'agent',
): string {
  const u = empresa[quien];
  return jwt.sign(
    {
      sub: u.userId,
      email: `${quien}@example.test`,
      role: u.role,
      companyId: empresa.companyId,
      sid: u.sessionId,
    },
    { expiresIn: '5m' },
  );
}

/** Borra TODO lo de estas empresas, en orden de dependencias, por ID exacto. */
export async function limpiarEmpresasE2E(
  prisma: PrismaService,
  empresas: EmpresaE2E[],
): Promise<void> {
  const companyIds = empresas.map((e) => e.companyId);
  const userIds = empresas.flatMap((e) => [e.admin.userId, e.agent.userId]);
  if (companyIds.length === 0) return;
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { affectedCompanyId: { in: companyIds } },
        { actorUserId: { in: userIds } },
      ],
    },
  });
  await prisma.leadProduct.deleteMany({
    where: { product: { companyId: { in: companyIds } } },
  });
  await prisma.productImport.deleteMany({
    where: { companyId: { in: companyIds } },
  });
  await prisma.product.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.pipelineStage.deleteMany({
    where: { pipeline: { companyId: { in: companyIds } } },
  });
  await prisma.pipeline.deleteMany({
    where: { companyId: { in: companyIds } },
  });
  await prisma.userSession.deleteMany({
    where: { companyId: { in: companyIds } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
}
