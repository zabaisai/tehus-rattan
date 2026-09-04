# Fase 4 — Gestión segura de pipelines

## Qué existía y qué se completa

`main` ya tenía el módulo `pipeline/` con: listar (ocultando archivados), crear,
renombrar, marcar predeterminado (transacción + índice parcial único
`pipelines_one_default_per_company`), archivar/restaurar, reordenar embudos,
traslado de oportunidades, bloqueo de borrado con oportunidades o con la
configuración de entrada apuntando al embudo, etapas con `type`
(OPEN/WON/LOST), `isInitial` único, color y probabilidad; frontend
`AdminPipelines.tsx` (ADMIN/SUPER_ADMIN) y selector tenant-scoped en el Kanban.

Lo que faltaba (ver `GAP-ANALYSIS.md` §2 fila 12) y se implementa en
`PipelineService`, sus DTOs y el controlador:

| Invariante | Antes | Ahora |
|---|---|---|
| Nombres | sin recorte, sin límite, `PATCH {name: ''}` aceptado, duplicados | recortados y con espacios colapsados; pipeline ≤ 60 (`PIPELINE_LIMITS`), etapa ≤ 40 (`STAGE_LIMITS`); vacío → 400; únicos sin distinguir mayúsculas (pipelines por empresa, etapas por embudo) |
| Cierre único | se podían crear varias WON/LOST | una etapa ganada y una perdida como máximo: crear otra o cambiar el tipo hacia una que ya existe → 400 |
| «Nunca peor que antes» | se podía dejar el embudo sin WON/LOST/OPEN | no se puede eliminar ni cambiar de tipo la ÚNICA etapa de un tipo mientras queden otras; un embudo legacy incompleto sigue editable y puede completarse |
| Etapa de entrada | ya protegida | igual (no se desmarca; no se borra si hay otras) |
| Oportunidades | bloqueo de borrado de etapa/embudo | igual; el conteo de la etapa ahora va por `companyId` y el mensaje dice cuántas |
| Tope | 20 etapas solo en onboarding | también al crear etapas desde el CRM |
| Reordenamiento | lista parcial y posiciones libres | lista COMPLETA con posiciones 0..n-1 (sin huecos ni repetidos); etapas ajenas → 400 |
| Orden de un pipeline nuevo | 0 | último + 1 (determinista) |
| Concurrencia | ninguna | operaciones sobre etapas bloquean la fila del embudo (`SELECT … FOR UPDATE` con `companyId`) dentro de la transacción; carrera de predeterminado (P2002 del índice parcial) → 409 |
| Auditoría | solo delete/move/archive/restore | además `pipeline.create`, `pipeline.update` (campos; `isDefault` si se marca), `pipeline.reorder`, `pipeline.stage.create` (id, tipo, inicial), `pipeline.stage.update` (id, campos), `pipeline.stage.delete` (id), `pipeline.stages.reorder` (conteo). Sin nombres de oportunidades ni valores |

## Permisos

- Lectura (`GET /pipelines`, `/:id`, `/:id/kanban`, `/:id/stages`, `/:id/retiro`):
  cualquier rol de la empresa.
- Estructura (crear, renombrar, default, archivar, restaurar, reordenar, etapas):
  `ADMIN`, `SUPER_ADMIN` (`@Roles`). `AGENT` y `MANAGER` reciben 403.
- Todo con el `companyId` del token. Un embudo ajeno responde 404 en lectura y
  escritura sin bloquear ni revelar nada.

## Resolución del pipeline efectivo (sin cambios, verificado)

1. `CompanyLeadSettings.defaultPipelineId` (revalidado contra la empresa y no archivado).
2. `isDefault` no archivado.
3. Primer pipeline activo por `order`, `createdAt`, `id`.
4. Sin pipeline → la entrada automática lo dice (`motivo`), no inventa nada.

Frontend: URL `?embudo=` → `isDefault` → primero. El menú «Crear» usa el
`isDefault` (antes tomaba el primero de la lista).

## Lo que NO hace esta fase

- Migración masiva de oportunidades entre etapas al borrar (se bloquea y se explica).
- Automatizaciones por cambio de etapa.
- Múltiples pipelines por conversación.
- Historial de etapa en el traslado entre embudos (comportamiento previo).

## Pruebas

- Unitarias: `pipeline.service.spec.ts` (caracterización, adaptada al bloqueo
  de fila), `pipeline.invariantes.spec.ts` (17 casos: nombres, cierre único,
  legacy, tope, reordenamiento, 404 ajeno, 409 en carrera).
- E2E (PostgreSQL real): `pipeline-gestion.e2e-spec.ts` (auditoría, roles,
  404 ajeno, dos defaults simultáneos → uno, dos LOST simultáneas → una,
  reordenamiento parcial/hueco rechazado y permutación completa aplicada),
  más las existentes `pipeline-etapa-inicial` y `pipeline-retiro`.
