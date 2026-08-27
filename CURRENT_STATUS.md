# CURRENT_STATUS — Endurecimiento de seguridad (20 controles)

_Actualizado: 2026-08-27._

## Dónde está el trabajo

- **Rama:** `fix/security-hardening-20-controls`, tomada de `origin/main`
  (`f04ab44`). `main` es el producto real; `develop` está ~269 commits por
  detrás y NO se usó como base.
- **Estado Git:** commits locales, **sin push, sin PR, sin merge, sin deploy**.
- **Base de datos:** ninguna base real tocada. Migraciones probadas en una base
  temporal vacía (`tehus_sec_tmp`), creada y **eliminada** al terminar.

## Commits creados (5)

| SHA | Qué |
|-----|-----|
| `487d456` | frontend: helper `safe-url` + cierre de open-redirect (`volverA`), `actionUrl`, `imageUrl`, `window.open` |
| `220344d` | backend: aislamiento multiempresa, realtime con revocación de sesión, webhook/env/uploads hardening |
| `211d45a` | CI: permisos mínimos, gitleaks/npm-audit/CodeQL, dependabot, `.gitleaks.toml` |
| `57206b6` | `.gitignore` para todo `.env*`; borrado de `code .gitignore` |
| `65c83ca` | dev compose: bind a loopback + banner DEV-ONLY |

(La documentación de este bloque se añade en un commit final aparte.)

## Verificación (local, sobre `main`)

- Backend unit: **134 suites / 2166** ✅
- Backend e2e (base temporal): **65 suites / 957** ✅
- Backend typecheck: ✅
- Frontend tests: **87 archivos / 948** ✅ · build ✅
- `prisma migrate deploy` (base vacía): 58 migraciones ✅
- gitleaks (HEAD y `--all`): *no leaks found* ✅
- `npm audit`: 0 críticas (altas documentadas)
- `git diff --check`: limpio

## Los 20 controles (resumen)

Ver `docs/SECURITY_HARDENING_20_CONTROLS.md` para el detalle por control.
Corregidos: 1, 6 (WS), 7, 9, 15, 16 (parcial), 17, 20. Verificados: 2, 3, 8, 10,
13, 14, 18. Parciales/documentados: 5, 11, 19. Bloqueados (acción humana): 4
(RLS), 12 (antibot).

## Qué falta (acción humana) — ver `USER_ACTIONS_REQUIRED.md`

1. **P0** rotar el token de Meta legacy (estaba en `.env` local, no en Git).
2. **P1** separar rol de BD migración/runtime y activar RLS.
3. **P2** antibot; **P2** rate limiting en Redis.

## Autorización pendiente

Una sola frase del usuario autoriza el push de la rama y la creación del PR
(ver el informe final). Hasta entonces, nada sale de local.
