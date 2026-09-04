# Fase 4 — Evidencia

Estado: **PASS** (2026-09-04). Todo lo que sigue son resultados reales:
pruebas locales, CI, despliegue oficial en staging, QA multiempresa con datos
temporales eliminados por ID y comparación antes/después. Sin secretos, sin
IDs completos, sin correos reales.

## Contexto

- Base: `origin/main` `b01a2ec` (2026-09-04). Rama `feat/phase-4-dynamic-crm`.
- Runtime de staging al empezar: `4d457df` (Fase 3). Producción: no existe
  (`crm.takto.online` y `api.crm.takto.online` sin DNS; no se tocan).
- Merge de implementación: PR #26 → `main` `38c1575` (merge commit).

## Pruebas (local, worktree de la fase)

Línea base antes de tocar código: backend 147 suites / 2415 unitarias y 70 /
1039 e2e; frontend 107 ficheros / 1081. Todo en verde. Después:

| Ámbito | Comprobación | Resultado |
| --- | --- | --- |
| Backend | `prisma validate`, typecheck, lint | OK, 0 errores, 0 avisos |
| Backend | Unitarias (`--runInBand`) | 153 suites / 2473 pruebas |
| Backend | Build (`nest build`) | OK |
| Backend | E2E con PostgreSQL y Redis reales (`--runInBand`) | 72 suites / 1065 pruebas |
| Frontend | typecheck, lint | OK (0 errores; 2 avisos previos a la fase) |
| Frontend | Vitest | 113 ficheros / 1183 pruebas |
| Frontend | `next build` | OK |
| Prisma | Migraciones | **ninguna** |

QA local con el producto levantado (cuatro empresas, ADMIN y AGENT, Chrome
headless sin mocks): **172 comprobaciones, 0 fallos**. Detalle en
`TEST-MATRIX.md`.

## Seguridad del diff

- Escaneo de secretos sobre el diff completo (contraseñas, hashes, tokens,
  claves, `.env`, correos, marcas temporales de QA): **sin hallazgos**.
- 107 ficheros, +8013/−634. **0** ficheros fuera de `apps/` y `docs/`; **0**
  migraciones; **0** cambios en `deploy/` ni en variables de entorno.
- `companyId` nunca se acepta del cliente; los guards se aplican en el
  servidor y el frontend solo decide qué mostrar.

## CI y PR

| Elemento | Resultado |
| --- | --- |
| PR | #26 `feat/phase-4-dynamic-crm` → `main` (100 ficheros en GitHub) |
| CI «Frontend (test / lint / build)» | pass, 2m25s, primer intento |
| CI «Backend (validate / test / build / e2e)» | pass, 3m05s, primer intento |
| Reintentos por flakes conocidos | ninguno necesario |
| Merge | merge commit `38c1575`; `main` local avanzado por fast-forward |

## Despliegue en staging

Precondiciones (solo lectura): host `srv1829292`, usuario `deploy`,
`/opt/tehus-crm` en `main` `b01a2ec` limpio; 6 contenedores healthy; runtime
`4d457df`; disco 11 %; sin procesos de deploy, backup, restic o `pg_dump` en
curso; 2 timers `tehus-*` activos, 0 unidades fallidas; backup del 2026-09-04
03:01 correcto y verificación del repositorio cifrado V2 con 3 instantáneas y
«no errors were found»; «Database schema is up to date!». Diff a desplegar:
109 ficheros, 0 fuera de `apps/` y `docs/`, 0 migraciones.

Procedimiento oficial `./deploy/scripts/deploy.sh` (desatendido, log privado
`chmod 600` en `/tmp`):

