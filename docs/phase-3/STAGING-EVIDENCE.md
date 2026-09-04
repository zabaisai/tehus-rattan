# Fase 3 — Evidencia

Estado: **PASS** (2026-09-04). Todo lo que sigue son resultados reales: pruebas
locales, CI, despliegue oficial en staging, QA funcional de cuatro industrias
con datos temporales eliminados por ID y comparación antes/después. Sin
secretos, sin IDs completos, sin códigos de invitación, sin correos reales.

## Contexto

- Base: `origin/main` `7630b61` (2026-09-04). Rama `feat/phase-3-guided-onboarding`.
- Runtime de staging al empezar: `547f31f` (Fase 2). Producción: no existe
  (`crm.takto.online` y `api.crm.takto.online` sin registro DNS; no se tocan).
- Merge de implementación: PR #24 → `main` `4d457df` (merge commit, estándar del repo).

## Pruebas (local, worktree de la fase)

Mismos comandos que `.github/workflows/ci.yml` (Windows 11, Node 24):

| Ámbito | Comprobación | Resultado |
| --- | --- | --- |
| Backend | `prisma validate`, typecheck, lint | OK, 0 errores |
| Backend | Unitarias (`--runInBand`) | 147/147 suites, 2415/2415 pruebas |
| Backend | Build (`nest build`) | OK |
| Backend | E2E con PostgreSQL y Redis reales (`--runInBand`) | 70/70 suites, 1039/1039 pruebas (nueva suite HTTP `onboarding-guiado`: 34 casos) |
| Frontend | typecheck, lint | OK (0 errores; 2 avisos previos a la fase) |
| Frontend | Vitest | 107/107 ficheros, 1081/1081 pruebas |
| Frontend | `next build` | OK |
| Prisma | Migraciones | **ninguna** |

QA local con el producto levantado: ver `TEST-MATRIX.md` § QA local.

## Seguridad del diff

- Búsqueda de secretos en el diff (contraseñas, tokens, cadenas `TAKTO-`/`TEHUS-`
  completas, `.env`): sin hallazgos. Los únicos códigos literales están en
  pruebas y son ficticios.
- El código de invitación viaja solo en el header `X-Onboarding-Invite-Code`
  (o en el body); nunca en URL, `localStorage`, logs ni auditoría. CORS ya
  permitía ese header (`Access-Control-Allow-Headers` verificado en staging).
- Sin cambios en `deploy/`, `.env*`, CORS, CSRF ni throttling.

## CI y PR

