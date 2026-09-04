# Fase 4 — Estado actual (para reanudar)

- Rama: `feat/phase-4-dynamic-crm` (worktree `../Tehus_Rattan-phase-4`),
  base `origin/main` `b01a2ec`.
- Línea base antes de tocar código (2026-09-04): backend 147/2415 unitarias,
  70/1039 e2e; frontend 107/1081. Todo en verde.
- Terminado: análisis de brechas; backend (registro de capacidades, regla
  legacy, `capabilities` en el contrato, guard `MODULE_DISABLED`, caché por
  empresa, tipo de catálogo por modelo comercial en API e importación,
  búsqueda filtrada, invariantes y auditoría de pipelines, DTOs endurecidos);
  frontend (proveedor de capacidades, navegación declarativa, route guards,
  catálogo adaptativo, administración de módulos, pipelines); pruebas
  (backend 153/2473 unitarias y 72/1065 e2e; frontend 113/1183; builds y lint);
  QA local con el producto levantado: 4 empresas, ADMIN y AGENT, 172
  comprobaciones sin fallos, datos borrados por ID (0 residuos); documentación
  de la fase.
- Falta: commits, push, PR, CI, merge, staging (precondiciones, backup,
  deploy, QA de cuatro tenants, limpieza), cierre documental.
- Próximo comando seguro: `git status` en el worktree y revisar el diff antes
  de `git add`.
- Bloqueadores: ninguno.
- Sin secretos en este documento.
