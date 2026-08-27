# Acciones humanas requeridas — Endurecimiento de seguridad TAKTO

Estas son las únicas cosas que este trabajo NO pudo hacer de forma segura en
local. Ordenadas por prioridad. Nada de lo de abajo se ejecutó.

---

## P0 — Rotar el token de acceso de Meta (WhatsApp) legacy

- **Qué:** en `apps/backend/.env` (archivo LOCAL, **no** versionado y **no** en
  el historial Git) vivía comentado un token de acceso de Meta de la integración
  monoempresa antigua. Se eliminó del archivo durante este trabajo.
- **Por qué es P0:** aunque nunca estuvo en Git, es una credencial real que pudo
  quedar en copias locales, backups de disco o historiales de shell.
- **Acción:** en Meta App Dashboard, **revocar/rotar** ese token de acceso. No es
  necesario reescribir el historial Git (el token no está ahí; gitleaks sobre
  `--all` lo confirma). No publiques la rama hasta rotarlo si consideras que
  sigue vigente.
- **Identificación (sin valor):** tipo = User/System access token de Meta;
  archivo = `apps/backend/.env` (local); estaba en una línea comentada
  `# WHATSAPP_TOKEN=EAAW...` que ya no existe.

## P1 — Separar el rol de PostgreSQL y activar Row-Level Security (control 4)

- **Qué:** hoy `DATABASE_URL` usa un único rol que es a la vez propietario de
  tablas, usuario de migración y usuario runtime. Un propietario **omite** RLS,
  así que activar políticas sin separar roles sería teatro.
- **Acción (en tu infraestructura, no en esta sesión):**
  1. Crear un rol `takto_app` para el runtime: `NOSUPERUSER`, sin `BYPASSRLS`,
     sin propiedad de tablas, con solo `SELECT/INSERT/UPDATE/DELETE`.
  2. Mantener un rol separado (propietario) para `prisma migrate deploy`.
  3. Apuntar el `DATABASE_URL` del backend/worker a `takto_app`.
  4. Migración aditiva (revisable) que active `ENABLE ROW LEVEL SECURITY` +
     `FORCE ROW LEVEL SECURITY` y políticas por empresa usando
     `current_setting('app.company_id', true)`, fijado por petición de forma
     transaction-scoped (`set_config('app.company_id', $id, true)`), más un
     `$extends` de Prisma que establezca ese contexto en cada transacción.
     Incluir backend, worker, jobs, analytics y exportaciones.
  5. Pruebas con el rol runtime real demostrando que empresa A no lee/escribe
     datos de B y que el contexto no se filtra entre conexiones del pool.
- Los filtros de aplicación por `companyId` NO se retiran: RLS es una segunda
  barrera.

## P2 — Antibot (control 12)

- **Qué:** no hay proveedor antibot. Decisión de producto + claves externas.
- **Acción:** elegir proveedor (Cloudflare Turnstile recomendado), crear la
  cuenta y las claves (site key pública en frontend, secret solo en backend),
  y activar el reto en login/registro tras señales de abuso. La integración debe
  ser fail-closed con adaptador falso explícito en local/tests. No conectes
  claves reales al repositorio; guárdalas como variables de entorno.

## P2 — Rate limiting distribuido con Redis (control 11)

- **Qué:** el throttler es en memoria por proceso; con varias réplicas los
  límites se multiplican. Redis ya está en el stack.
- **Acción:** configurar el store Redis de `@nestjs/throttler`
  (`@nest-lab/throttler-storage-redis` o equivalente) reutilizando la conexión
  existente. Es un cambio contenido pero toca el arranque; se dejó fuera para no
  arriesgar el comportamiento de arranque sin poder probarlo contra el stack real
  multi-réplica.

---

## Deudas menores documentadas (no bloquean; mejoras futuras)

- Guard global de auth con `@Public()` (control 6): hoy la auth es opt-in por
  controlador; un controlador nuevo nace público.
- Detección de reutilización de refresh token (control 9).
- KDF con sal + versión de clave para el cifrado de tokens (control 5).
- Firma ZIP/OOXML en el import de productos y servido autenticado de `/uploads`
  por empresa (control 16).
- Tope `take` por defecto en listados sin paginar (control 17).
- TLS PostgreSQL (`sslmode=require`) al mover Postgres fuera del host (control 19).
- Subir coste bcrypt a 12 con rehash progresivo (control 10).
- Altas de dependencias (sharp/libvips, cadena del CLI de Prisma) — se resuelven
  vía Dependabot cuando haya versión compatible (control 20).