| Elemento | Resultado |
| --- | --- |
| PR | #24 `feat/phase-3-guided-onboarding` → `main` (43 ficheros, +5802/−1023) |
| CI «Frontend (test / lint / build)» | pass, 2m56s, primer intento |
| CI «Backend (validate / test / build / e2e)» | pass, 3m13s, primer intento |
| Reintentos por flakes conocidos | ninguno necesario |
| Merge | merge commit `4d457df` («Merge pull request #24 …»); `main` local avanzado con `git fetch origin main:main` |

## Despliegue en staging

Precondiciones (lectura, antes del deploy): host `srv1829292`, usuario
`deploy`, `/opt/tehus-crm` en `main` `7630b61` limpio y sincronizado con
`origin`; 6 contenedores healthy; runtime `547f31f`; disco 10 %; sin procesos
de deploy en curso; 2 timers `tehus-*` activos, 0 unidades fallidas; último
backup 2026-09-04 03:01 OK; Restic V2 abre con 3 snapshots; «Database schema
is up to date!». Diff `7630b61..4d457df`: 43 ficheros, 0 fuera de `apps/` y
`docs/`, 0 migraciones nuevas.

Procedimiento oficial `./deploy/scripts/deploy.sh` (desatendido, log privado
`chmod 600` en `/tmp`):

| Paso | Resultado |
| --- | --- |
| Rollback target registrado | `7630b61` |
| Pre-migration backup | DB `tehus-crm-staging-20260904-111416.sql.gz` (56K) + `.sha256`; uploads `…-uploads-20260904-111416.tar.gz` (900K) |
| `prisma migrate deploy` | 59 migraciones encontradas, «No pending migrations to apply» |
| `compose up -d` | backend, frontend y worker recreados; postgres, redis y caddy intactos |
| Health interno del script | «All checks passed» |
| Release publicado | `4d457dfb51b97a145b09c148cb95492551c811ea` (`/api/health/version`, `builtAt` 2026-09-04T16:11:54Z) |
| `health-check.sh` | OK: API y frontend alcanzables con certificado válido |
| `smoke-test.sh` (`EXPECTED_RELEASE=4d457df…`) | 22 passed, 0 failed (incluye «deployed release matches» y «bundle apunta a api.crm-staging») |
| `/api/health/ready` | `{"status":"ok"}` |
| TLS | Let's Encrypt, válido hasta 2026-12-02 |
| `GET /api/onboarding/templates` | `version: 3`, 7 industrias, incluye `vet_petshop` y `software` |
| Preflight CORS `POST /api/onboarding/invitation/check` | 204 con `Access-Control-Allow-Headers: Content-Type,Authorization,X-Onboarding-Invite-Code` |
| Producción | no tocada; `crm.takto.online` / `api.crm.takto.online` sin DNS |

## QA funcional en staging (datos `QA_PHASE3_<stamp>_*`, eliminados)

Datos temporales sembrados dentro del contenedor backend (script por stdin):
un `SUPER_ADMIN` temporal `QA_PHASE3_<stamp>_SA` y seis invitaciones
(`intendedCompanyName` `QA_PHASE3_<stamp>`): cinco TAKTO y una TEHUS. Los
códigos en claro se guardaron solo en un archivo local `chmod 600`, eliminado
al cerrar; no aparecen en logs, capturas ni documentos.

Driver Chrome headless + CDP contra `https://crm-staging.takto.online`
(sin mocks, API real `api.crm-staging.takto.online`), 37 capturas locales:

| Flujo (ancho) | Resultado verificado en la base de staging |
| --- | --- |
| Mueblería (1440) | `showroom` «Tienda / showroom», Colombia · America/Bogota · COP · es-CO, `businessModel: mixed`, categorías Salas/Comedores/Sillas/Decoración/Instalación, pipeline «Ventas» 7 etapas (primera inicial, WON y LOST), ADMIN + AGENT, invitación USED, `templateVersion: 3`, redirigido a `/dashboard` |
| Veterinaria y pet shop (390) | `vet_petshop`, Costa Rica · America/Costa_Rica · CRC · es-CR, mixto sin cotizaciones, Consultas/Vacunas/Peluquería/Alimentos/Medicamentos, pipeline «Citas y pedidos» 6 etapas, ADMIN, USED |
| Software y tecnología (1024) | `software`, «Solo servicios», México · America/Mexico_City · MXN · es-MX, Implementación/Consultoría/Soporte/Licencias, 6 etapas con Descubrimiento, ADMIN + AGENT, USED |
| Otro (320) | «Otro país» Andorra · Europe/Andorra · EUR · ca-AD, «Configurar manualmente» con descripción «Distribuidora de insumos» como `businessType`, sin catálogo (sin paso de categorías), pipeline neutral 6 etapas, ADMIN, USED |
| Resumen (4 flujos) | nombre, correo del administrador y región presentes; 9–10 acciones «Editar»; «Editar región» vuelve al paso conservando datos |
| Anchos 320 / 390 / 768 / 1024 / 1280 / 1440 (paso «Recomendación») | 0 scroll horizontal, 0 controles sin nombre, `aria-current` en «Recomendación (actual)», Tab llega al primer control con `outline solid 2px` |
| Consola / red | 0 errores de consola; las únicas respuestas ≥400 son `401 /api/auth/refresh` del arranque anónimo (comportamiento previo a la fase) |
| Auditoría `USE_INVITATION_CODE` (5 filas) | `metadata.onboarding` con plantilla, versión 3, módulos, conteos y región; sin contraseñas, hashes ni código completo |

Comprobaciones por API (`fetch` con `Origin` de staging):

| Caso | Resultado |
| --- | --- |
| `invitation/check` con código TEHUS temporal | 201 `{"valid":true}`; el código siguió **ACTIVE** (comprobar no consume) |
| `invitation/check` con código ya usado / inválido / sin header | 400 «ya utilizado» / 400 «inválido» / 400 |
| Mass assignment (`company.companyId`, `admin.role`) | 400 «property … should not exist»; sin efectos (código de reserva siguió ACTIVE) |
| `timezone` inválida | 400 «regional.timezone debe ser una zona horaria IANA válida…» antes de la transacción; sin efectos |
| Dos `POST /onboarding/company` simultáneos con el mismo código | **una** empresa creada (`…_concurrencia`), el código pasó a USED; comprobación y tercer intento → 400 «ya utilizado» |
| Empresas `QA_PHASE3_` en la base tras el QA | exactamente 5 (4 industrias + concurrencia) |
| Ficheros de branding (host / contenedor) | 0 / 2 antes y después: sin huérfanos |

## Limpieza y comparación antes/después

Borrado por ID exacto desde el contenedor (`QA_CLEANUP=1`), con verificación
previa de que cada empresa empieza por `QA_PHASE3_`:

| Tabla | Filas borradas |
| --- | --- |
| companies | 5 |
| users | 8 (5 ADMIN, 2 AGENT, 1 SUPER_ADMIN temporal) |
| invitation_codes | 6 |
| pipelines / pipeline_stages | 5 / 29 |
| audit_logs (de las empresas QA) | 5 |
| login_events / user_sessions (de los usuarios QA) | 5 / 5 |
| products, leads, contacts, tasks, notifications… | 0 |

Residuos: 0 empresas, 0 usuarios, 0 invitaciones, 0 pipelines, 0 auditoría,
0 sesiones.

Línea base (misma consulta `read only`, hashes `md5` de filas ordenadas por id):

| Métrica | Antes (pre-deploy) | Después (post-limpieza) |
| --- | --- | --- |
| companies | 4, hash `2466e01f…` | 4, hash `2466e01f…` (igual) |
| users | 9, hash `8654ed52…` | 9, igual |
| invitation_codes | 3, hash `9fa3d97f…` | 3, igual |
| pipelines / stages | 4 `61068a28…` / 23 `fa39f81d…` | iguales |
| products | 3, hash `28749f20…` | igual |
| audit_logs / sessions | 201 / 27 | 201 / 27 |
| login_events | 104 | 105 (+1: fila anónima FAILED `INVALID_CREDENTIALS` de `nobody@ex…` generada por `smoke-test.sh` a las 16:17:51, igual que la del smoke de la Fase 2; no es dato QA) |
| leads / contacts / quotes | 8 / 12 / 2 | iguales |
| tehus_present | 1 | 1 (Tehus sin cambios) |
| migrations_applied | 59 | 59 |

Post-limpieza: `/api/health/version` sigue en `4d457df…`, `/api/health/ready`
ok, 6 contenedores healthy, `main` `4d457df` limpio, 2 timers activos,
0 unidades fallidas. Log del deploy en `/tmp` con permisos 600.

## Cierre

- Producción, DNS, Meta/WhatsApp, correos reales: no tocados.
- Worktree principal (`chore/wa-signup-ops-script`, `send-demo-template.mjs`
  modificado, stash de `fix/security-hardening-20-controls`): intactos.
- Archivos locales temporales (códigos, credenciales QA, salidas): eliminados.
- Veredicto: **FASE 3 CERRADA — PASS**.
