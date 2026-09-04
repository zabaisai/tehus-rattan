# Fase 2 — Evidencia

Estado: **PASS** (2026-09-04). Todo lo que sigue son resultados reales: pruebas
locales, CI, despliegue oficial en staging, QA funcional con datos temporales
eliminados por ID y comparación antes/después. Sin secretos, sin IDs
completos, sin correos reales.

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

## QA visual local (2026-09-04)

Producto real levantado en local (backend `node dist/src/main` con la base de
desarrollo, frontend `next start` con el build de producción), sin mocks. Dos
recorridos con Chrome headless dirigido por CDP: uno como ADMIN y otro como
AGENT de una empresa temporal `QA_PHASE2_LOCAL_` (creada y eliminada por ID al
terminar; cero residuos). Anchos: 320, 360, 390, 768, 1024 y 1440 px.

| Pantalla | Comprobación | Resultado |
| --- | --- | --- |
| Configuración → Empresa (sección nueva) | scroll horizontal, controles con nombre accesible, valores cargados | 6/6 anchos sin scroll horizontal; 0 controles sin nombre |
| Configuración → Empresa como AGENT | controles deshabilitados, sin botón de guardar, aviso «Solo un administrador…» | 6/6 |
| Guardado real (ADMIN, navegador interactivo) | zona `Bogota` → error junto al campo sin llamar al servidor; `America/Costa_Rica` + `crc` + «Vende servicios» → «Configuración guardada.» | columnas `timezone=America/Costa_Rica`, `currency=CRC`, `settings` v2 con `futuro` conservado, 1 fila `audit_logs` (`sections: regional, commercial`) |
| Catálogo | badge Producto/Servicio por tarjeta (el elemento con `itemType NULL` sale como Producto), filtro «Solo servicios» deja una sola tarjeta | 6/6 anchos |
| Modal «Nuevo elemento del catálogo» | dentro del viewport, radios Producto (marcado)/Servicio, foco visible (`outline solid 2px`), Escape cierra | 6/6 |
| Importación → vista previa | CSV con columnas `Tipo` y `Tipo de elemento`: `Tipo`→Categoría, `Tipo de elemento`→Tipo de elemento; selector por columna con etiquetas legibles; nota del tipo; tabla ancha desplazable dentro de su contenedor, sin scroll de página | 6/6 |

Total: 54 comprobaciones automáticas, 0 fallos. Capturas fuera del repositorio.

## Seguridad del diff (2026-09-04)

- 60 archivos frente a `origin/main` `6c1de8d`; ninguno ajeno a la fase (el
  archivo modificado del worktree principal, `deploy/scripts/send-demo-template.mjs`,
  no forma parte del diff).
- Migración: solo `CREATE TYPE`, `ADD COLUMN` nullable sin default,
  `SET DEFAULT` para inserciones futuras y `CREATE INDEX`. Sin `DROP`,
  `TRUNCATE`, `UPDATE`, `RENAME` ni `DELETE`.
- Escaneo de secretos sobre las líneas añadidas (contraseñas, claves, tokens,
  hosts): sin hallazgos. Las únicas credenciales son las ficticias de las
  pruebas (`e2e-…`, `example.test`).
- Ninguna referencia a Tehus en el código añadido; ningún destino de
  producción (`crm.takto.online`, `api.crm.takto.online`) aparece.
- Guardas: los cuatro endpoints de configuración llevan `AuthGuard('jwt')`,
  `BusinessTenantGuard` y `RolesGuard` (clase), `@Roles` en los PATCH;
  `security-policy.spec.ts` y `dto-tenant-whitelist.spec.ts` los cubren.
  `companyId` nunca sale del cuerpo. Los DTOs nuevos rechazan claves
  desconocidas (`forbidNonWhitelisted`) y `itemType: null` (`ValidateIf`).
- CORS/CSRF/rate limiting: sin cambios.

## CI y PR

- PR #22 `feat/phase-2-tenant-configuration` → `main`, HEAD `a8d7823`
  (3 commits: motor + tipo de elemento + docs; ajuste de timeout de un test
  de Fase 1 que recorre el asistente entero; QA visual y seguridad del diff).
- CI del PR (run `33882974721`): Frontend (test / lint / build) **pass**
  2m33s; Backend (validate / test / build / e2e) **pass** 3m35s. Verde al
  primer intento, sin relanzar ningún job, sin flakes.
- Mergeable `CLEAN`. Fusionado con merge commit, igual que los PR anteriores:
  **`547f31f`** (`Merge pull request #22 …`). `main` local actualizado por
  fast-forward al mismo SHA.

## Precondiciones de staging (2026-09-04, antes del deploy)