| Paso | Resultado |
| --- | --- |
| Rollback target registrado | `b01a2ec` |
| Pre-migration backup | DB `tehus-crm-staging-20260904-153221.sql.gz` (56K) + `.sha256`; uploads `…-uploads-20260904-153221.tar.gz` (900K) |
| `prisma migrate deploy` | 59 migraciones encontradas, «No pending migrations to apply» |
| `compose up -d` | backend, frontend y worker recreados; postgres, redis y caddy intactos |
| Health interno del script | **1 comprobación fallida**: `backend /api/health did not respond as expected (internal)`, junto a dos avisos («could not read queue state», «could not read aggregate system status») del mismo instante, mientras el contenedor recién recreado todavía arrancaba. La comprobación externa por HTTPS del mismo script, unos segundos posterior, sí pasó |
| `health-check.sh` reejecutado | **All checks passed** (12/12: contenedores, cola `up`, sistema `ok`, backend y frontend internos, ambos dominios con certificado válido) |
| `smoke-test.sh` (`EXPECTED_RELEASE=38c1575…`) | 22 passed, 0 failed (incluye «deployed release matches» y «el bundle del frontend apunta a api.crm-staging») |
| Release publicado | `38c1575743f7da7249feb9f8cc7bee63901a2a89` (`builtAt` 2026-09-04T20:29:52Z) |
| `/api/health/status` | `database`, `queue`, `worker`, `outbox`, `realtime` y `flowbot` en `up` |
| Producción | no tocada; sin DNS |

El fallo del health interno fue transitorio y no requirió rollback: el mismo
script pasa completo al reejecutarse y el smoke confirma el release. Queda
registrado como deuda operativa (el paso 11 debería reintentar la comprobación
interna antes de fallar).

## QA multiempresa en staging (datos `QA_PHASE4_<stamp>_*`, eliminados)

Sembradas por stdin dentro del contenedor: cuatro empresas con ADMIN y AGENT,
pipeline propio, productos y tareas. Contraseña aleatoria en archivo local
`chmod 600`, ya eliminado; nunca impresa ni en logs ni en capturas. Driver
Chrome headless + CDP contra `https://crm-staging.takto.online` con la API real:
**172 comprobaciones, 0 fallos, 0 errores de consola**, 44 capturas locales.

| Empresa (ancho) | Configuración | Verificado |
| --- | --- | --- |
| A — Mueblería (1440) | mixta; catálogo, cotizaciones, tareas | Navegación completa, «Catálogo» y «Nuevo elemento», Agenda de hoy, pipeline de 7 etapas |
| B — Veterinaria y pet shop (390) | mixta; **sin cotizaciones** | Sin «Cotizaciones» en navegación ni en «Crear»; ruta directa muestra a la asesora «Este módulo no está disponible» sin enlaces administrativos; API `403 MODULE_DISABLED`; catálogo y tareas intactos; sin términos de muebles |
| C — Software y tecnología (1024) | **solo servicios** | «Catálogo de servicios», «Nuevo servicio», sin selector ni filtro de tipo; la API crea SERVICE al omitir el tipo y rechaza PRODUCT con motivo; pipeline con Descubrimiento |
| D — Genérica (320) | **sin catálogo**, solo productos | Sin «Catálogo»; ruta directa bloqueada (ADMIN con explicación, enlace y «Activar módulo»; AGENT neutral); API 403; búsqueda sin productos |
| D — activar y desactivar | ADMIN | «Activar módulo» muestra el catálogo **sin volver a iniciar sesión**, con el producto que ya existía; desactivar desde Configuración pide confirmación («no borra nada»), la navegación se actualiza y la ruta vuelve a bloquearse |
| Anchos 320 / 390 / 768 / 1024 / 1280 / 1440 | A, ADMIN | 0 scroll horizontal, 0 controles sin nombre, navegación móvil utilizable |
| Consola / red | — | 0 errores; la única respuesta ≥400 es `401 /api/auth/refresh` del arranque anónimo (previo a la fase) |

Comprobaciones por API (con `Origin` de staging):

| Caso | Resultado |
| --- | --- |
| Módulo desactivado (catálogo en D, cotizaciones en B) para ADMIN y AGENT | 403 `{ code: MODULE_DISABLED, module }`, sin datos de la empresa |
| Módulo activo del mismo tenant | 200 |
| AGENT intenta configurar módulos | 403 |
| `companyId` en el cuerpo del PATCH | 400, sin efectos |
| Empresa «solo servicios»: omitir el tipo / pedir PRODUCT | 201 con `SERVICE` / 400 «…vende solo servicios…» |
| Producto o pipeline de otra empresa | 404 genérico en lectura y escritura |
| Búsqueda con el catálogo desactivado | sin el grupo `productos`, aunque se pida |
| Segunda etapa ganada | 400 |
| Reordenamiento parcial / completo | 400 / 200 |
| Renombrar con el propio nombre / con uno existente | 200 / 400 |
| Borrar la única etapa ganada | 400 |
| Estructura de pipeline por un AGENT | 403 |

