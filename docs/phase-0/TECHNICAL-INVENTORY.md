# Fase 0 — Inventario técnico

Estado al commit `d42102103a8659969bc886870ce1c7c1ae28d24f` (`origin/main`,
desplegado en staging el 2026-09-01). Verificado el 2026-09-02.

## Repositorio

| Elemento | Valor |
|----------|-------|
| Remoto | `zabaisai/tehus-rattan` (público) |
| Rama desplegada | `main` (`deploy.sh` se niega en otra rama) |
| Rama predeterminada en GitHub | `develop` (obsoleta; cualquier PR de staging debe apuntar a `main`) |
| Monorepo | `apps/backend`, `apps/frontend`, `deploy/`, `docs/` (sin `package.json` raíz) |
| Node requerido | `>=22` en ambas apps |

## Backend (`apps/backend`)

| Elemento | Valor |
|----------|-------|
| Framework | NestJS 11, TypeScript 5.7 |
| ORM / BD | Prisma 6.19, PostgreSQL 16 (16.14 en staging) |
| Cola / realtime | BullMQ 5 + ioredis 5 (Redis 7), Socket.IO 4; worker independiente (`src/worker.ts`) |
| PDF | pdfkit |
| Módulos (`src/modules`) | analytics, assignment, auth, automations, chatbot, companies, compliance, contacts, conversations, custom-fields, flowbot, invitation-codes, leads, mail, messages, notes, notifications, onboarding, pipeline, platform, products, quotes, search, sessions, tasks, users, webhook, whatsapp, whatsapp-history, whatsapp-integration |
| Tamaño | 37 controladores, 78 servicios, 135 archivos `*.spec.ts`, 65 archivos e2e (`test/`) |
| Scripts relevantes | `test`, `test:e2e`, `lint`, `typecheck`, `build`, `platform:create-super-admin`, `demo:*`, `whatsapp:encrypt-token` |

### Modelo de datos (Prisma, 58 tablas)

- Todas las tablas usan `@@map` a snake_case; las columnas conservan
  camelCase (deben citarse con comillas dobles en SQL).
- Tenant: `companies` (`status` ACTIVE/SUSPENDED/DELETED, `isDemo`, `slug`,
  `settings` Json, colores, logos, `businessType`, `timezone`, `currency`,
  `locale`, fiscalidad, retención). Casi todas las entidades llevan
  `companyId`; `users.companyId` es nullable solo para SUPER_ADMIN.
- Configuración por tenant adicional: `company_lead_settings` (1:1,
  pipeline/etapa por defecto, asignación, aprobación de tareas),
  `custom_field_definitions`, `flowbot_settings`, `notification_preferences`.
- Pipeline: `pipelines` (`isDefault`, `order`, `isArchived`) →
  `pipeline_stages` (`order`, `isInitial`, `type` OPEN/WON/LOST, `probability`,
  `color`). `leads.status` OPEN/WON/LOST se mantiene aparte del tipo de etapa.
- Catálogo: `products.category` es texto libre nullable; **no existe modelo
  de categoría** ni tabla de categorías por empresa.
- Onboarding: `invitation_codes` (hash + preview, estados ACTIVE/USED/REVOKED).
- 58 migraciones; la última fechada 2026-08-18.

## Frontend (`apps/frontend`)

| Elemento | Valor |
|----------|-------|
| Framework | Next.js 16.2, React 19.2, TypeScript 5, Tailwind 4, TanStack Query 5 |
| Pruebas | vitest 4, 88 archivos `*.test.ts(x)` |
| Rutas (`app/`) | `/login`, `/forgot-password`, `/reset-password`, `/onboarding`, `/dashboard` y subrutas: automations, chatbot, contacts(/[id]), conversations, documents/calculator, flowbots (lista, [id], edit, executions, versions, new, templates), notifications, pipeline, platform (activity, audit-logs, companies, deletion-requests, invitation-codes), products, quotes(/[id]/print), settings (company, data, notifications, whatsapp), tasks |

## Despliegue (`deploy/`, staging)

| Elemento | Valor |
|----------|-------|
| Compose | `docker-compose.staging.yml`, proyecto `tehus-crm-staging`; servicios postgres, redis, backend, frontend, worker, caddy; redes `proxy`/`internal`; volúmenes `postgres_data`, `redis_data`, `backend_uploads`, `caddy_data`, `caddy_config` |
| Proxy | Caddy 2 con dos hosts públicos (frontend y API) bajo el dominio del tenant |
| Ruta en el VPS | `/opt/tehus-crm`, usuario `deploy` |
| Deploy | manual por SSH: `deploy/scripts/deploy.sh` (pull ff-only de `main`, rebuild, backup pre-migración, `migrate deploy`, `up -d`, health check) |
| Salud | `deploy/scripts/health-check.sh` (contenedores, `/api/health`, `/ready`, `/status`, `/queue`, HTTPS público) y `smoke-test.sh` |
| Variables (nombres) | `deploy/env/staging.env.example` (POSTGRES_*, DATABASE_URL, JWT_SECRET, WHATSAPP_*, THROTTLE_*, FRONTEND_URL, CSRF_ALLOWED_ORIGINS, ONBOARDING_INVITE_CODE, SUPER_ADMIN_*, SMTP_*, PASSWORD_RESET_*, NEXT_PUBLIC_*, REDIS_*) y `deploy/env/backup.env.example` |
| Secretos en el VPS | `.env.staging`, `.env.backup`, `.secrets/restic-password`, `.secrets/rclone.conf`: todos `600 deploy:deploy` e ignorados por Git |