| Comprobación | Resultado |
| --- | --- |
| Host / usuario / ruta | `srv1829292` / `deploy` / `/opt/tehus-crm` |
| Rama y HEAD del checkout | `main` en `6c1de8d`, worktree limpio (0 líneas) |
| `origin/main` antes del merge | `6c1de8d` (igual al checkout) |
| Runtime anterior | `5cb991f` (`/api/health/version`), backend/frontend/worker saludables |
| Contenedores | 6/6 en el estado esperado (postgres, redis, backend, worker, frontend, caddy) |
| Base | solo `tehus_crm_staging` |
| Disco | 10 % usado (88 G libres) |
| Procesos de deploy/migración/backup/restic/rclone en curso | ninguno |
| Timers | `tehus-backup.timer` (diario 03:00) y `tehus-backup-drill.timer` activos |
| Unidades fallidas | 0 |
| Último backup automático | 2026-09-04 03:00 exitoso (`Finished tehus-backup.service`) |
| Repositorio Restic V2 | legible (`--no-lock`): 3 snapshots, último 2026-09-04 03:00 |
| Diff VPS → merge | 60 archivos, solo `apps/` y `docs/`; sin cambios en `deploy/`, Caddy, DNS ni `.env.staging`; ninguna variable de entorno nueva |
| Línea base sanitizada (conteos y hashes md5 ordenados por id) | empresas 4, usuarios 9, productos 3, pipelines 4, etapas 23, invitaciones 3, auditoría 201, leads 8, cotizaciones 2, contactos 12, importaciones 0, migraciones aplicadas 58, Tehus presente |

## Despliegue en staging (2026-09-04 14:23 UTC)

Procedimiento oficial `./deploy/scripts/deploy.sh` desde `main`, sin tocar
Caddy, certificados, DNS ni `.env.staging`.

| Paso | Resultado |
| --- | --- |
| Pull `--ff-only` | `6c1de8d` → `547f31f` (rollback target impreso: `6c1de8d`) |
| Build | imágenes backend/frontend construidas para la release `547f31f` |
| Backup pre-migración | dump `…-20260904-092547.sql.gz` (52 K) con `.sha256` verificado (`OK`); uploads `…-uploads-20260904-092547.tar.gz` (900 K) con checksum; todos con modo `600` |
| `prisma migrate deploy` | 59 migraciones encontradas; aplicada `20260903180000_tipo_de_elemento_de_catalogo`; «All migrations have been successfully applied» |
| Servicios | backend, worker y frontend recreados; postgres, redis y caddy sin reiniciar |
| Health check (deploy) | «All checks passed» |
| Release | `/api/health/version` → `547f31fd6eea3ad91c84d18facc74db8f728407d`, `builtAt 2026-09-04T14:23:22Z` |

## Verificación técnica posterior

| Comprobación | Resultado |
| --- | --- |
| `health-check.sh` (30 s después) | 12/12 OK, «All checks passed» |
| `smoke-test.sh` con `EXPECTED_RELEASE=547f31f` | **22 passed, 0 failed** |
| `/api/health`, `/api/health/status` | `ok`; database, queue, worker, outbox (0 pendientes), realtime y flowbot `up` |
| TLS | Let's Encrypt válido en `crm-staging.takto.online` y `api.crm-staging.takto.online` (vence 2026-12-02) |
| CORS | preflight desde `https://crm-staging.takto.online` → `Access-Control-Allow-Origin` exacto (nunca `*`); desde un origen malicioso → sin cabecera |
| Login inválido | 401 genérico |
| Dominio antiguo del frontend | `crm-staging.tehusrattan.com/login` → **302** a `crm-staging.takto.online/login` |
| API antigua | `api.crm-staging.tehusrattan.com/api/health` → 200 (alias) |
| `takto.online` | 200, intacto |
| Producción | `crm.takto.online` y `api.crm.takto.online` **no resuelven** (NXDOMAIN): sin DNS, sin certificados, sin despliegue |
| Esquema | índice `products_companyId_isActive_itemType_idx` presente; default `'PRODUCT'::"CatalogItemType"`; los 3 productos existentes con `itemType = NULL` (sin backfill) |
| Hashes de empresas y productos tras la migración | idénticos a la línea base |

## QA funcional en staging (datos `QA_PHASE2_`, eliminados)

Dos empresas temporales creadas dentro del contenedor backend con un script
alimentado por stdin (contraseña temporal fuerte generada en local; solo el
hash bcrypt viajó al VPS; archivo local borrado al terminar):

- `QA_PHASE2_MIXED_<stamp>`: Colombia, settings **v1** legacy con clave
  desconocida `futuro`, pipeline **sin** `isDefault`, admin + agente.
- `QA_PHASE2_SERVICES_<stamp>`: Costa Rica, `America/Costa_Rica`, `CRC`,
  `es-CR`, settings **v2** solo servicios (`vertical` veterinaria),
  pipeline default, admin + agente.

Recorrido por la API pública (`https://api.crm-staging.takto.online`) con
sesiones reales obtenidas por `POST /auth/login`: **62 comprobaciones, 62 OK,
0 fallos**.

