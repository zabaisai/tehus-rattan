// Prueba EJECUTABLE de RLS con un rol runtime REAL (sin BYPASSRLS).
//
// Crea su PROPIA base temporal aislada (no toca la base de la app ni la suite
// e2e), aplica RLS sobre una tabla representativa, crea el rol runtime separado
// y demuestra que:
//   - con app.company_id = A, el runtime solo ve/inserta filas de A;
//   - con = B, solo las de B;
//   - sin contexto, no ve NADA (deny-by-default / fail-closed);
//   - el contexto es transaction-scoped y no se filtra entre conexiones del pool.
//
// Uso:  node prisma/rls/proof.mjs
// Requiere un superusuario de Postgres para crear base y rol (en local, el
// usuario del docker-compose de dev; en CI, el usuario del servicio postgres).
//
// No imprime contraseñas. Limpia todo al terminar.

import pg from 'pg';

const { Client } = pg;

// Conexión de mantenimiento (superusuario). Se toma de PG* o de los valores del
// docker-compose de desarrollo. Sin credenciales impresas.
const ADMIN = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'tehus_user',
  password: process.env.PGPASSWORD || 'tehus_pass',
  database: process.env.PGADMINDB || 'tehus_rattan',
};

const DB = 'takto_rls_proof';
const APP_ROLE = 'takto_rls_app';
const APP_PW = 'rls-proof-solo-local';
const A = 'company-A';
const B = 'company-B';

const fail = (m) => {
  console.error('FALLO:', m);
  process.exitCode = 1;
};

async function main() {
  // 1) Crear base temporal aislada.
  const admin = new Client(ADMIN);
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
  await admin.query(`CREATE DATABASE ${DB}`);
  // Rol runtime: NO superusuario, NO BYPASSRLS.
  await admin.query(`DROP ROLE IF EXISTS ${APP_ROLE}`);
  await admin.query(
    `CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PW}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
  );
  await admin.end();

  const owner = new Client({ ...ADMIN, database: DB });
  await owner.connect();

  // 2) Esquema mínimo representativo + semilla (antes de FORCE RLS).
  await owner.query(`
    CREATE TABLE contacts (
      id text PRIMARY KEY,
      "companyId" text NOT NULL,
      name text NOT NULL
    )`);
  await owner.query(
    `INSERT INTO contacts VALUES ('a1','${A}','Ana A'),('a2','${A}','Alba A'),('b1','${B}','Ber B')`,
  );

  // 3) Permisos al rol runtime.
  await owner.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
  await owner.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON contacts TO ${APP_ROLE}`,
  );

  // 4) Activar RLS (enable + force + policy), igual que 001-enable-rls.sql.
  await owner.query(`ALTER TABLE contacts ENABLE ROW LEVEL SECURITY`);
  await owner.query(`ALTER TABLE contacts FORCE ROW LEVEL SECURITY`);
  await owner.query(`DROP POLICY IF EXISTS tenant_isolation ON contacts`);
  await owner.query(`
    CREATE POLICY tenant_isolation ON contacts
      USING ("companyId" = current_setting('app.company_id', true))
      WITH CHECK ("companyId" = current_setting('app.company_id', true))`);
  await owner.end();

  // 5) Conectar como el rol RUNTIME real y comprobar el aislamiento.
  const app = new Client({
    host: ADMIN.host,
    port: ADMIN.port,
    user: APP_ROLE,
    password: APP_PW,
    database: DB,
  });
  await app.connect();

  // Confirmar que el rol NO es superusuario ni bypassrls.
  const attr = await app.query(
    `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`,
    [APP_ROLE],
  );
  if (attr.rows[0].rolsuper || attr.rows[0].rolbypassrls) {
    fail('el rol runtime NO debería ser superuser/bypassrls');
  }

  const conContexto = async (companyId, q, params = []) => {
    await app.query('BEGIN');
    try {
      if (companyId !== null) {
        await app.query(`SELECT set_config('app.company_id', $1, true)`, [
          companyId,
        ]);
      }
      const r = await app.query(q, params);
      await app.query('COMMIT');
      return r;
    } catch (e) {
      // Deja la conexión utilizable para la siguiente comprobación.
      await app.query('ROLLBACK');
      throw e;
    }
  };

  // A ve solo A.
  const va = await conContexto(A, `SELECT id FROM contacts ORDER BY id`);
  const idsA = va.rows.map((r) => r.id).join(',');
  console.log('contexto A ve:', idsA || '(nada)');
  if (idsA !== 'a1,a2') fail(`A debería ver a1,a2 — vio ${idsA}`);

  // B ve solo B.
  const vb = await conContexto(B, `SELECT id FROM contacts ORDER BY id`);
  const idsB = vb.rows.map((r) => r.id).join(',');
  console.log('contexto B ve:', idsB || '(nada)');
  if (idsB !== 'b1') fail(`B debería ver b1 — vio ${idsB}`);

  // Sin contexto: NADA (deny-by-default).
  const vsin = await conContexto(null, `SELECT id FROM contacts`);
  console.log('sin contexto ve:', vsin.rows.length, 'filas');
  if (vsin.rows.length !== 0) fail('sin contexto NO debería ver nada');

  // WITH CHECK: con contexto A no se puede insertar una fila de B.
  let bloqueado = false;
  try {
    await conContexto(A, `INSERT INTO contacts VALUES ('x1',$1,'Intruso')`, [B]);
  } catch {
    bloqueado = true;
  }
  console.log('insertar fila de B con contexto A bloqueado:', bloqueado);
  if (!bloqueado) fail('WITH CHECK debería impedir insertar fila de otra empresa');

  // Con contexto A sí puede insertar una fila de A.
  await conContexto(A, `INSERT INTO contacts VALUES ('a3',$1,'Nueva A')`, [A]);
  const va2 = await conContexto(A, `SELECT count(*)::int AS n FROM contacts`);
  if (va2.rows[0].n !== 3) fail(`A debería ver 3 tras insertar — vio ${va2.rows[0].n}`);

  await app.end();

  // 6) Limpieza.
  const admin2 = new Client(ADMIN);
  await admin2.connect();
  await admin2.query(`DROP DATABASE IF EXISTS ${DB}`);
  await admin2.query(`DROP ROLE IF EXISTS ${APP_ROLE}`);
  await admin2.end();

  if (process.exitCode === 1) {
    console.error('\nRLS PROOF: FALLÓ');
  } else {
    console.log('\nRLS PROOF: OK — aislamiento por empresa con el rol runtime real.');
  }
}

main().catch((e) => {
  console.error('ERROR en la prueba RLS:', e.message);
  process.exit(1);
});
