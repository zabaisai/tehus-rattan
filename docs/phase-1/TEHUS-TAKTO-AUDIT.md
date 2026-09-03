# Fase 1 — Auditoría de referencias Tehus → TAKTO

Inventario sanitizado de todas las apariciones de `Tehus`, `TEHUS`, `tehus`,
`tehusrattan`, `tehus-rattan` y de los términos de muebles (`Sala(s)`,
`Comedor(es)`, `Silla(s)`, `Muebles`, `Primavera`) en el repositorio, con la
clasificación y la acción decidida para cada grupo. Base: `origin/main` en
`7b7aae8` (merge del PR #17). Búsqueda con `git grep` sobre archivos
rastreados; no se hizo ningún reemplazo automático.

Conteo inicial (archivos / líneas): `Tehus` 43 / 95 · `TEHUS` 8 / 20 ·
`tehus` 66 / 328 · `tehusrattan` 15 / 35 · `tehus-rattan` 7 / 21 ·
`Sala` 32 / 78 · `Comedor` 14 / 26 · `Silla` 15 / 37 · `Muebles` 19 / 46 ·
`Primavera` 7 / 12.

## Clasificaciones

| Clasificación | Acción |
|---|---|
| A. Identidad visible de plataforma | Cambiar a TAKTO |
| B. Valor predeterminado global | Neutralizar o convertir en plantilla |
| C. Dato real del tenant Tehus | Conservar |
| D. Fixture que representa un tenant | Conservar si está claramente aislado |
| E. Compatibilidad técnica | Migrar con fallback temporal |
| F. Infraestructura interna histórica | No renombrar; documentar |
| G. Evidencia histórica | Conservar con contexto |
| H. Referencia insegura o accidental | Corregir |

## A. Identidad visible de plataforma → cambiar a TAKTO

| Ubicación | Hallazgo | Acción |
|---|---|---|
| `README.md` (raíz, UTF-16) | Título único "Tehus Rattan" | Reescribir como README de TAKTO (UTF-8) |
| `.env.example:81`, `deploy/env/staging.env.example:123` | `SMTP_FROM_NAME=Tehus Rattan` como remitente general | `SMTP_FROM_NAME=TAKTO`; el código ya cae a `TAKTO` si la variable está vacía |
| `apps/frontend/src/components/onboarding/steps/CompanyInfoStep.tsx:39,49` | Placeholders "Tehus Rattan" y "Muebles y decoración" en el alta de cualquier empresa | Placeholders neutros |
| `apps/backend/prisma/schema.prisma:1538` | Comentario del modelo: ejemplo de vista previa `TEHUS-****` | Comentario con `TAKTO-****` (sin migración: es un comentario `//`) |
| `docs/DEPLOYMENT_RUNBOOK.md:3`, `docs/PASSWORD_RECOVERY.md:3`, `docs/SECURITY_HEADERS.md:3`, `docs/VPS_DEPLOYMENT.md:1`, `docs/WHATSAPP_EMBEDDED_SIGNUP.md:3`, `docs/WHATSAPP_REAL_TEST_CHECKLIST.md:5`, `docs/PLATFORM_ADMIN.md:6` | "CRM de Tehus Rattan" como nombre del producto en documentación operativa vigente | Renombrar a "CRM TAKTO" en esas frases; el resto del contenido no cambia |

Ya estaban en TAKTO antes de esta fase (verificado, sin cambio): `layout.tsx`
(`metadata.title`, `applicationName`, Open Graph, Twitter), `site.webmanifest`,
favicon/PWA/OG en `public/`, `TaktoLogo`, login, recuperación de contraseña,
página raíz, barra lateral (franja TAKTO + bloque de empresa), remitente por
defecto de `MailService` (`'TAKTO'`), plantillas de FlowBot (con prueba que
prohíbe mencionar Tehus), pie y cabecera de documentos (sin datos fiscales
fijos).

## B. Valor predeterminado global → neutralizar o convertir en plantilla

| Ubicación | Hallazgo | Acción |
|---|---|---|
| `apps/frontend/src/lib/products.ts` → `PRODUCT_CATEGORIES` | Lista fija de muebles para el filtro del catálogo y el selector del producto de TODAS las empresas | Sustituir por las categorías efectivas de la empresa (`Company.settings`) con entrada libre |
| `apps/frontend/src/components/onboarding/steps/CommercialStep.tsx` → `SUGGESTED_CATEGORIES` | Sugerencias de muebles a cualquier empresa nueva | Motor de plantillas por industria/tipo de negocio |
| `apps/frontend/src/app/onboarding/page.tsx` | Pipeline único "Ventas" con etapas de muebles y sin tipos WON/LOST; colores por defecto `#A57014/#FDDC7F/#FAF8F3` (coinciden con un tenant existente); `sellsProducts/usesCatalog` en `true` por defecto | Plantillas versionadas con tipos explícitos; sin colores pre-rellenados (apariencia inicial neutral TAKTO); módulos derivados de la selección |
| `apps/frontend/src/app/dashboard/settings/company/page.tsx:177-179` | Fallback de colores de empresa = colores del tenant existente | Fallback neutral de plataforma solo para mostrar, nunca persistido |
| `apps/frontend/src/components/products/ProductModal.tsx:87,118,124` | Placeholders "Sala Primavera", "Ratán natural…", precio de ejemplo | Placeholders neutros |
| `apps/frontend/src/components/quotes/CreateQuoteModal.tsx:70` | Placeholder "Cotización sala Primavera" | Placeholder neutro |
| `docs/contracts/onboarding-templates.v1.json` | Inventario de la plantilla implícita de muebles | Sustituido por `onboarding-templates.v2.json` generado desde el código |
| `docs/contracts/company-settings.v2.schema.json` | Borrador no implementado | Actualizado a la forma implementada |

## C. Dato real del tenant Tehus → conservar

Todo lo que vive en la base de datos de staging (nombre, slug, logos,
colores, categorías guardadas en `settings`, productos, pipeline, usuarios,
contactos, leads, conversaciones) queda intacto. No hay ningún script ni
migración en esta fase que lea o escriba datos de Tehus; los settings v1
existentes se leen tal cual mediante el normalizador (nunca se reescriben).

## D. Fixtures que representan un tenant → conservar

Todos aislados en pruebas o scripts de demostración, con dominios ficticios
(`*.tehus.test`, "Tehus QA", "Tehus Rattan" como nombre de empresa de
ejemplo):

- Backend specs: `companies.service.spec.ts`, `update-company.dto.spec.ts`,
  `onboarding.service.spec.ts`, `onboarding.controller.spec.ts`,
  `auth.service.spec.ts`, `platform-audit-log.service.spec.ts`,
  `whatsapp-embedded-signup.service.spec.ts`, `whatsapp-meta-client.service.spec.ts`,
  `mail.service.spec.ts` (prueba que un `SMTP_FROM_NAME` configurado se respeta),
  `quote-pdf.desglose.spec.ts`, `quote-caso-staging.ts`.
- Backend e2e: `platform-*.e2e-spec.ts`, `support-sessions.e2e-spec.ts`,
  `whatsapp-embedded-signup.e2e-spec.ts`, `demo-restablecer.e2e-spec.ts`,
  `importacion-catalogo.e2e-spec.ts`, `perfil-comercial.e2e-spec.ts`,
  `quotes-*.e2e-spec.ts`.
- Frontend tests: `Sidebar.test.tsx`, `PerfilComercial.test.tsx`,
  `WhatsAppConnect.test.tsx`, `DocumentHeader/Footer.test.tsx`,
  `QuotePrintableDocument.test.tsx` (estas últimas verifican precisamente que
  NO aparezca Tehus para otro tenant).
- Scripts de demo: `demo-socio*.ts`, `qa-seed.mjs`, `importacion-*.mjs`
  ("Muebles Aurora", "Silla tapizada…"): datos de una empresa ficticia con
  prefijo, no valores de plataforma.
- `apps/backend/src/modules/invitation-codes/onboarding-invite.guard.spec.ts`
  y `onboarding.service.spec.ts` usan códigos `TEHUS-…` ficticios: se
  conservan como casos de **código legacy**, y se añaden casos `TAKTO-…`.

## E. Compatibilidad técnica → migrar con fallback temporal

| Ubicación | Nombre actual | Nombre canónico | Estrategia |
|---|---|---|---|
| `apps/backend/src/modules/sessions/sessions.constants.ts` | `tehus_refresh_token` | `takto_refresh_token` | Escribir el nuevo; leer nuevo → legacy; limpiar ambos en logout; borrar el legacy en cuanto se rota |
| Ídem | `tehus_device_id` | `takto_device_id` | Adoptar el valor legacy en la cookie nueva la primera vez; limpiar el legacy |
| `apps/backend/src/common/throttle/app-throttler.guard.ts` | lee `tehus_device_id` | lee nuevo → legacy | Mismo cubo por dispositivo durante la transición |
| `apps/frontend/src/lib/auth-events.ts` | `BroadcastChannel('tehus-auth')` | `takto-auth` | Emitir en el nuevo; escuchar ambos durante la transición |
| `apps/frontend/src/lib/axios.ts` | Web Lock `tehus-auth-refresh` | `takto-auth-refresh` | Cambio directo: el backend serializa con compare-and-swap; dos pestañas con bundles distintos solo coexisten durante el despliegue |
| `apps/backend/src/modules/invitation-codes/invitation-code.util.ts` | prefijo `TEHUS` | `TAKTO` | Solo afecta a la generación y a la vista previa de códigos nuevos; los códigos `TEHUS` se validan por hash en base de datos y siguen siendo válidos según su estado |
| `deploy/Caddyfile`, `deploy/env/staging.env.example`, `deploy/scripts/health-check.sh`, `deploy/scripts/smoke-test.sh`, `docs/VPS_DEPLOYMENT.md`, `docs/DEPLOYMENT_RUNBOOK.md` | dominios `*.tehusrattan.com` | `crm-staging.takto.online` / `api.crm-staging.takto.online` | Dominios nuevos canónicos; API antigua como alias; frontend antiguo redirigido; ver `DOMAIN-MIGRATION.md` |
| `apps/backend/src/common/guards/cookie-origin.guard.spec.ts`, `apps/backend/test/cookie-origin.e2e-spec.ts`, `apps/frontend/src/lib/build-guard.ts` | dominio antiguo como valor de ejemplo | dominio nuevo | Actualizar el ejemplo; la lógica no depende del dominio |
| `docs/AUTH_SESSION_SECURITY.md:73,80,161` | nombres técnicos antiguos | nombres nuevos + nota de compatibilidad | Actualizar |

## F. Infraestructura interna histórica → no renombrar; documentar

Nombres que forman parte de infraestructura ya verificada en la Fase 0
(backups, timers, rutas, volúmenes, base de datos) y que no representan la
marca pública. Se congelan hasta una fase de infraestructura futura:

| Nombre | Dónde |
|---|---|
| `/opt/tehus-crm` | VPS, `deploy/scripts/*.sh`, `deploy/systemd/*`, docs operativas |
| `tehus_crm_staging` (base), `tehus_restore_drill*` (bases de drill) | `.env.staging`, `deploy/env/backup.env.example`, scripts de restore |
| `tehus-backup.service/timer`, `tehus-backup-drill.*`, `tehus-backup-init.service` | `deploy/systemd/` |
| `tehus-crm-staging` (proyecto Compose), contenedores `tehus-crm-staging-*`, redes `tehus-crm-staging_proxy/_internal`, volúmenes | `docker-compose.staging.yml` (`name:`), `deploy/Caddyfile` (comentario de red de `takto-web`) |
| `RESTIC_HOST=tehus-crm-staging`, tag `takto-staging`, artefactos `tehus-crm-staging-*.sql.gz` | repositorio Restic v2 e histórico |
| `.tehus-offsite-backup.lock`, `.tehus-restore-drill.lock` | `backup-offsite.sh`, `backup-restore-drill.sh` |
| `tehus-rollback-*`, imágenes `tehus-backend:rollback-*` | `deploy/scripts/rollback-code.sh` |
| `tehus_postgres`, `tehus_rattan`, `tehus_user` (entorno local de desarrollo) | `docker-compose.yml`, `.env.example`, `apps/backend/scripts/verificar-ruta-de-migracion.sh` |
| `tehus_vps_ed25519` (nombre de la clave SSH del operador) | `docs/VPS_DEPLOYMENT.md` |
| Repositorio GitHub `zabaisai/tehus-rattan` y carpeta local `Tehus_Rattan` | URLs de CI en docs, rutas en docs de estado |
| `admin@tehusrattan.com` (contacto ACME de Caddy) | `deploy/Caddyfile` — se mantiene hasta que el propietario indique un buzón monitorizado bajo `takto.online` |

## G. Evidencia histórica → conservar con contexto

`docs/phase-0/*`, `docs/TAKTO-*-STATE.md`, `docs/TAKTO-PAUSA-Y-REANUDACION-*`,
`docs/TAKTO-BRANDING-ESTADO-*`, `docs/TAKTO-FINAL-RELEASE-GATE.md`,
`docs/TAKTO-FUNCTIONAL-HARDENING-*`, `docs/takto-desktop/*`,
`docs/COMPANY_FISCAL_IDENTITY.md` (describe la eliminación de datos fiscales
fijos de Tehus), `docs/CRM_ROADMAP.md` (roadmap "Tehus-first" de julio de
2026, anterior a la separación). Se conservan tal cual: describen sesiones
pasadas con sus dominios, rutas y correos de esa fecha. `CRM_ROADMAP.md`
recibe una nota de cabecera indicando que es un documento histórico previo
a la Fase 1.

## H. Referencia insegura o accidental → corregir o documentar

| Ubicación | Hallazgo | Acción |
|---|---|---|
| `apps/backend/src/generated/prisma/*` (27 archivos rastreados) | Cliente Prisma generado y **rastreado en Git** pese a `apps/backend/.gitignore:58`; contiene rutas absolutas de la máquina del desarrollador (`C:\Users\...\Tehus_Rattan\...`) | No se toca en esta fase (regenerarlo cambiaría 27 archivos ajenos al alcance); se registra como deuda técnica en `README.md` de la fase |
| `docker-compose.staging.yml` `args: NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL}` | Aviso "variable is not set" al invocar Compose sin `--env-file` (health check, backup) | Valor por defecto vacío en Compose; la construcción de producción sigue fallando de forma explícita si la URL falta (`build-guard.ts`) |

## Términos de muebles fuera de la plantilla de muebles (estado final esperado)

Tras la fase, `Sala/Comedor/Silla/Muebles/Primavera` solo pueden aparecer en:
la plantilla `furniture_decor` (código y contrato JSON), fixtures de pruebas y
scripts de demostración (clasificación D), y documentación histórica
(clasificación G). Ningún componente visual, placeholder, valor por defecto o
lista global puede contenerlos.