| Bloque | Qué se comprobó |
| --- | --- |
| Empresa A (mixta) | contrato v1 con `storageVersion 1`, pipeline por fallback determinista (3 etapas tipadas), modelo `products`, región por defecto; PATCH completo (región normalizada `america/bogota`→`America/Bogota`, `cop`→`COP`, `es-co`→`es-CO`; `sellsServices`; catálogo, cotizaciones y tareas; categorías propias) → `storageVersion 2`, modelo `mixed`; `GET /settings` histórico coherente |
| Catálogo A | PRODUCT explícito, SERVICE explícito, cliente antiguo sin tipo → PRODUCT; filtros `SERVICE` (1) y `PRODUCT` (2); edición de tipo conserva `sku` y `stock` |
| Empresa B (servicios) | contrato v2, identidad de la plantilla (`veterinary`/`clinic`, `templateVersion 2`), región de sus columnas, pipeline propio; **no recibe categorías de A**; cliente antiguo sin tipo → PRODUCT aunque venda solo servicios; AGENT consulta (200) y **no modifica** (403 en `/configuration` y `/settings`, estado intacto) |
| Aislamiento | A → producto de B: 404 genérico «Producto no encontrado» en GET/PATCH; B → DELETE de A: 404; cada empresa lista solo lo suyo |
| Negativos (400, sin escribir) | timezone inválida, currency inválida, locale inválido, campo desconocido, ambas ventas en falso, `pipeline` por PATCH, `settings` completo, `companyId`, `itemType` inválido en cuerpo y en filtro; estado idéntico antes/después; respuestas sin stack interno; sin token → 401 |
| Concurrencia | dos PATCH simultáneos (región Panamá/USD/es-PA y categorías+módulos) → ambos 200 y el estado final conserva **ambos** cambios y el `vertical` de origen |
| Importación | CSV con `Tipo` (→ categoría) y `Tipo de elemento` (→ tipo): 2 creados (PRODUCT y SERVICE), 1 fallido con motivo «Tipo de elemento no reconocido» en el reporte; CSV **sin** columna de tipo: 1 creado como PRODUCT y 1 actualizado por SKU **sin cambiar** su tipo SERVICE (precio sí actualizado); 0 archivos temporales de importación antes y después |
| Auditoría | 5 filas `company.configuration.update` (`entityType Company`, actor ADMIN) con `sections`/`fields`/`storageVersion`; 0 filas con valores (ni «Panamá» ni «Cirugía» aparecen en `metadata`) |
| Frontend (Chrome headless, 390 y 1440 px) | ADMIN de B: al crear un elemento el modal propone **Servicio** con el aviso «Tu empresa vende solo servicios…»; sin scroll horizontal; controles con nombre. AGENT de B: Configuración → Empresa con 9 controles deshabilitados, 0 habilitados, sin botón «Guardar configuración» y aviso «Solo un administrador…» |

## Limpieza y comparación antes/después

Script de limpieza ejecutado dentro del contenedor con los **dos IDs exactos**
(verifica que el nombre empiece por `QA_PHASE2_` antes de borrar), en orden de
dependencias: auditoría 5, importaciones 2, productos 8, etapas 6, pipelines 2,
eventos de login 7, sesiones 6, usuarios 4, empresas 2. Residuos: **0** en
empresas, usuarios, productos, pipelines, auditoría, sesiones e importaciones.
Archivos temporales de importación: 0. Scripts temporales del VPS borrados;
credenciales locales borradas.

Comparación con la línea base (misma consulta de solo lectura):

| Dato | Antes | Después |
| --- | --- | --- |
| Empresas / hash | 4 / `0aaae4…` | 4 / `0aaae4…` |
| Usuarios / hash | 9 / `8654ed…` | 9 / `8654ed…` |
| Productos / hash | 3 / `2eab05…` | 3 / `2eab05…` |
| Pipelines / hash | 4 / `04745c…` | 4 / `04745c…` |
| Etapas / hash | 23 / `fa39f8…` | 23 / `fa39f8…` |
| Invitaciones / hash | 3 / `3210fa…` | 3 / `3210fa…` |
| Auditoría | 201 | 201 |
| Leads / cotizaciones / contactos | 8 / 2 / 12 | 8 / 2 / 12 |
| Importaciones | 0 | 0 |
| Tehus presente | sí | sí (intacta) |
| Migraciones aplicadas | 58 | **59** (la única diferencia permanente, junto con el esquema y el runtime) |
| Productos con `itemType NULL` | n/a | 3 (todos los existentes; sin backfill) |
| Bases | `tehus_crm_staging` | `tehus_crm_staging` |

Sistema tras la limpieza: 6/6 contenedores sanos, 2 timers `tehus-*` activos,
0 unidades fallidas, sin procesos residuales, runtime `547f31f`.

## Cierre

- Implementación: PR #22 → merge `547f31f`. Release de staging `547f31f`
  (anterior `5cb991f`; `rollback-code.sh 6c1de8d` disponible, la columna
  aditiva se conserva).
- Migración `20260903180000_tipo_de_elemento_de_catalogo` aplicada; backup
  pre-migración verificado.
- Pruebas reales: backend 2399 unitarias + 1005 e2e; frontend 1051; CI verde;
  QA visual local 54/54; QA funcional de staging 62/62 + frontend ADMIN/AGENT.
- Limpieza por ID: 0 residuos; huellas de datos existentes idénticas.
- Producción no tocada (sin DNS, certificados ni despliegue).
- **FASE 2 CERRADA — PASS** (2026-09-04).
