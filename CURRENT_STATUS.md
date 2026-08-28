# CURRENT_STATUS — Endurecimiento de seguridad (20 controles)

_Actualizado: 2026-08-28._

## Dónde está el trabajo

- **Rama:** `fix/security-hardening-20-controls`, tomada de `origin/main`
  (`f04ab44`). `main` es el producto real; `develop` está ~269 commits por
  detrás y NO se usó como base.
- **Estado Git:** rama publicada en GitHub; Draft PR [#7](https://github.com/zabaisai/tehus-rattan/pull/7) abierto contra `main`, **sin merge y sin deploy**.
- **Base de datos:** ninguna base real tocada. Migraciones probadas en una base
  temporal vacía (`tehus_sec_tmp`), creada y **eliminada** al terminar.

## Commits principales (resumen; 37 commits en el PR)

**Fase 1 — auditoría + correcciones base**

| SHA | Qué |
|-----|-----|
| `487d456` | frontend: helper `safe-url` + open-redirect (`volverA`), `actionUrl`, `imageUrl`, `window.open` |
| `220344d` | backend: aislamiento multiempresa, realtime con revocación de sesión, webhook/env/uploads |
| `211d45a` | CI: permisos mínimos, gitleaks/npm-audit/CodeQL, dependabot, `.gitleaks.toml` |
| `57206b6` | `.gitignore` para todo `.env*`; borrado de `code .gitignore` |
| `65c83ca` | dev compose: bind a loopback + banner DEV-ONLY |
| `9b92497` | documentación (matriz 20 controles, tests, status/decisiones/mapa) |

**Fase 2 — cierre + verificación**

| SHA | Qué |
|-----|-----|
| `96a2951` | reescribe placeholder de token en doc; endurece allowlist de gitleaks |
| `2561a0f` | documenta NOMBRES de credenciales mostradas para rotar (sin valores) |
| `4fdd20a` | cifrado: KDF scrypt versionado con compatibilidad legacy |
| `cdb4cd8` | antibot: módulo captcha desacoplado (fake + Turnstile), opt-in en login |
| `4401375` | rate limiting distribuido en Redis (storage compartido) |
| `57dc0c4` | RLS ejecutable + contexto transaccional (probado en local) |
| `b780ce7` | guard global deny-by-default + `@Public()` |
| `1d1ed41` | documenta habilitación de TLS a Postgres |
| `8457634` | limpieza de línea en blanco en el SQL de RLS |

**Fase 3 — cierre de PARCIALes**

| SHA | Qué |
|-----|-----|
| `02d2199` | rate limiting fail-SAFE (fallback local) + límite por cuenta |
| `8a51ef5` | CI: pasar GITHUB_TOKEN a gitleaks (el job ya escanea) |
| `d358a69` | validación de inputs: 7 `@Body()` inline → DTOs |
| `e6552f2` | contraseñas: coste 12 + rehash progresivo |
| `c30eb39` | antibot frontend (widget Turnstile en login) |
| `b36ccf3` | uploads: validación de contenido ZIP/CSV + servido solo branding |
| `09165fa` | tope máximo por listado (anti-runaway) |
| `1e03756` | RLS: contexto por petición + integración probada con rol runtime |
| `095d239` | TLS de Postgres: config verify-full + prueba local + runbook |
| `71fc6f1` | dependencias: frontend a 0 vulnerabilidades (next 16.3.3) |

## Verificación (local, sobre `main`)

- Backend unit: **141 suites / 2216** ✅
- Backend e2e (base temporal, incl. RLS integración): ✅ (ver informe)
- Backend typecheck ✅ · lint (`--no-fix`) ✅ · build ✅
- Frontend tests: **956** ✅ · typecheck ✅ · lint ✅ · build ✅
- `prisma migrate deploy` (base vacía): 58 migraciones ✅ · `prisma validate` ✅
- RLS: `proof.mjs` + `rls-integration.e2e` (rol runtime real) ✅
- TLS Postgres: `test-postgres-tls.sh` **ejecutado en verde en CI Linux**
  (`ubuntu-latest`, job `postgres-tls`): verify-full+CA conecta, no-TLS
  rechazado, verify-full sin CA falla. NO implica que la BD real use TLS.
- CodeQL: cerradas las dos observaciones abiertas — reflected XSS en el GET del
  webhook (validación estricta del challenge antes de reflejarlo) y ruta no
  controlada en la subida de import (ruta reconstruida del server-dir + clave del
  servidor, resuelta canónicamente y confinada). Con pruebas dedicadas.
- gitleaks (HEAD, `--all`, commits de la rama): *no leaks found* ✅
- `npm audit`: **frontend 0 vulns**; backend 0 críticas (altas de tooling documentadas)
- `git diff --check`: limpio

## Los 20 controles (resumen)

Ver `docs/SECURITY_HARDENING_20_CONTROLS.md` (tabla única, 20 filas, vocabulario
de estados). Resumen honesto tras la verificación de fase 3:
- 16 **CORREGIDO Y VERIFICADO**.
- 12 (antibot): **CÓDIGO COMPLETO — PENDIENTE CONFIGURACIÓN**.
- 4 (RLS): **PREPARADO Y PROBADO DE FORMA AISLADA — ADOPCIÓN EN SERVICIOS
  PENDIENTE** (los 67 servicios usan `this.prisma` directo; probado por
  `rls-real-path.e2e`).
- 19 (TLS de BD): **PREPARADO — PRUEBA EJECUTADA EN VERDE EN CI LINUX** (job
  `postgres-tls`; el script no corre en verde en Windows por MSYS). Sigue sin
  activarse en ninguna base real.
- Riesgos aceptados y justificados: 16 (logos públicos), 20 (CLI de Prisma =
  devDependency; exceljs→uuid no alcanzable por archivo del usuario).

## Qué falta (acción humana) — ver `USER_ACTIONS_REQUIRED.md`

1. **P0** rotar las credenciales mostradas en salida (nombres en el doc); ninguna
   está en Git.
2. **P1** adoptar `runInTenantContext`/`runWithTenant` en servicios, jobs, worker, WebSocket, analytics y tareas programadas; después separar el rol runtime `NOBYPASSRLS` del rol de migraciones y solo entonces activar RLS.
3. **P2** crear claves reales de Turnstile; **P2** TLS a Postgres al salir del host.

## Estado de publicación

La rama ya está publicada en el Draft PR #7. El PR debe permanecer en Draft y sin merge hasta completar la revisión y recibir autorización explícita. No se ha desplegado nada ni se ha tocado una base real.
