# Identidad fiscal por empresa (multiempresa)

Rama de origen: `feature/staging-readiness` (Fase 1 de Staging Readiness).

Convierte la identidad de las cotizaciones y documentos imprimibles en algo
**por empresa**, eliminando los datos fiscales de Tehus Rattan que antes
estaban hardcodeados y se imprimían para cualquier empresa.

## 1. Campos fiscales por empresa

Se añadieron a `Company` (todos opcionales, aditivos, sin default):

| Campo | Descripción |
| --- | --- |
| `legalName` | Razón social. |
| `taxId` | Identificación fiscal / NIT. |
| `address` | Dirección. |
| `quoteFooter` | Texto/condiciones opcionales para el pie de las cotizaciones. |

Campos ya existentes que también componen la identidad del documento:
`name` (nombre comercial), `email`, `phone`, `city`, `country`, `website`,
`logoUrl`.

## 2. Cómo configurarlos

`Dashboard → Empresa` (ruta `/dashboard/settings/company`), sección
**"Identidad fiscal (para cotizaciones)"**. Todos los campos son opcionales.
Se guardan con `PATCH /companies/me`, que:

- Usa siempre `req.user.companyId` del JWT — nunca un `companyId` del body.
- Normaliza (trim) y valida longitudes (`legalName` ≤150, `taxId` ≤50,
  `address` ≤200, `quoteFooter` ≤2000).
- Rechaza (400) cualquier campo no permitido gracias al `ValidationPipe`
  global (`whitelist` + `forbidNonWhitelisted`).

## 3. Cómo los usa una cotización

`GET /quotes/:id` incluye la empresa **dueña** de la cotización mediante un
`select` explícito y curado (`COMPANY_IDENTITY_SELECT`), aislado por
`where: { id, companyId }`. El frontend construye una estructura tipada
(`DocumentCompanyIdentity`) desde `quote.company` y la pasa explícitamente a la
plantilla:

- Encabezado (`DocumentHeader`): logo + nombre comercial + razón social.
- Pie (`DocumentFooter`): NIT, email, teléfono, dirección/ciudad/país, web.
- Condiciones (`DocumentTermsAndConditions`): `quoteFooter` de la empresa.
- Firma (`DocumentSignatureBlock`): "Firma {nombre de la empresa}".

La identidad proviene de la **empresa dueña de la cotización** (resuelta en el
backend), no del visor ni de estado manipulable del navegador. La calculadora
de documentos (`/dashboard/documents/calculator`) usa la empresa del usuario
autenticado (`GET /companies/me`) para el documento en blanco que crea.

## 4. Qué sucede con campos vacíos

Cada línea se **omite** si el campo está vacío — sin etiquetas colgantes,
comas ni separadores sobrantes. Si la empresa no tiene ningún dato fiscal, el
pie no se renderiza. **No hay fallback global ni datos de Tehus**: el único
fallback del nombre es el nombre registrado de la empresa.

## 5. Permisos

- **ADMIN** y **SUPER_ADMIN con `companyId`**: editan solo su propia empresa
  (`req.user.companyId`).
- **AGENT**: visualiza (la identidad viaja con la cotización que puede abrir)
  pero no edita (`PATCH /companies/me` está restringido por `RolesGuard`).
- **SUPER_ADMIN de plataforma** (`companyId = null`): `BusinessTenantGuard`
  bloquea `/companies/me`; administra empresas por el módulo de plataforma. No
  puede editar accidentalmente otra empresa por esta vía.

Ver `docs/permissions-matrix.md`.

## 6. Migración

`prisma/migrations/20260723160000_add_company_fiscal_identity/migration.sql`:
aditiva, cuatro columnas `TEXT` nullable en `companies`. No borra ni renombra
columnas. Aplicable a `localhost:5432/tehus_rattan`. Verificada aplicándose en
orden sobre una base local vacía sin destruir datos existentes.

## 7. Limitación actual — snapshot histórico (pendiente)

`QuoteItem` ya es un snapshot (nombre/precio congelados al crear la cotización),
pero la **identidad fiscal de la empresa se lee en vivo** al imprimir. Si una
empresa cambia su NIT/dirección, las cotizaciones antiguas mostrarán los datos
nuevos.

**Recomendación (fase posterior, no implementada aquí):** columna
`Quote.companySnapshot Json?` poblada al pasar la cotización a `SENT` (o al
crearla), con la identidad fiscal del momento. La plantilla preferiría el
snapshot y caería a la empresa viva si es null. Es un cambio aditivo con lógica
de ciclo de vida; se dejó fuera de alcance para no rediseñar el módulo ahora.

## 8. Hallazgos P1/P2 resueltos

- **P1-1**: pie fiscal global hardcodeado → identidad fiscal por empresa
  (Empresa A y Empresa B producen documentos distintos; ninguna empresa QA
  imprime el NIT/email/dirección de Tehus). También se eliminó el texto legal
  Colombia-específico hardcodeado (`DOCUMENT_TERMS_AND_CONDITIONS`) → ahora es
  `Company.quoteFooter` por empresa.
- **P2-1**: Productos con "Catálogo Tehus" / "Tehus Rattan Medellín" → encabezado
  neutral + subtítulo con nombre (y ciudad si existe) de la empresa.
- **P2-2**: Dashboard "Resumen general de Tehus Rattan." → nombre de la empresa
  autenticada; texto neutral cuando no hay empresa.
- **P2-3**: Auditoría con acciones crudas → mapa completo (incl. REVOKE_SESSION,
  REVOKE_ALL_USER_SESSIONS, REVOKE_ALL_COMPANY_SESSIONS, CREATE/REVOKE/USE_
  INVITATION_CODE) + `humanizeAction` para futuras acciones.
- **P2-4**: Tabla de empresas a 768px con filas altas → tarjetas hasta `lg`,
  tabla desde `lg`.
- **P2-5**: Cotización imprimible en 360px → scroll horizontal explícito y
  contenido (sin afectar el tamaño de impresión).
- **P2-6**: Placeholder de Productos truncado a 360px → texto corto
  ("Buscar productos") + buscador a ancho completo apilado sobre el filtro.

## 9. Pruebas ejecutadas

- Backend: 50 suites / 537 unit tests; 12 suites / 108 e2e (solo Postgres
  local, sin llamadas externas).
- Frontend: 11 archivos / 43 tests (incluye render de identidad por empresa,
  ausencia de "Tehus Rattan" en otro tenant, pie con y sin campos opcionales,
  dos empresas sin contaminación, dashboard/productos/auditoría).
- Builds y lint: frontend y backend OK.
- Migraciones: aplican en orden sobre BD local vacía.
- Verificación visual: 360/390/768/1440 con Empresa A y Empresa B — documentos
  distintos, sin datos de Tehus, sin overflow, sin errores de consola/HTTP.

## 10. Pendientes de fases siguientes (Staging/Seguridad)

- Snapshot histórico de identidad de empresa en cotizaciones (sección 7).
- Validación de firma `X-Hub-Signature-256` en el webhook de WhatsApp.
- Rate limiting.
- Endurecimiento de JWT (rotación/expiración/secretos).
- Headers de seguridad / CSP.
- Backups externos.
- Observabilidad (logs estructurados, métricas, trazas).
