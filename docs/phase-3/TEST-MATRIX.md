# Fase 3 — Matriz de pruebas

Resultados reales en local (worktree de la fase, 2026-09-04, Windows 11,
Node 24 / CI Node 22), con los MISMOS comandos que `.github/workflows/ci.yml`.

## Regresión completa

| Ámbito | Comando | Resultado |
| --- | --- | --- |
| Prisma validate | `npx prisma validate` | OK |
| Typecheck backend (incluye specs) | `npm run typecheck` | OK — 0 errores |
| Lint backend | `npx eslint "{src,apps,libs,test}/**/*.ts" --no-fix` | OK — 0 errores |
| Unitarias backend | `npm test -- --runInBand` | **147/147 suites, 2415/2415** (línea base 2399: +16) |
| Build backend | `npm run build` | OK |
| E2E backend (PostgreSQL y Redis reales, en serie) | `npm run test:e2e -- --runInBand` | **70/70 suites, 1039/1039** (línea base 1005: +34, nueva suite `onboarding-guiado`). La única roja de la primera pasada fue la expectativa `templateVersion: 2` de un e2e de Fase 1, actualizada a 3 (cambio de contrato, no regresión) |
| Typecheck frontend (incluye tests) | `npm run typecheck` | OK — 0 errores |
| Lint frontend | `npm run lint` | OK — 0 errores, 2 avisos anteriores a la fase |
| Pruebas frontend | `npm test` | **107/107 ficheros, 1081/1081** (línea base 1051: +30) |
| Build de producción frontend | `npm run build` | OK — 31 rutas |
| Migraciones | `prisma migrate diff` | ninguna nueva |

## Requisito → prueba

| Requisito | Prueba(s) | Tipo |
| --- | --- | --- |
| Catálogo de plantillas v3 = JSON publicado; industrias y tipos mínimos; coherencia; muebles solo en muebles; veterinaria comercial | `templates/onboarding-templates.spec.ts` (8) | unit |
| Comprobación de invitación sin consumir: ACTIVE ok; inválido/revocado/usado/vencido → 400; hash normalizado, prefijo irrelevante | `onboarding.service.spec.ts` › «checkInvitation» (5) · `onboarding-guiado.e2e-spec.ts` › «POST /onboarding/invitation/check» (4) | unit + e2e HTTP |
| Región validada y persistida en columnas; sin región → defaults; inválida → 400 antes de la transacción | `onboarding.service.spec.ts` (3 + 4 casos) · e2e: mueblería/vet/software/otro, «zona horaria inválida», «moneda inválida», «idioma inválido» | unit + e2e |
| Auditoría con plantilla, módulos, región y conteos; sin contraseñas ni código completo | `onboarding.service.spec.ts` «la auditoría registra…» · e2e mueblería (metadata + `not.toContain(password/code/hash)`) | unit + e2e |
| Cuatro industrias completan el onboarding con configuración correcta (`TenantConfigurationV1`) | e2e: «mueblería (showroom, Colombia)», «veterinaria y pet shop (Costa Rica)», «software (servicios)», «empresa genérica («Otro»)» | e2e HTTP |
| Invitación TAKTO y TEHUS temporal; usado dos veces → 400 | e2e «un código TEHUS temporal…», check TAKTO/TEHUS | e2e |
| Doble clic / dos peticiones concurrentes → una sola empresa | e2e «dos peticiones simultáneas…» · frontend «dos clics en Crear empresa envían una sola petición» | e2e + frontend |
| Mass assignment: `companyId`, rol privilegiado, `status`/`isDemo`, campos desconocidos → 400 sin efectos | e2e «rechazos sin efectos secundarios» (19 casos) | e2e |
| Invariantes de pipeline (sin OPEN / WON / LOST, duplicadas) y categorías duplicadas normalizadas | e2e (4 casos + «categorías duplicadas…») · `PipelineStep.test.tsx` (existente) | e2e + frontend |
| Email duplicado (existente y dentro de la petición) → 409 | e2e (2) | e2e |
| Fallo intermedio sin huérfanos | e2e: cada rechazo compara conteos antes/después e invitación ACTIVE · unit «cleans up the created company if saving the logo fails» (ahora borra sesión y eventos) | e2e + unit |
| Aislamiento entre empresas creadas | e2e «cada empresa creada ve solo su configuración» | e2e |
| Compensación de logos (huérfanos) | unit existente + ampliada | unit |
| Recomendación según industria y forma de vender; motivo en español | `onboarding-wizard.test.ts` (6) · `RecommendationStep.test.tsx` (5) · `page.test.tsx` «recomendaciones según las respuestas» (3) | frontend |
| Región: país propone; ediciones protegidas (conservar / aplicar); inválidos junto al campo | `onboarding-regions.test.ts` (3) · `RegionStep.test.tsx` (6) · `page.test.tsx` «región» (3) | frontend |
| Procedencia: diálogo «Conservar mis cambios» / «Aplicar las nuevas recomendaciones», «Restablecer recomendaciones», Sugerido/Editado | `page.test.tsx` «protección de ediciones» (2) | frontend |
| Renombrar categorías (posición, duplicados, Escape) | `CategoriesStep.test.tsx` (4) | frontend |
| Resumen ≡ payload; «Editar» por bloque; sin Tehus/muebles fuera de su plantilla | `page.test.tsx` «el resumen muestra exactamente lo que se envía…» · `onboarding-wizard.test.ts` «es determinista…» | frontend |
| Error del servidor conserva datos; éxito aunque falle la sesión automática | `page.test.tsx` (2) | frontend |
| Comprobación del código en el paso 1 con motivo; sin código no avanza | `page.test.tsx` «código de invitación» (2) | frontend |
| Stepper `aria-current`, estado textual, barra móvil con nombre; foco al error | `OnboardingProgress.test.tsx` (2) · `page.test.tsx` «accesibilidad» | frontend |
| Contraseñas con la política del backend; plantillas que no cargan → reintentar | `page.test.tsx` (2) + `AdminStep/AgentsStep.test.tsx` existentes | frontend |
| `/login?created=1` avisa | manual (QA local) | — |