### Respaldo

| Capa | Mecanismo | Estado observado 2026-09-02 |
|------|-----------|-----------------------------|
| Local diario | `backup-postgres.sh` (pg_dump gzip + tar de `backend_uploads`, sidecars SHA-256, publicación atómica, retención 7 días), ejecutado dentro de `tehus-backup.service` | Funciona; el cron `0 3 * * *` redundante se retiró el 2026-09-02 (copia en `.secrets`) |
| Verificación | `backup-verify.sh` (checksum + gzip, sin tocar BD) | Funciona |
| Restauración | `restore-postgres.sh` (checksum obligatorio, `--target-db`, `--replace-target`, ON_ERROR_STOP, nunca automático) y `restore-uploads.sh` | Funciona; bit de ejecución corregido en PR #16 (B-03) |
| Off-site cifrado | `backup-offsite.sh` → Restic sobre rclone (Google Drive), retención 7/4/6, heartbeat | Operativo desde 2026-09-02: remote con OAuth de mínimo privilegio `drive.file`, repositorio `TAKTO_BACKUPS_V2/staging`, primer backup cifrado y `restic check` OK vía `tehus-backup.service`; el repositorio anterior queda como histórico de solo lectura vía un remote separado |
| Drill mensual | `backup-restore-drill.sh` (restic check --read-data, restore latest, restauración a `tehus_restore_drill`, limpieza) | Ejecutado con éxito el 2026-09-02 vía `tehus-backup-drill.service` (`check --read-data`, restore, base reservada creada y eliminada) |
| systemd | `tehus-backup.{service,timer}`, `tehus-backup-drill.{service,timer}`, `tehus-backup-init.service` | Instalados; timers `enabled`/`active (waiting)` desde 2026-09-02: backup diario 03:00 Colombia (08:00 UTC), drill día 1 de cada mes 04:30–04:45 Colombia (09:30–09:45 UTC) |
| Pruebas | `deploy/tests/backup-safety.test.sh` | PASS local |

Hallazgo de permisos (B-02, corregido en PR #16): el tarball de uploads se
creaba vía `docker run` como root y el `chmod 600` posterior fallaba, dejándolo
`644 root:root` dentro de un directorio `700 deploy:deploy`. Ahora el contenedor
lo entrega al usuario invocante y el script falla cerrado si no es su dueño.

Modos de archivo: desde PR #16 todos los scripts alcanzados desde una unidad
systemd son `100755` (prueba de regresión en `backup-safety.test.sh`);
`deploy.sh`, `health-check.sh`, `restore-uploads.sh`, `rollback-code.sh` y
`smoke-test.sh` siguen `100644` (en el VPS conservan su bit local).

## Dependencias globales de un tenant

Valores de Tehus o del negocio de muebles que hoy están fijados en el código
o en la infraestructura y aplican a todas las empresas:

| Ámbito | Ubicación | Valor fijado | Efecto |
|--------|-----------|--------------|--------|
| Catálogo | `apps/frontend/src/lib/products.ts` → `PRODUCT_CATEGORIES` | Salas, Comedores, Sillas, Lámparas, Accesorios, Columpios, Asoleadoras, Zonas húmedas | Filtro de la página de productos y selector del modal de producto para todos los tenants, aunque su catálogo esté vacío |
| Onboarding | `components/onboarding/steps/CommercialStep.tsx` → `SUGGESTED_CATEGORIES` | Las 8 anteriores + Proyectos personalizados | Sugerencias de categorías a cualquier empresa nueva |
| Onboarding | `app/onboarding/page.tsx` | Etapas por defecto: Nuevo lead, Contactado, Asesoría en proceso, Cotización, Seguimiento, Cerrado ganado, Cerrado perdido; pipeline "Ventas" | Plantilla única de pipeline; las etapas se crean sin `type` WON/LOST ni `isInitial` |
| Onboarding | `app/onboarding/page.tsx` | Colores por defecto `#A57014`, `#FDDC7F`, `#FAF8F3` | Coinciden con los colores de marca guardados de un tenant existente |
| Catálogo | `components/products/ProductModal.tsx` | Placeholder "Sala Primavera" | Texto de ejemplo de muebles |
| Settings | `onboarding.service.ts` guarda `settings.categories` | — | El frontend nunca lee `Company.settings.categories`; el catálogo usa la lista fija |
| Auth | `lib/axios.ts` → `CROSS_TAB_LOCK = 'tehus-auth-refresh'` | Nombre de lock | Solo cosmético |
| Infra | Caddyfile, `docker-compose.staging.yml` (`name: tehus-crm-staging`), nombres de artefactos `tehus-crm-staging-*`, `RESTIC_HOST`, unidades `tehus-*`, ruta `/opt/tehus-crm`, nombre de base `tehus_crm_staging`, patrón `tehus_restore_drill` | Dominio y nombres del tenant | Renombrar implica migración operativa; no bloquea la separación funcional |
| Datos | `Company.settings` v1 solo tiene `sellsProducts`, `sellsServices`, `usesCatalog`, `usesQuotes`, `usesTasks`, `categories` | — | No hay lugar para vertical/plantilla ni para categorías efectivas |

## Pendientes de inventario (sin evidencia en esta sesión)

- Conteo de pruebas unitarias/e2e en ejecución (se cuentan archivos, no se
  ejecutaron las suites en esta sesión).
- QA visual por módulo y por viewport: PENDIENTE para la Fase 1.
