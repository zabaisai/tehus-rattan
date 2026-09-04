# Fase 3 — Onboarding multiindustria guiado, progresivo y editable

Convierte el asistente de alta en un flujo guiado por las respuestas de la
persona: industria, país, forma de vender → recomendación explicada de
plantilla, módulos, categorías y pipeline, todo editable y protegido contra
sobrescrituras, con un resumen que es exactamente el payload que se envía.

TAKTO es la plataforma y propietaria del CRM; Tehus Rattan es una empresa
cliente más. Nada de esta fase toma a Tehus o a los muebles como valor por
defecto: los términos de muebles solo aparecen en la plantilla de muebles.

Rama: `feat/phase-3-guided-onboarding` (desde `origin/main` `7630b61`),
fusionada en `main` `4d457df` (PR #24).
Worktree aislado; el worktree principal y su archivo ajeno
(`deploy/scripts/send-demo-template.mjs`) no se tocan.

## Documentos

| Documento | Contenido |
|---|---|
| [GAP-ANALYSIS.md](GAP-ANALYSIS.md) | Requisito → evidencia en `main` → brecha → acción → prueba |
| [ONBOARDING-CONTRACT.md](ONBOARDING-CONTRACT.md) | Endpoints, payload final, creación atómica, auditoría, flujo del asistente, procedencia de ediciones, accesibilidad |
| [TEMPLATE-CATALOG.md](TEMPLATE-CATALOG.md) | Catálogo canónico v3 y cómo lo usa el asistente |
| [TEST-MATRIX.md](TEST-MATRIX.md) | Qué prueba cubre cada requisito y resultados reales |
| [STAGING-EVIDENCE.md](STAGING-EVIDENCE.md) | Evidencia sanitizada de pruebas, CI, despliegue y QA |
| [ROLLBACK.md](ROLLBACK.md) | Cómo volver atrás (sin migración) |
| [CURRENT-STATUS.md](CURRENT-STATUS.md) | Estado para reanudar el trabajo |
| [../contracts/onboarding-templates.v3.json](../contracts/onboarding-templates.v3.json) | Contrato publicado de plantillas (validado por prueba) |

## Alcance

Backend: plantillas v3 (muebles mixto con Sillas e Instalación; «Veterinaria y
pet shop»; «Software y tecnología»; pipeline neutral para «Otro»);
`POST /onboarding/invitation/check` (comprueba sin consumir); región
(`timezone`, `currency`, `locale`, `country`) en el DTO y el servicio con los
normalizadores de la Fase 2, persistida en las columnas de `Company`;
auditoría con plantilla, módulos, conteos y región; compensación que también
borra sesión y eventos de login; e2e HTTP de las cuatro industrias,
invitaciones TAKTO/TEHUS, estados del código, concurrencia y mass assignment.

Frontend: pasos «Región» (país → zona/moneda/idioma propuestos), «Forma de
vender» y «Recomendación» (plantilla recomendada explicada; usar / otra /
manual; «Restablecer recomendaciones»); procedencia por sección con diálogo
«Conservar mis cambios» / «Aplicar las nuevas recomendaciones»; renombrar
categorías; resumen desde `buildOnboardingPayload` con «Editar» por bloque;
comprobación previa del código; guarda de doble envío; éxito aunque falle la
sesión automática; stepper con `aria-current`, foco al error, reduced motion.

No incluido (fases posteriores): ocultar navegación por módulos y gestión de
múltiples pipelines (Fase 4), backfill de `itemType` y migración de empresas
existentes (Fase 5), producción, editor de plantillas en Super Admin,
persistencia de borrador en el navegador.

## Plan y estado

| # | Etapa | Estado |
|---|---|---|
| 1 | Inspección y análisis de brechas | HECHA — `GAP-ANALYSIS.md` |
| 2 | Backend (plantillas v3, región, comprobación de invitación, auditoría) | HECHA |
| 3 | Frontend (asistente guiado) | HECHA |
| 4 | Pruebas (unitarias, e2e HTTP, frontend) | HECHA — local y CI (PR #24, verde al primer intento) |
| 5 | QA local (4 flujos reales, 320–1440 px) | HECHA — ver `TEST-MATRIX.md` § QA local |
| 6 | PR, CI y merge | HECHA — PR #24 → `main` `4d457df` (merge commit) |
| 7 | Backup y despliegue en staging | HECHA — release `4d457df`, backup con checksums, 0 migraciones, smoke 22/22 |
| 8 | QA funcional en staging (4 industrias) y limpieza | HECHA — ver `STAGING-EVIDENCE.md`; 0 residuos, línea base igual |
| 9 | Documentación y cierre | HECHA — rama `docs/phase-3-closure` |

Estado de la fase: **FASE 3 CERRADA — PASS** (2026-09-04). Fase 4 no iniciada.

## Migraciones

Ninguna. Ver `ROLLBACK.md`.

## Fuera de alcance (no realizado)

Producción (DNS, certificados, despliegue), Meta/WhatsApp, correos reales,
Google Cloud, rclone/Restic, renombres de infraestructura, modificación de
empresas existentes, backfill. Asahel y Cristian no participan.