## QA local con el producto levantado (Chrome headless + CDP, 2026-09-04)

Backend `node dist/src/main` y frontend `next start` con el build de
producción, base local; sin mocks. Empresa temporal `QA_PHASE3_<stamp>_*` y seis
invitaciones temporales (cinco TAKTO, una TEHUS); todo borrado por ID al final
(residuos: 0 empresas, 0 usuarios, 0 invitaciones).

| Flujo (ancho) | Resultado |
| --- | --- |
| Mueblería (1440) | Tienda / showroom, Colombia · America/Bogota · COP · es-CO, mixto, categorías Salas/Comedores/Sillas/Decoración/Instalación, 7 etapas (primera inicial, WON y LOST), ADMIN + AGENT, invitación USED, auditoría sin secretos, redirigido a `/dashboard` |
| Veterinaria y pet shop (390) | Costa Rica · America/Costa_Rica · CRC · es-CR, mixto, Consultas/Vacunas/Peluquería/Alimentos/Medicamentos, pipeline «Citas y pedidos» de 6 etapas, sin cotizaciones, sin términos de muebles |
| Software y tecnología (1024) | «Solo servicios» elegido; México · America/Mexico_City · MXN · es-MX, Implementación/Consultoría/Soporte/Licencias, 6 etapas con Descubrimiento, ADMIN + AGENT |
| Otro (320) | «Otro país» (Andorra · Europe/Andorra · EUR · ca-AD), «Configurar manualmente» con descripción «Distribuidora de insumos», sin catálogo (sin paso de categorías), pipeline neutral de 6 etapas |
| Resumen | En los cuatro flujos el resumen contiene nombre, correo del administrador y región; 9 acciones «Editar»; «Editar región» vuelve al paso y los datos se conservan |
| Doble clic en «Crear empresa» | una sola empresa por flujo |
| Anchos 320 / 390 / 768 / 1024 / 1280 / 1440 (paso «Recomendación») | 0 scroll horizontal, 0 controles sin nombre, `aria-current` en el paso actual, Tab llega al primer control con `outline solid 2px` |
| Comprobación TEHUS | el código TEHUS temporal se comprobó seis veces (paso 1) y siguió ACTIVE: comprobar no consume |
| Consola / red | 0 errores de consola; las únicas respuestas ≥400 son `401 /api/auth/refresh` del arranque anónimo de la app (comportamiento previo a la fase en cualquier página pública) |

## QA en staging (Chrome headless + CDP contra `crm-staging.takto.online`, 2026-09-04)

Release `4d457df`. Mismo driver que en local, con la API real de staging y un
`SUPER_ADMIN` temporal más seis invitaciones temporales (cinco TAKTO, una
TEHUS) sembradas en el contenedor y borradas por ID al final (0 residuos;
hashes de la línea base iguales antes y después). Detalle y tablas en
`STAGING-EVIDENCE.md`.

| Comprobación | Resultado |
| --- | --- |
| Mueblería (1440) / Veterinaria y pet shop (390) / Software y tecnología (1024) / Otro (320) | las cuatro empresas creadas y verificadas en la base: plantilla v3 correcta, región persistida en `Company`, categorías y pipeline de la plantilla, usuarios, invitación USED, auditoría sin secretos |
| Resumen y «Editar» | nombre, correo y región presentes; «Editar región» conserva los datos |
| Anchos 320–1440 (paso «Recomendación») | 0 scroll horizontal, 0 controles sin nombre, `aria-current`, foco visible tras Tab |
| Comprobación TEHUS | 201 `{"valid":true}` y el código siguió ACTIVE |
| Códigos usado / inválido / ausente | 400 con motivo, sin efectos |
| Mass assignment y `timezone` inválida | 400 antes de la transacción; el código de reserva siguió ACTIVE |
| Dos envíos simultáneos con el mismo código | una sola empresa; el código pasó a USED |
| Consola / red | 0 errores; solo `401 /api/auth/refresh` (previo a la fase) |
| Limpieza | 5 empresas, 8 usuarios, 6 invitaciones, 5 pipelines, 29 etapas, 5 auditorías, 5 sesiones, 5 eventos de login borrados por ID; residuos 0; Tehus intacto |
