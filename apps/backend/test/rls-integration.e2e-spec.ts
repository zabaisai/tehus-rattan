import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import {
  runWithTenant,
  runInTenantContext,
} from '../src/prisma/tenant-context';
import { TenantContext } from '../src/prisma/tenant-context.storage';

// Integración de RLS de extremo a extremo, con el cliente Prisma REAL y el rol
// runtime SEPARADO (sin BYPASSRLS), contra una base temporal PROPIA (no toca la
// base de la suite ni ninguna real). Demuestra que:
//   - runWithTenant(A) solo ve/escribe A; runWithTenant(B) solo B;
//   - sin contexto, las tablas protegidas devuelven 0 filas (deny-by-default);
//   - una modificación/eliminación cross-tenant no afecta a la otra empresa;
//   - el contexto es transaction-scoped: no se filtra entre operaciones del pool
//     ni siquiera concurrentes;
//   - runInTenantContext usa el contexto del AsyncLocalStorage.
//
// Requiere un superusuario de Postgres (crear base y rol). Si no está
// disponible, el bloque se salta con un aviso en vez de fallar.

const admin = parseDbUrl(process.env.DATABASE_URL);
const DB = `takto_rls_e2e_${process.pid}`;
const RUNTIME_ROLE = `takto_rls_rt_${process.pid}`;
const RUNTIME_PW = 'rls-e2e-solo-local';

