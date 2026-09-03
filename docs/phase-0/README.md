# Fase 0 — Fundación de plataforma TAKTO

TAKTO es el propietario y la marca del CRM. Tehus Rattan es un tenant que
usa TAKTO y vende muebles; nada de Tehus (muebles, salas, comedores, colores
de marca, dominios) debe tratarse como valor universal del producto.

La Fase 0 no cambia funcionalidad: solo descubre, verifica y documenta el
punto de partida antes de separar TAKTO de Tehus (Fase 1).

## Alcance

1. Inventario técnico del repositorio y del despliegue de staging.
2. Contrato funcional actual: qué es por tenant y qué está fijado en código.
3. Respaldo nuevo y verificable de staging (base de datos y uploads).
4. Restore drill aislado con comparación de conteos.
5. Evidencia sanitizada en Git; evidencia con identificadores fuera de Git.

## Documentos

| Documento | Contenido |
|-----------|-----------|
| [TECHNICAL-INVENTORY.md](TECHNICAL-INVENTORY.md) | Stack, servicios, base de datos, respaldo, dependencias globales de un tenant |
| [FUNCTIONAL-CONTRACT.md](FUNCTIONAL-CONTRACT.md) | Comportamiento actual observado e invariantes que la Fase 1 debe conservar |
| [STAGING-EVIDENCE.md](STAGING-EVIDENCE.md) | Evidencia de las sesiones 2026-09-02 y 2026-09-03: salud, inventario, backup, restore drill, primer ciclo automático, resultado por control |
| [STAGING-RUNBOOK.md](STAGING-RUNBOOK.md) | Procedimiento reproducible de solo lectura + backup + restore aislado |
| [staging-inventory.sql](staging-inventory.sql) | Consulta de inventario en transacción de solo lectura, parametrizada |
| [../contracts/company-settings.v2.schema.json](../contracts/company-settings.v2.schema.json) | Forma actual (v1) de `Company.settings` y propuesta v2 (BORRADOR, no implementado) |
| [../contracts/onboarding-templates.v1.json](../contracts/onboarding-templates.v1.json) | Valores hoy fijados en código que la Fase 1 debe convertir en plantillas por vertical |

## Estado

**FASE 0 CERRADA — PASS.** Fecha de cierre: 2026-09-03.

Última verificación: 2026-09-03. El primer ciclo automático de
`tehus-backup.timer` se verificó en solo lectura ese día: disparo a las
03:00:18 hora de Colombia, `Result=success`, `ExecMainStatus=0`, 52 s de
duración, snapshot cifrado `c0c2d8e4…` (03:00:34 Colombia / 08:00:34 UTC),
2 snapshots en el repositorio V2, histórico intacto con 1 snapshot, checksums y
`restic check` sin errores, `health-check.sh` 12/12 OK, cron redundante
ausente, sin locks ni residuos. Detalle en
[STAGING-EVIDENCE.md](STAGING-EVIDENCE.md#primer-ciclo-automático-2026-09-03-solo-lectura).

| Criterio | Estado |
|----------|--------|
| Commit desplegado y salud actual confirmados | PASS |
| Inventario agregado de todas las empresas | PASS |
| Settings y slug actuales de Tehus identificados | PASS |
| Dependencias globales de muebles identificadas | PASS |
| Backup nuevo de base de datos | PASS |
| Backup nuevo de uploads | PASS (B-02 corregido, PR #16) |
| Checksums correctos | PASS |
| Snapshot cifrado off-site confirmado | PASS (B-01 cerrado; timers habilitados; primer ciclo automático 2026-09-03 exitoso) |
| Restore drill aislado exitoso | PASS (local y drill Restic oficial) |
| Conteos de origen y restauración coincidentes | PASS |
| Base temporal eliminada | PASS |
| Staging continúa saludable | PASS |
| Evidencia pública sanitizada | PASS |
| Evidencia privada fuera de Git | PASS |
| Ningún secreto expuesto | PASS |
| Producción no tocada | PASS |

B-02 y B-03 quedaron resueltos y desplegados el 2026-09-02 (PR #16, `main` a95da7e). B-01 quedó en PASS el mismo día (repositorio off-site v2, primer backup cifrado, drill oficial, timers habilitados y cron redundante retirado) y en PASS definitivo el 2026-09-03 con el primer ciclo automático. Los tres están descritos en
[STAGING-EVIDENCE.md](STAGING-EVIDENCE.md#bloqueadores). Los 16 criterios
están en PASS: la Fase 0 quedó cerrada formalmente el 2026-09-03.

Observaciones no bloqueantes registradas al cierre (detalle en
[STAGING-EVIDENCE.md](STAGING-EVIDENCE.md#observaciones-no-bloqueantes)):
`NEXT_PUBLIC_API_URL` no definida en el entorno del host al invocar Docker
Compose (sin efecto en contenedores ni respaldo); la retención 7/4/6 aún no ha
eliminado snapshots porque solo existen dos (se observará tras los primeros
siete ciclos diarios); los archivos vacíos de `flock` en `backups/` son parte
del diseño y no representan locks activos.

## Evidencia privada

La salida completa del inventario (incluida la sección 9 con `settings`,
colores e integraciones del tenant bajo revisión), los conteos del restore
drill y la limpieza se guardan en un directorio hermano del repositorio,
claramente marcado como privado, fuera de cualquier worktree de Git. Ese
material contiene el `Company.id` del tenant y no debe copiarse a commits,
PRs, issues ni a esta carpeta.

## Programación operativa

| Tarea | Hora de Colombia | UTC |
|-------|------------------|-----|
| Backup diario cifrado (`tehus-backup.timer`) | 03:00 | 08:00 |
| Drill mensual de restauración (`tehus-backup-drill.timer`, día 1) | 04:30–04:45 | 09:30–09:45 |

Producción no fue tocada en ninguna sesión de la Fase 0. La Fase 1 no ha comenzado.

## Reglas de la fase

- Solo staging. Producción no se toca.
- Sin migraciones, sin deploy, sin merge, sin cambios funcionales.
- Solo puede eliminarse una base con nombre `tehus_restore_drill*` creada por
  la propia prueba.
- Nunca imprimir `.env*`, tokens, contraseñas, códigos de invitación,
  configuración de rclone ni datos personales.
