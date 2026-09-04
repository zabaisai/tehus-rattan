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
