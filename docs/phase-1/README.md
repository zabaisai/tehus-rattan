# Fase 1 — Independencia de plataforma TAKTO

TAKTO es el propietario y la marca del CRM multiempresa. Tehus Rattan es una
empresa cliente dedicada a muebles. La Fase 1 separa ambas cosas en el
producto: identidad visible, nombres técnicos nuevos, códigos de invitación,
onboarding por industria y dominios de staging bajo `takto.online`.

Rama: `feature/phase-1-takto-platform-independence` (desde `origin/main`
`7b7aae8`). Worktree aislado; el worktree principal y su archivo ajeno
(`deploy/scripts/send-demo-template.mjs`) no se tocan.

## Documentos

| Documento | Contenido |
|---|---|
| [TEHUS-TAKTO-AUDIT.md](TEHUS-TAKTO-AUDIT.md) | Inventario clasificado de referencias Tehus/muebles y acción por grupo |
| [IDENTITY-CONTRACT.md](IDENTITY-CONTRACT.md) | Plataforma, marca por defecto, tenant Tehus, dominios, infraestructura congelada |
| [ONBOARDING-CONTRACT.md](ONBOARDING-CONTRACT.md) | Plantillas versionadas, jerarquía industria → tipo → módulos → categorías → pipeline, settings v2 |
| [DOMAIN-MIGRATION.md](DOMAIN-MIGRATION.md) | DNS, Caddy/TLS, variables, CORS/CSRF/CSP, convivencia con dominios antiguos, producción pendiente |
| [ROLLBACK.md](ROLLBACK.md) | Cómo volver atrás cada bloque sin tocar datos |
| [STAGING-EVIDENCE.md](STAGING-EVIDENCE.md) | Evidencia sanitizada de pruebas, CI, despliegue y QA |

## Plan y estado

| # | Etapa | Estado |
|---|---|---|
| 1 | Auditoría | HECHA — `TEHUS-TAKTO-AUDIT.md` |
| 2 | Contrato funcional | HECHA — `IDENTITY-CONTRACT.md`, `ONBOARDING-CONTRACT.md` |
| 3 | Identidad TAKTO | HECHA — README, ejemplos de entorno, placeholders, docs operativas |
| 4 | Invitaciones | HECHA — prefijo `TAKTO`, códigos `TEHUS` válidos por hash y estado |
| 5 | Onboarding | HECHA — plantillas en código, endpoint público, settings v2, categorías conectadas al catálogo |
| 6 | Dominios y autenticación | HECHA en código — cookies/canales con fallback legacy, Caddy y variables preparadas; **DNS pendiente** |
| 7 | Pruebas | HECHA en local — ver `STAGING-EVIDENCE.md` (conteos, QA visual 320–1440 px, auditoría final); e2e de backend en CI |
| 8 | PR | ABIERTO — PR contra `main`; estado de CI en el PR |
| 9 | Staging | BLOQUEADA — los registros DNS de staging no existen y no hay acceso autenticado al DNS de `takto.online` (registros exactos en `DOMAIN-MIGRATION.md` § Registros DNS). Sin merge ni despliegue |
| 10 | QA en staging | PENDIENTE — depende de 9 |
| 11 | Documentación y cierre | PENDIENTE — la fase no se cierra sin 9 y 10 |

Revisión correctiva previa al DNS (2026-09-03): contraseñas del onboarding
alineadas con la política del backend, escritura de `settings` solo tipada
(`PATCH /companies/me` la rechaza) y tipo de negocio definido una sola vez
(plantilla canónica o descripción manual). Detalle en `STAGING-EVIDENCE.md`.

Estado de la fase: **FASE 1 PERMANECE ABIERTA** (bloqueador: DNS de staging).
Última actualización: 2026-09-03.

## Fuera de alcance (no realizado)

Producción (DNS, certificados, despliegue), cuentas reales de Meta/WhatsApp,
Google Cloud y backups, renombrar el repositorio GitHub, `/opt/tehus-crm`,
`tehus_crm_staging`, volúmenes, servicios `tehus-backup*`, host histórico de
Restic, repositorios Restic, datos comerciales de Tehus, eliminación de
dominios antiguos, editor de plantillas en Super Admin. Asahel y Cristian no
participaron.

## Deuda técnica registrada

- Nombres internos de infraestructura (`tehus-*`, `/opt/tehus-crm`,
  `tehus_crm_staging`, `tehus-crm-staging`, `RESTIC_HOST`): congelados; ver
  `IDENTITY-CONTRACT.md` § Infraestructura congelada.
- `apps/backend/src/generated/prisma/*` está rastreado en Git pese a estar en
  `.gitignore`, con rutas absolutas de una máquina de desarrollo. Limpiar en
  una fase de mantenimiento (regenerar y dejar de rastrear).
- Fallbacks legacy de autenticación (`tehus_refresh_token`, `tehus_device_id`,
  canal `tehus-auth`): retirar cuando se cumpla el criterio de
  `IDENTITY-CONTRACT.md` § Retiro del fallback.
- Contacto ACME de Caddy (`admin@tehusrattan.com`): cambiar a un buzón
  monitorizado bajo `takto.online` cuando el propietario lo confirme.
- `docs/CRM_ROADMAP.md` es un roadmap histórico "Tehus-first" anterior a esta
  fase; conviene reemplazarlo por un roadmap de plataforma.
