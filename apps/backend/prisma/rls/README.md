# Row-Level Security (RLS) para TAKTO — diseño ejecutable

Estado: **preparado y probado localmente, NO activado en la app**. El único
bloqueo real para activarlo es de infraestructura: separar el rol de base de
datos (ver abajo). Nada de esto se aplica automáticamente ni toca la base real.

## Qué hay aquí

| Archivo | Qué es |
|---------|--------|
| `000-create-runtime-role.sql.example` | Script del DBA para crear el rol runtime `takto_app` (sin superuser, sin BYPASSRLS, sin propiedad de tablas). |
| `001-enable-rls.sql` | SQL idempotente que activa `ENABLE`+`FORCE ROW LEVEL SECURITY` y una política `tenant_isolation` por `companyId` en las 37 tablas multiempresa (companyId NOT NULL). Generado desde `schema.prisma`. |
| `proof.mjs` | Prueba EJECUTABLE: crea su propia base temporal aislada y un rol runtime real, aplica RLS y demuestra el aislamiento. `node prisma/rls/proof.mjs`. |
| `../../src/prisma/tenant-context.ts` | Helper `runWithTenant()` que fija `app.company_id` **transaction-scoped** (`set_config(..., true)`), imprescindible para no filtrar la empresa entre conexiones del pool. |

## Integración en la aplicación (código presente y probado localmente)

- `src/prisma/tenant-context.storage.ts` — `TenantContext` (AsyncLocalStorage)
  con la empresa de la petición/operación.
- `src/prisma/tenant-context.interceptor.ts` — `TenantContextInterceptor`
  (APP_INTERCEPTOR) que fija el contexto desde `req.user.companyId` en cada
  request. Los caminos de sistema (jobs BullMQ, worker, WebSocket, tareas
  programadas) fijan el contexto explícitamente alrededor de su trabajo con
  `TenantContext.ejecutarCon(...)` / `ejecutarComoSistema(...)`.
- `runWithTenant(prisma, companyId, fn)` y `runInTenantContext(prisma, fn)`
  (lee del ALS) ejecutan el acceso a datos dentro de una transacción con
  `set_config('app.company_id', ..., true)` — **transaction-scoped**, sin fuga
  entre conexiones del pool.

## Pruebas locales (ya ejecutadas, en verde)

- `node prisma/rls/proof.mjs` — prueba a nivel SQL con un rol runtime sin
  BYPASSRLS.
- `test/rls-integration.e2e-spec.ts` — prueba de INTEGRACIÓN con el **cliente
  Prisma real** y el rol runtime, contra una base temporal propia con RLS
  activo. Demuestra:
  - `runWithTenant(A)` solo ve/escribe A; `(B)` solo B;
  - **sin contexto ⇒ 0 filas** (deny-by-default);
  - una modificación cross-tenant NO afecta a la otra empresa;
  - `runInTenantContext` usa el contexto del AsyncLocalStorage;
  - contextos **concurrentes** intercalados no se filtran entre conexiones del
    pool (20×A y 20×B a la vez, cada uno ve solo lo suyo);
  - el rol runtime NO es superuser ni bypassrls.

## El ÚNICO bloqueo real para activarlo en un entorno real

El código de integración y las pruebas están; lo que falta es de infraestructura
y no puede hacerse contra bases reales en esta sesión:

1. Crear el rol runtime separado (`deploy/rls/init-runtime-role.sql.example`) y
   repuntar el `DATABASE_URL` del backend/worker a él, dejando las migraciones
   con el rol propietario.
2. Aplicar `001-enable-rls.sql`.
3. Adoptar el contexto de empresa en el acceso a datos de negocio (usar
   `runInTenantContext`/`runWithTenant` en los servicios, o un `$extends` de
   Prisma que envuelva las operaciones). El interceptor ya fija el contexto por
   petición; los servicios aún consultan con el cliente Prisma directo, así que
   la ADOPCIÓN en cada servicio es el último paso.

Hoy `DATABASE_URL` usa **un solo rol** (propietario = migración = runtime). El
propietario omite RLS salvo `FORCE`; el runtime debe ser un rol separado sin
BYPASSRLS ni propiedad de tablas.

## Pasos para activarlo (en tu infraestructura)

1. DBA: ejecutar `000-create-runtime-role.sql.example` (con una contraseña real
   fuera del repo) para crear `takto_app`.
2. Apuntar el `DATABASE_URL` del **backend y del worker** a `takto_app`. Dejar
   las migraciones (`prisma migrate deploy`) con el rol **propietario**.
3. **Antes** de aplicar RLS: adoptar `runWithTenant()` en el acceso a datos de
   negocio, de modo que cada petición fije `app.company_id`. Sin esto, con RLS
   activo toda consulta devuelve 0 filas.
4. Caminos de sistema legítimamente cross-tenant (dispatcher del outbox,
   barridos de SLA, limpiezas programadas): darles un rol con `BYPASSRLS`
   dedicado **o** fijar el contexto por operación. `esCaminoDeSistema()` marca en
   el código dónde ocurre esa excepción.
5. Aplicar `001-enable-rls.sql`.
6. Repetir la prueba de aislamiento con el rol runtime real contra una copia.

RLS es una **segunda barrera**: los filtros de aplicación por `companyId` NO se
retiran.
