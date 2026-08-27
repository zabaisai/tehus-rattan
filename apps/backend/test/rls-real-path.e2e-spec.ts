import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { AccountThrottleGuard } from '../src/common/throttle/account-throttle.guard';

// Verificación HONESTA de si RLS protege el CAMINO REST REAL (AppModule +
// controller + service + Prisma), con el rol runtime SIN BYPASSRLS y RLS ACTIVO.
//
// RESULTADO ESPERADO (y por qué): los servicios consultan con `this.prisma`
// DIRECTO, sin `runWithTenant`, así que la consulta NO corre dentro de la
// transacción con `set_config('app.company_id', ...)`. Con RLS activo eso
// significa 0 filas (deny-by-default). Esta prueba lo demuestra: con datos
// sembrados para la empresa A, `GET /api/contacts` devuelve VACÍO — la señal de
// que la ADOPCIÓN de RLS en los servicios está PENDIENTE. (El mecanismo en sí
// funciona; ver rls-integration.e2e-spec.ts.)
//
// Requiere superusuario de Postgres. Si no está, se salta con aviso.

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

const admin = parseDbUrl(process.env.DATABASE_URL);
const DB = `takto_rls_rp_${process.pid}`;
const ROLE = `takto_rls_rp_role_${process.pid}`;
const PW = 'rls-rp-solo-local';
const ownerUrl = `postgresql://${admin.user}:${encodeURIComponent(admin.password)}@${admin.host}:${admin.port}/${DB}`;
const runtimeUrl = `postgresql://${ROLE}:${PW}@${admin.host}:${admin.port}/${DB}`;

let disponible = true;
let app: INestApplication;
let token = '';
let companyA = '';

describe('RLS — camino REST REAL con rol runtime (e2e)', () => {
  jest.setTimeout(180_000);

  beforeAll(async () => {
    const maint = new Client(admin);
    try {
      await maint.connect();
      await maint.query(`DROP DATABASE IF EXISTS ${DB}`);
      await maint.query(`CREATE DATABASE ${DB}`);
      await maint.query(`DROP ROLE IF EXISTS ${ROLE}`);
      await maint.query(
        `CREATE ROLE ${ROLE} LOGIN PASSWORD '${PW}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
      );
      await maint.end();
    } catch {
      disponible = false;
      await maint.end().catch(() => undefined);
      return;
    }

    // Migrar como owner.
    execSync('npx prisma migrate deploy', {
      cwd: join(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: ownerUrl },
      stdio: 'ignore',
    });

    const owner = new Client({ ...admin, database: DB });
    await owner.connect();
    // RLS + permisos.
    await owner.query(
      readFileSync(
        join(__dirname, '..', 'prisma', 'rls', '001-enable-rls.sql'),
        'utf8',
      ),
    );
    await owner.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
    await owner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`,
    );
    await owner.query(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`,
    );

    // Sembrar: empresa A (tabla raíz, sin RLS), un ADMIN (users no está en RLS),
    // y contactos de A (con contexto, por WITH CHECK). bcrypt de 'Secreta!123'.
    const hash = await bcrypt.hash('Secreta!123', 10);
    const a = await owner.query(
      `INSERT INTO companies (id, name, slug, status, "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, 'RP-A', 'rp-a', 'ACTIVE', now(), now()) RETURNING id`,
    );
    companyA = a.rows[0].id;
    await owner.query(
      `INSERT INTO users (id, email, name, password, role, "isActive", "companyId", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, 'rp-admin@qa.invalid', 'RP Admin', $1, 'ADMIN', true, $2, now(), now())`,
      [hash, companyA],
    );
    // Contactos de A: con contexto (RLS FORCE exige WITH CHECK al insertar).
    await owner.query(`BEGIN`);
    await owner.query(`SELECT set_config('app.company_id', $1, true)`, [
      companyA,
    ]);
    await owner.query(
      `INSERT INTO contacts (id, "companyId", name, phone, "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, 'Contacto A1', '+100000001', now(), now()),
              (gen_random_uuid()::text, $1, 'Contacto A2', '+100000002', now(), now())`,
      [companyA],
    );
    await owner.query(`COMMIT`);
    await owner.end();

    // Arrancar AppModule REAL apuntando al rol RUNTIME.
    process.env.DATABASE_URL = runtimeUrl;
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET =
      process.env.JWT_SECRET || 'rls-rp-jwt-secret-32-chars-min-xx';
    process.env.QUEUE_ENABLED = 'false';
    process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY =
      process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY || 'rls-rp-enc-key';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      // No prueba rate limiting por cuenta; se desactiva ese guard.
      .overrideGuard(AccountThrottleGuard)
      .useValue({ canActivate: () => true })
      .compile();
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

    // Login del ADMIN de A (tabla users no está bajo RLS → funciona).
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'rp-admin@qa.invalid', password: 'Secreta!123' });
    token = res.body?.token ?? '';
  });

  afterAll(async () => {
    await app?.close().catch(() => undefined);
    if (!disponible) return;
    const maint = new Client(admin);
    await maint.connect();
    await maint.query(`DROP DATABASE IF EXISTS ${DB}`);
    await maint.query(`DROP ROLE IF EXISTS ${ROLE}`);
    await maint.end();
  });

  const salta = () => {
    if (!disponible)
      console.warn('RLS real-path e2e omitido: sin superusuario.');
    return !disponible;
  };

  it('el login del ADMIN funciona (users no está bajo RLS)', () => {
    if (salta()) return;
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  it('EVIDENCIA: GET /api/contacts (service con this.prisma directo) NO ve los datos de A con RLS activo', async () => {
    if (salta()) return;
    const res = await request(app.getHttpServer())
      .get('/api/contacts')
      .set('Authorization', `Bearer ${token}`);
    // El service omite runWithTenant, así que la consulta corre SIN contexto y
    // RLS la bloquea: devuelve VACÍO aunque A tiene 2 contactos sembrados. Esta
    // es la prueba objetiva de que la ADOPCIÓN de RLS en los servicios está
    // PENDIENTE (si estuviera adoptada, aquí verían los 2 de A y nunca los de B).
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });
});
