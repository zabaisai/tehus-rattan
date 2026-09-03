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
| 6 | Dominios y autenticación | HECHA — cookies/canales con fallback legacy, Caddy, variables y DNS de staging verificados bajo `takto.online` |
| 7 | Pruebas | HECHA en local — ver `STAGING-EVIDENCE.md` (conteos, QA visual 320–1440 px, auditoría final); e2e de backend en CI |
| 8 | PR | HECHA — PR #18 fusionado en `main` (merge `5cb991f`, 2026-09-03 21:17 UTC) con CI verde en el HEAD `d662bd4` |
| 9 | Staging | HECHA — DNS creado por el propietario y verificado; `.env.staging` actualizado con copia `600`; `deploy.sh` sobre `5cb991f`; certificados emitidos para los dos dominios nuevos; health 12/12, smoke 22/22 (ver `STAGING-EVIDENCE.md`) |
| 10 | QA en staging | HECHA — genérica / muebles / veterinaria con códigos `TAKTO`, cookies `takto_*`, fallback legacy, aislamiento, realtime; datos `QA_PHASE1_` eliminados por ID, cero residuos, huellas de datos existentes intactas |
| 11 | Documentación y cierre | HECHA — este documento y `STAGING-EVIDENCE.md` (PR documental de cierre) |

Revisión correctiva previa al DNS (2026-09-03): contraseñas del onboarding
alineadas con la política del backend, escritura de `settings` solo tipada
(`PATCH /companies/me` la rechaza) y tipo de negocio definido una sola vez
(plantilla canónica o descripción manual). Detalle en `STAGING-EVIDENCE.md`.

Estado de la fase: **FASE 1 CERRADA — PASS** (2026-09-03). Producción NO
desplegada: `crm.takto.online` / `api.crm.takto.online` siguen sin DNS, sin
certificados y sin stack; solo existen los ejemplos.

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
  monitorizado bajo `takto.online` cuando el propietario lo confirme. No se
  inventa ni activa un buzón que no existe.
- Inicio de sesión único tras el cambio de host: las cookies son host-only
  en el host de la API, así que cada usuario existente inicia sesión una vez
  en `crm-staging.takto.online` (las sesiones del servidor no se pierden).
- El Caddyfile se monta como archivo único (bind mount): tras un `git pull`
  que lo reemplace, `caddy reload` responde «config is unchanged» porque el
  contenedor conserva el inodo antiguo; hay que recrear el contenedor
  (`compose up -d --force-recreate --no-deps caddy`, segundos de corte).
  Ocurrió en este despliegue; documentado en `DOMAIN-MIGRATION.md` y
  `ROLLBACK.md`. Conviene montar el directorio en lugar del archivo.
- `deploy.sh`, `health-check.sh` y `smoke-test.sh` estaban rastreados como
  `100644` (deuda anterior a la fase): el checkout de Fase 1 les quitó el bit
  local y el paso 11 de `deploy.sh` falló con «Permission denied» con la pila
  sana. Corregido en `main` por el PR #19 (`d262ce8`, solo modo de archivo); el
  VPS lo recibe en su próximo `git pull`.
- e2e intermitente en CI: `flowbot-vertical.e2e-spec` caso 27 («dos mensajes
  concurrentes no duplican nada») falló una vez en el PR #19 (cambio solo de
  modo) y pasó al relanzar; misma clase que el caso de `contact-fusion`.
- `docs/CRM_ROADMAP.md` es un roadmap histórico "Tehus-first" anterior a esta
  fase; conviene reemplazarlo por un roadmap de plataforma.
