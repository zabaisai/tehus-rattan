# Fase 4 — CRM dinámico por empresa, catálogo unificado y pipelines seguros

Hace que el CRM operativo responda de verdad a la configuración de cada
empresa: la navegación, las rutas, la API, el catálogo, las categorías y el
pipeline dependen de lo que esa empresa eligió, y un ADMIN puede cambiarlo
después sin perder ni un dato.

TAKTO es la plataforma y propietaria del CRM; Tehus Rattan es una empresa
cliente más. Nada de esta fase toma a Tehus ni a los muebles como valor por
defecto: los términos de muebles solo aparecen en la plantilla de muebles y en
las empresas que la eligieron.

Rama: `feat/phase-4-dynamic-crm` (desde `origin/main` `b01a2ec`), fusionada en
`main` `38c1575` (PR #26). Worktree aislado; el worktree principal y su
archivo ajeno
(`deploy/scripts/send-demo-template.mjs`) no se tocan.

## Documentos

| Documento | Contenido |
|---|---|
| [GAP-ANALYSIS.md](GAP-ANALYSIS.md) | Requisito → estado en `main` → evidencia → brecha → acción → prueba |
| [CAPABILITY-CONTRACT.md](CAPABILITY-CONTRACT.md) | Registro canónico de capacidades, resolución efectiva, regla legacy, guard y error estable |
| [MODULE-MATRIX.md](MODULE-MATRIX.md) | Capacidad → configuración → navegación → ruta → endpoint → rol → dependencias → comportamiento desactivado y legacy |
| [DYNAMIC-CATALOG.md](DYNAMIC-CATALOG.md) | Catálogo unificado: tipos permitidos por modelo comercial, vocabulario, elementos heredados, importación |
| [PIPELINE-MANAGEMENT.md](PIPELINE-MANAGEMENT.md) | Invariantes de etapas, reordenamiento completo, concurrencia, permisos y auditoría |
| [TEST-MATRIX.md](TEST-MATRIX.md) | Qué prueba cubre cada requisito y resultados reales |
| [STAGING-EVIDENCE.md](STAGING-EVIDENCE.md) | Evidencia sanitizada de pruebas, CI, despliegue y QA |
| [ROLLBACK.md](ROLLBACK.md) | Cómo volver atrás (sin migración) |
| [CURRENT-STATUS.md](CURRENT-STATUS.md) | Estado para reanudar el trabajo |
| [../contracts/tenant-configuration.v1.schema.json](../contracts/tenant-configuration.v1.schema.json) | Contrato publicado, ampliado con `capabilities` (validado por prueba) |

## Alcance

**Backend.** Registro canónico `tenant-capabilities.ts` (siete capacidades:
cuatro centrales y tres configurables) con etiquetas, descripciones,
dependencias, rutas y comportamiento legacy; `resolveEffectiveCapabilities`
como única función que decide si un módulo está activo, con la regla de
compatibilidad «lo que nunca se declaró sigue disponible»;
`TenantConfigurationV1.capabilities` (aditivo) y `modules` ya efectivos;
`@RequiresTenantCapability` + `TenantCapabilityGuard` con
`403 { code: 'MODULE_DISABLED', module }` en catálogo, elementos de
oportunidad, cotizaciones, tareas y sugerencias; caché de capacidades por
empresa (5 s) invalidada al escribir; búsqueda global que omite los tipos de
módulos inactivos; tipo de elemento del catálogo validado contra el modelo
comercial en API e importación; invariantes, transacciones con bloqueo de fila
y auditoría en la gestión de pipelines; DTOs de pipeline y etapa endurecidos.

**Frontend.** `TenantCapabilitiesProvider` + `useTenantCapabilities` como única
fuente en el navegador; navegación declarativa (`lib/navigation.ts`) aplicada
a sidebar de escritorio y móvil; menú «Crear», buscador y dashboard filtrados
por capacidad y sin consultar módulos inactivos; `RequireTenantCapability` con
pantalla explicada y botón «Activar módulo» para ADMIN y respuesta neutral
para asesores; administración de módulos desde Configuración con
descripciones del servidor, aviso de compatibilidad, confirmación al
desactivar («no borra nada») y actualización inmediata con la respuesta
canónica; catálogo adaptativo (productos / servicios / mixto) con elementos
heredados marcados; administración de pipelines con reordenamiento completo,
etiquetas de tipo y límites de nombre; `MODULE_DISABLED` traducido en los
errores.

**No incluido** (fases posteriores): backfill de `itemType` y migración de
empresas existentes, conversión de valores legacy, producción, automatizaciones
por cambio de etapa, constructor visual, chatbot, Embedded Signup final,
múltiples números por empresa, billing, editor global de plantillas desde
Super Admin, historias clínicas veterinarias, formato de moneda por región.

## Plan y estado

| # | Etapa | Estado |
|---|---|---|
| 1 | Inspección y análisis de brechas | HECHA — `GAP-ANALYSIS.md` |
| 2 | Registro de capacidades, contrato y guard | HECHA |
| 3 | Catálogo por modelo comercial (API e importación) | HECHA |
| 4 | Gestión segura de pipelines | HECHA |
| 5 | Frontend dinámico (navegación, rutas, catálogo, módulos, pipelines) | HECHA |
| 6 | Pruebas (unitarias, e2e HTTP, frontend) | HECHA en local — conteos en `TEST-MATRIX.md` |
| 7 | QA local de las cuatro empresas (ADMIN y AGENT) | HECHA — 172 comprobaciones, 0 fallos |
| 8 | PR, CI y merge | HECHA — PR #26 → `main` `38c1575` (merge commit) |
| 9 | Backup y despliegue en staging | HECHA — release `38c1575`, backup con checksums, 0 migraciones, health 12/12, smoke 22/22 |
| 10 | QA multiempresa en staging y limpieza | HECHA — 172 comprobaciones sin fallos; 0 residuos, línea base igual |
| 11 | Documentación y cierre | HECHA — rama `docs/phase-4-closure` |

Estado de la fase: **FASE 4 CERRADA — PASS** (2026-09-04). Fase 5 no iniciada.

## Migraciones

Ninguna. El modelo ya soportaba configuración, `itemType`, pipelines y etapas.
Ver `ROLLBACK.md`.

## Compatibilidad

- Empresas sin configuración (v0) o con banderas antiguas incompletas (v1)
  conservan catálogo, cotizaciones y tareas: solo un `false` explícito
  desactiva. La respuesta lo declara en `capabilities.legacyDefaultsApplied`.
- Desactivar un módulo nunca borra datos; al reactivarlo reaparecen.
- Filas de catálogo con `itemType NULL` se siguen leyendo como `PRODUCT`; los
  elementos del tipo que la empresa ya no crea se conservan y se marcan como
  heredados. Sin backfill.
- Tehus sigue siendo una mueblería con sus categorías legítimas.

## Fuera de alcance (no realizado)

Producción (DNS, certificados, despliegue), Meta/WhatsApp, correos reales,
renombres de tablas o rutas, migración de datos de empresas existentes.
Asahel y Cristian no participan.
