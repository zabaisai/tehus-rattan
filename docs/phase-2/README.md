# Fase 2 — Motor de configuración por empresa

Convierte la información comercial de cada empresa en una configuración
persistente, tipada, validada, segura y consumible por el frontend: región,
modelo comercial, módulos, categorías y pipeline en un solo contrato
(`TenantConfigurationV1`), más el tipo de elemento del catálogo
(`PRODUCT` / `SERVICE`).

TAKTO es la plataforma y propietaria del CRM; Tehus Rattan es una empresa
cliente más. Nada de esta fase toma a Tehus como valor por defecto ni toca sus
datos.

Rama: `feat/phase-2-tenant-configuration` (desde `origin/main` `6c1de8d`).
Worktree aislado; el worktree principal y su archivo ajeno
(`deploy/scripts/send-demo-template.mjs`) no se tocan.

## Documentos

| Documento | Contenido |
|---|---|
| [GAP-ANALYSIS.md](GAP-ANALYSIS.md) | Matriz requisito → estado en `main` → evidencia → brecha → acción → prueba |
| [CONFIGURATION-CONTRACT.md](CONFIGURATION-CONTRACT.md) | Contrato agregado, fuentes, endpoints, campos editables, validación regional, reglas, compatibilidad |
| [MIGRATION.md](MIGRATION.md) | SQL de la migración aditiva de `itemType`, por qué sin backfill, comportamiento sobre `NULL` |
| [ROLLBACK.md](ROLLBACK.md) | Cómo volver atrás código y configuración sin tocar datos |
| [STAGING-EVIDENCE.md](STAGING-EVIDENCE.md) | Evidencia sanitizada de pruebas, CI, despliegue y QA |
| [../contracts/tenant-configuration.v1.schema.json](../contracts/tenant-configuration.v1.schema.json) | Esquema publicado del contrato (validado por una prueba contra la respuesta real) |

## Alcance

Incluido: contrato agregado y motor único (`TenantConfigurationService`) con
transacción, bloqueo de fila y auditoría; `GET/PATCH /companies/me/configuration`;
`/companies/me/settings` delegando en el mismo motor; validación IANA /
ISO 4217 / BCP 47; `itemType` en `Product` (enum, columna nullable, índice),
DTOs, filtro, tipo efectivo `PRODUCT` para filas legacy; importación con
columna «Tipo de elemento»; frontend: sección de configuración (región,
modelo, módulos, datos de origen; solo lectura para `AGENT`), selector y badge
Producto/Servicio, filtro por tipo, mapeo de columnas en la importación.

No incluido (fases posteriores): navegación dinámica por módulos (Fase 4),
backfill de `itemType` (Fase 5), renombrar `products` / `/products`,
`CompanyLeadSettings` por API, producción.

## Plan y estado

| # | Etapa | Estado |
|---|---|---|
| 1 | Inspección y análisis de brechas | HECHA — `GAP-ANALYSIS.md` |
| 2 | Motor de configuración y contrato | HECHA — backend |
| 3 | Tipo PRODUCT/SERVICE, migración e importación | HECHA — backend |
| 4 | Frontend administrativo, catálogo e importación | HECHA |
| 5 | Pruebas (unitarias, e2e, frontend) | HECHA en local — conteos en `STAGING-EVIDENCE.md` |
| 6 | QA visual local 320–1440 px | HECHA — 54 comprobaciones, 0 fallos (ver `STAGING-EVIDENCE.md`) |
| 7 | PR, CI y merge | PENDIENTE |
| 8 | Despliegue en staging | PENDIENTE |
| 9 | QA funcional en staging y limpieza | PENDIENTE |
| 10 | Documentación y cierre | PENDIENTE |

Estado de la fase: **FASE 2 ABIERTA — EN CURSO**.

## Fuera de alcance (no realizado)

Producción (DNS, certificados, despliegue, migraciones), cuentas de
Meta/WhatsApp, Google Cloud, rclone/Restic, renombres de infraestructura,
modificación de empresas existentes, backfill, plantillas para Tehus. Asahel y
Cristian no participan.