Verificación en la base de staging: las cuatro empresas con sus módulos,
categorías, pipelines y tipos correctos; la de servicios sin un solo `PRODUCT`;
la genérica conserva su producto con el catálogo desactivado; auditoría
(`company.configuration.update`, `pipeline.update`, `pipeline.stages.reorder`)
**sin secretos**.

## Compatibilidad de las empresas reales (solo lectura)

Cómo resuelve la Fase 4 los módulos de las cuatro empresas que ya existían:

| Empresa | Guardado | Módulos efectivos | Compatibilidad aplicada | Catálogo |
| --- | --- | --- | --- | --- |
| Tehus Rattan | v1 con las tres banderas | los siete activos | ninguna (todo declarado) | solo `PRODUCT` |
| Empresa de demostración | v0 (sin settings), con productos, cotizaciones y tareas reales | los siete activos | catálogo, cotizaciones y tareas | ambos tipos |
| Empresa E2E temporal | v0 | los siete activos | catálogo, cotizaciones y tareas | ambos tipos |
| Takto CRM | v1 (solo servicios) | los siete activos | ninguna | solo `SERVICE` |

Sin la regla de compatibilidad, las dos empresas v0 habrían perdido tres
módulos con datos dentro. Ninguna configuración se reescribió por leerla.

## Limpieza y comparación antes/después

Borrado por ID exacto (`QA_CLEANUP=1`), verificando el prefijo de cada empresa:

| Tabla | Filas borradas |
| --- | --- |
| companies | 4 |
| users | 8 (4 ADMIN, 4 AGENT) |
| pipelines / pipeline_stages | 4 / 25 |
| products | 8 |
| tasks | 3 |
| audit_logs | 5 |
| login_events / user_sessions | 16 / 16 |
| quotes, contactos, oportunidades, notas, importaciones… | 0 |

Residuos: 0 empresas, 0 usuarios, 0 pipelines, 0 productos, 0 tareas,
0 auditoría, 0 sesiones.

Línea base (misma consulta `read only`, hashes `md5` de filas ordenadas por id):

| Métrica | Antes (pre-deploy) | Después (post-limpieza) |
| --- | --- | --- |
| companies | 4, hash `2466e01f…` | 4, hash `2466e01f…` (igual) |
| users | 9, hash `8654ed52…` | igual |
| invitation_codes | 3, hash `9fa3d97f…` | igual |
| pipelines / stages | 4 `61068a28…` / 23 `fa39f81d…` | iguales |
| products | 3, hash `28749f20…` | igual |
| audit_logs / sessions | 201 / 27 | 201 / 27 |
| login_events | 105 | 106 (+1: fila anónima FAILED del propio `smoke-test.sh`, como en la Fase 3; no es dato QA) |
| leads / contacts / quotes | 8 / 12 / 2 | iguales |
| tehus_present | 1 | 1 (Tehus sin cambios) |
| migrations_applied | 59 | 59 |

Post-limpieza: `/api/health/version` sigue en `38c1575…`, `health-check.sh`
«All checks passed», contenedores healthy, 2 timers activos, 0 unidades
fallidas, ficheros de branding sin cambios (0 en el host / 2 en el contenedor),
log del deploy con permisos 600.

## Cierre

- Producción, DNS, Meta/WhatsApp, correos reales: no tocados.
- Worktree principal (`chore/wa-signup-ops-script`, `send-demo-template.mjs`
  modificado, stash de `fix/security-hardening-20-controls`): intactos.
- Archivos locales temporales (credenciales, semillas, perfiles de Chrome):
  eliminados.
- Veredicto: **FASE 4 CERRADA — PASS**.
