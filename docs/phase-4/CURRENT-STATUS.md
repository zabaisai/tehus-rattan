# Fase 4 — Estado actual (para reanudar)

- Estado: **FASE 4 CERRADA — PASS** (2026-09-04).
- Implementación: PR #26 `feat/phase-4-dynamic-crm` → `main` `38c1575`
  (merge commit, sin migraciones). Cierre documental: rama
  `docs/phase-4-closure`.
- Staging: release `38c1575` desplegado con `deploy.sh` (backup con checksums,
  0 migraciones), health 12/12 y smoke 22/22, QA de cuatro empresas con ADMIN y
  AGENT verificado y eliminado por ID (0 residuos; línea base igual salvo +1
  `login_event` del propio smoke). Ver `STAGING-EVIDENCE.md`.
- Producción: no existe ni se toca.
- Siguiente fase (no iniciada, requiere autorización): Fase 5 — backfill de
  `itemType`, migración de empresas existentes y conversión de valores legacy.
- Deuda registrada: el paso 11 de `deploy.sh` no reintenta la comprobación
  interna de salud y falló mientras el contenedor arrancaba (el mismo script
  pasa completo al reejecutarse); `401 /api/auth/refresh` en el arranque
  anónimo; formato de moneda fijo `es-CO`/`COP` en catálogo, cotizaciones y
  panel de inicio; e2e del backend en paralelo comparten base (el CI usa
  `--runInBand`).
- Bloqueadores: ninguno.
- Sin secretos en este documento.