function parseDbUrl(url?: string) {
  const u = new URL(
    url ?? 'postgresql://tehus_user:tehus_pass@localhost:5432/tehus_rattan',
  );
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

const runtimeUrl = () =>
  `postgresql://${RUNTIME_ROLE}:${RUNTIME_PW}@${admin.host}:${admin.port}/${DB}`;

let disponible = true;
let prisma: PrismaClient; // conectado como el rol RUNTIME
let ownerPrisma: PrismaClient; // conectado como el owner (para sembrar)
let companyA: string;
let companyB: string;

describe('RLS — integración con Prisma y rol runtime (e2e, base propia)', () => {
  jest.setTimeout(120_000);

  beforeAll(async () => {
    // 1) Crear base + rol runtime.
    const maint = new Client(admin);
    try {
      await maint.connect();
      await maint.query(`DROP DATABASE IF EXISTS ${DB}`);
      await maint.query(`CREATE DATABASE ${DB}`);
      await maint.query(`DROP ROLE IF EXISTS ${RUNTIME_ROLE}`);
      await maint.query(
        `CREATE ROLE ${RUNTIME_ROLE} LOGIN PASSWORD '${RUNTIME_PW}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
      );
      await maint.end();
    } catch {
      disponible = false;
      await maint.end().catch(() => undefined);
      return;
    }

    const ownerUrl = `postgresql://${admin.user}:${encodeURIComponent(
      admin.password,
    )}@${admin.host}:${admin.port}/${DB}`;

    // 2) Migrar el esquema real (owner) en la base temporal.
    execSync('npx prisma migrate deploy', {
      cwd: join(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: ownerUrl },
      stdio: 'ignore',
    });

    // 3) Aplicar RLS + permisos al rol runtime.
    const owner = new Client({ ...admin, database: DB });
    await owner.connect();
    const rlsSql = readFileSync(
      join(__dirname, '..', 'prisma', 'rls', '001-enable-rls.sql'),
      'utf8',
    );
    await owner.query(rlsSql);
    await owner.query(`GRANT USAGE ON SCHEMA public TO ${RUNTIME_ROLE}`);
    await owner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${RUNTIME_ROLE}`,
    );
    await owner.query(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${RUNTIME_ROLE}`,
    );
    await owner.end();

    // 4) Clientes Prisma: owner (siembra) y runtime (pruebas).
    ownerPrisma = new PrismaClient({
      datasources: { db: { url: ownerUrl } },
    });
    prisma = new PrismaClient({ datasources: { db: { url: runtimeUrl() } } });

    // 5) Sembrar: las empresas (tabla raíz, sin RLS) y contactos por empresa.
    //    `companies` no está en la lista RLS, así que se crean sin contexto.
    const a = await ownerPrisma.company.create({ data: { name: 'RLS-A' } });
    const b = await ownerPrisma.company.create({ data: { name: 'RLS-B' } });
    companyA = a.id;
    companyB = b.id;
    // Los contactos SÍ están bajo RLS/FORCE: se insertan con contexto.
    await runWithTenant(ownerPrisma, companyA, (tx) =>
      tx.contact.create({
        data: { companyId: companyA, name: 'Ana A', phone: '+100000001' },
      }),
    );
    await runWithTenant(ownerPrisma, companyA, (tx) =>
      tx.contact.create({
        data: { companyId: companyA, name: 'Alba A', phone: '+100000002' },
      }),
    );
    await runWithTenant(ownerPrisma, companyB, (tx) =>
      tx.contact.create({
        data: { companyId: companyB, name: 'Ber B', phone: '+100000003' },
      }),
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => undefined);
    await ownerPrisma?.$disconnect().catch(() => undefined);
    if (!disponible) return;
    const maint = new Client(admin);
    await maint.connect();
    await maint.query(`DROP DATABASE IF EXISTS ${DB}`);
    await maint.query(`DROP ROLE IF EXISTS ${RUNTIME_ROLE}`);
    await maint.end();
  });

  const saltaSiNoHay = () => {
    if (!disponible) {
      console.warn('RLS e2e omitido: sin superusuario para crear base/rol.');
    }
    return !disponible;
  };

  it('el rol runtime NO es superuser ni bypassrls', async () => {
    if (saltaSiNoHay()) return;
    const r: Array<{ rolsuper: boolean; rolbypassrls: boolean }> =
      await prisma.$queryRawUnsafe(
        `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = '${RUNTIME_ROLE}'`,
      );
    expect(r[0].rolsuper).toBe(false);
    expect(r[0].rolbypassrls).toBe(false);
  });

  it('runWithTenant(A) solo ve contactos de A; (B) solo de B', async () => {
    if (saltaSiNoHay()) return;
    const a = await runWithTenant(prisma, companyA, (tx) =>
      tx.contact.findMany({ orderBy: { name: 'asc' } }),
    );
    expect(a.map((c) => c.name)).toEqual(['Alba A', 'Ana A']);

    const b = await runWithTenant(prisma, companyB, (tx) =>
      tx.contact.findMany(),
    );
    expect(b.map((c) => c.name)).toEqual(['Ber B']);
  });

  it('sin contexto, las tablas protegidas devuelven 0 filas (deny-by-default)', async () => {
    if (saltaSiNoHay()) return;
    const sin = await prisma.contact.findMany();
    expect(sin).toHaveLength(0);
  });

  it('crear con contexto A queda en A; B no lo ve', async () => {
    if (saltaSiNoHay()) return;
    await runWithTenant(prisma, companyA, (tx) =>
      tx.contact.create({
        data: { companyId: companyA, name: 'Nuevo A', phone: '+100000004' },
      }),
    );
    const vistosPorB = await runWithTenant(prisma, companyB, (tx) =>
      tx.contact.findMany({ where: { name: 'Nuevo A' } }),
    );
    expect(vistosPorB).toHaveLength(0);
  });

  it('una modificación cross-tenant NO afecta a la otra empresa', async () => {
    if (saltaSiNoHay()) return;
    // B intenta renombrar TODOS los contactos que ve (solo los suyos).
    await runWithTenant(prisma, companyB, (tx) =>
      tx.contact.updateMany({ data: { name: 'TOCADO' } }),
    );
    // Los de A siguen intactos.
    const a = await runWithTenant(prisma, companyA, (tx) =>
      tx.contact.findMany({ where: { name: 'TOCADO' } }),
    );
    expect(a).toHaveLength(0);
  });

  it('runInTenantContext usa el contexto del AsyncLocalStorage', async () => {
    if (saltaSiNoHay()) return;
    const a = await TenantContext.ejecutarCon(companyA, () =>
      runInTenantContext(prisma, (tx) => tx.contact.count()),
    );
    const b = await TenantContext.ejecutarCon(companyB, () =>
      runInTenantContext(prisma, (tx) => tx.contact.count()),
    );
    // A tiene al menos 2 (Ana, Alba, Nuevo A); B tiene 1 (Ber). Distintos.
    expect(a).toBeGreaterThan(b);
    expect(b).toBe(1);
  });

  it('contextos concurrentes NO se filtran entre conexiones del pool', async () => {
    if (saltaSiNoHay()) return;
    // Muchas operaciones A y B intercaladas a la vez: cada una debe ver solo lo
    // suyo. Un set_config a nivel de sesión (no transaccional) filtraría aquí.
    const tareas: Promise<{ empresa: string; total: number }>[] = [];
    for (let i = 0; i < 20; i++) {
      tareas.push(
        runWithTenant(prisma, companyA, (tx) => tx.contact.count()).then(
          (total) => ({ empresa: 'A', total }),
        ),
      );
      tareas.push(
        runWithTenant(prisma, companyB, (tx) => tx.contact.count()).then(
          (total) => ({ empresa: 'B', total }),
        ),
      );
    }
    const resultados = await Promise.all(tareas);
    for (const r of resultados) {
      if (r.empresa === 'B') expect(r.total).toBe(1);
      else expect(r.total).toBeGreaterThan(1);
    }
  });
});
