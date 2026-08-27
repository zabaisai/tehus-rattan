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

## Prueba local (ya ejecutada)

`node prisma/rls/proof.mjs` demuestra, con un rol runtime **sin BYPASSRLS**:

- contexto empresa A ⇒ solo ve/inserta filas de A;
- contexto empresa B ⇒ solo las de B;
- **sin contexto ⇒ 0 filas** (deny-by-default / fail-closed);
- `WITH CHECK` ⇒ no se puede insertar una fila de otra empresa;
- el contexto es transaction-scoped ⇒ no se filtra entre peticiones del pool.

## El ÚNICO bloqueo real para activarlo

Hoy `DATABASE_URL` usa **un solo rol** que es a la vez propietario de las tablas,
usuario de migración y usuario runtime. El propietario **omite** RLS (por eso
usamos `FORCE`, que lo somete), pero para que el modelo sea correcto el runtime
debe ser un rol **separado, sin BYPASSRLS y sin propiedad de tablas**. Crear ese
rol y repuntar `DATABASE_URL` es un cambio de infraestructura sobre la base real,
fuera del alcance de esta sesión (no se ejecutan cambios contra bases reales).

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
