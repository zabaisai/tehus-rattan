# Fase 2 — Evidencia

Estado: **PENDIENTE** — el despliegue en staging y el QA funcional aún no se
han ejecutado. Esta página se completa únicamente con resultados reales; no se
marca PASS por anticipado.

## Contexto

- Base: `origin/main` `6c1de8d` (2026-09-03). Rama `feat/phase-2-tenant-configuration`.
- Runtime de staging al empezar: `5cb991f` (Fase 1). Producción: no existe.

## Pruebas (local, worktree de la fase)

Ejecutadas el 2026-09-03 en el worktree de la fase (Windows 11, Node 22), con
los MISMOS comandos que usa `.github/workflows/ci.yml`.

Backend (`apps/backend`):

| Comprobación | Comando | Resultado |
| --- | --- | --- |
| Prisma validate | `npx prisma validate` | OK — el esquema es válido |
| Typecheck (incluye specs) | `npm run typecheck` | OK — 0 errores |
| Lint | `npx eslint "{src,apps,libs,test}/**/*.ts" --no-fix` | OK — 0 errores, 0 avisos |
| Unitarias | `npm test -- --runInBand` | 147/147 suites, 2399/2399 pruebas |
| Build | `npm run build` (`nest build`) | OK |
| E2E (PostgreSQL y Redis reales) | `npm run test:e2e -- --runInBand` | 69/69 suites, 1005/1005 pruebas |

Frontend (`apps/frontend`):

| Comprobación | Comando | Resultado |
| --- | --- | --- |
| Typecheck (incluye tests) | `npm run typecheck` | OK — 0 errores |
| Lint | `npm run lint` | OK — 0 errores, 2 avisos previos a la fase |
| Pruebas | `npm test` (`vitest run`) | 101/101 ficheros, 1051/1051 pruebas |
| Build de producción | `npm run build` | OK — 31 rutas generadas |

Nota sobre la e2e del backend: en paralelo (por defecto) las suites comparten
una sola base real y se pisan entre sí — `flowbot-transporte` y
`token-rotation` fallan de forma intermitente y distinta en cada pasada. En
serie, que es como corre el CI, pasan las 69. No es algo que introduzca la
Fase 2: ninguno de esos dos ficheros se toca aquí.

QA visual 320–1440 px: pendiente.

## Seguridad del diff

Pendiente.

## CI y PR

Pendiente.

## Despliegue en staging

Pendiente. Precondiciones, backup pre-migración, migración, release, health y
smoke se documentarán con sus resultados.

## QA funcional en staging (datos `QA_PHASE2_`, a eliminar)

Pendiente.

## Limpieza y comparación antes/después

Pendiente.

## Cierre

Pendiente.
