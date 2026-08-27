# CURRENT_STATUS — Endurecimiento de seguridad (20 controles)

_Actualizado: 2026-08-27._

## Dónde está el trabajo

- **Rama:** `fix/security-hardening-20-controls`, tomada de `origin/main`
  (`f04ab44`). `main` es el producto real; `develop` está ~269 commits por
  detrás y NO se usó como base.
- **Estado Git:** commits locales, **sin push, sin PR, sin merge, sin deploy**.
- **Base de datos:** ninguna base real tocada. Migraciones probadas en una base
  temporal vacía (`tehus_sec_tmp`), creada y **eliminada** al terminar.

## Commits creados (15)

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

## Verificación (local, sobre `main`)

- Backend unit: **136 suites / 2186** ✅
- Backend e2e (base temporal): **67 suites / 966** ✅
- Backend typecheck ✅ · lint (`--no-fix`) ✅ · build ✅
- Frontend tests: **948** ✅ · lint (1 warning ajeno) ✅ · build ✅
- `prisma migrate deploy` (base vacía): 58 migraciones ✅ · `prisma validate` ✅
- RLS proof (`node prisma/rls/proof.mjs`, base aislada): ✅
- gitleaks (HEAD, `--all`, commits de la rama): *no leaks found* ✅
- `npm audit --omit=dev --audit-level=critical`: 0 críticas ✅ (altas documentadas)
- `git diff --check`: limpio

## Los 20 controles (resumen)

Ver `docs/SECURITY_HARDENING_20_CONTROLS.md`. Corregidos: 1, 5 (KDF), 6, 7, 9,
11, 12, 15, 16 (parcial), 17 (campos), 20. Verificados: 2, 3, 8, 10, 13, 14, 18.
Parciales: 4 (RLS preparado+probado, falta separar rol de BD), 19 (TLS Postgres).

## Qué falta (acción humana) — ver `USER_ACTIONS_REQUIRED.md`

1. **P0** rotar las credenciales mostradas en salida (nombres en el doc); ninguna
   está en Git.
2. **P1** separar rol de BD migración/runtime y **activar** el RLS ya preparado.
3. **P2** conectar claves reales de Turnstile; **P2** TLS a Postgres.

## Autorización pendiente

Una sola frase del usuario autoriza el push de la rama y la creación del PR
(ver el informe final). Hasta entonces, nada sale de local.
