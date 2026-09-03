# Fase 1 — Contrato del onboarding por industria

## Principios

1. **Las plantillas son sugerencias.** Nada de lo que propone una plantilla es
   obligatorio: el usuario puede añadir, editar, eliminar y reordenar módulos,
   categorías y etapas, y siempre existe «Otro / Configurar manualmente».
2. **Versionadas en código, no en componentes.** La fuente de verdad es
   `apps/backend/src/modules/onboarding/templates/onboarding-templates.ts`
   (`ONBOARDING_TEMPLATES_VERSION = 2`). Se publica como
   `docs/contracts/onboarding-templates.v2.json` y una prueba
   (`onboarding-templates.spec.ts`) exige que ambos sean idénticos. El JSON se
   regenera desde el código, nunca se edita a mano:

   ```bash
   cd apps/backend
   node --input-type=module -e "import fs from 'node:fs'; const m = await import('./src/modules/onboarding/templates/onboarding-templates.ts'); fs.writeFileSync('../../docs/contracts/onboarding-templates.v2.json', JSON.stringify(m.ONBOARDING_TEMPLATES, null, 2) + '\n');"
   ```
3. **Un solo dato para frontend y backend.** El asistente pide las plantillas a
   `GET /onboarding/templates` (público, solo lectura, limitado por IP,
   registrado con motivo en la política de acceso de controladores). El
   backend valida el resultado final que envía el usuario, no la sugerencia.
4. **Sin editor en Super Admin.** Cambiar una plantilla es un cambio de código
   con revisión, pruebas y CI. Un editor dinámico queda fuera de esta fase.
5. **Nada de Tehus ni de muebles como valor por defecto.** La industria por
   defecto es `generic`; `furniture_decor` es una industria más.

## Jerarquía

```text
Industria
  → Tipo de negocio (siempre incluye «Otro / Configurar manualmente»)
    → Modelo comercial (products | services | mixed; editable)
      → Módulos sugeridos (catálogo, cotizaciones, tareas; los centrales van siempre)
        → Categorías sugeridas (solo si catálogo activo)
          → Pipeline sugerido (etapas con tipo OPEN/WON/LOST)
            → Personalización manual (todo editable; «Restaurar sugerencias»)
```

Comportamiento del asistente (`apps/frontend/src/app/onboarding/page.tsx`):

- Al cambiar industria se recargan los tipos; al cambiar tipo se recalculan
  módulos, categorías y pipeline.
- Cada sección lleva estado **Sugerido** o **Editado**. Si hay secciones
  editadas y el usuario cambia de plantilla, se pide confirmación:
  «Aplicar sugerencias» reemplaza todo; «Cancelar» aplica la nueva selección
  pero conserva las secciones editadas.
- «Restaurar sugerencias» devuelve una sección a la plantilla actual.
- El paso de categorías solo existe con catálogo activo; sin catálogo no se
  envían categorías aunque se hubieran marcado antes.
- Si no hay asesores adicionales se continúa solo con el administrador; con
  asesores se rechazan correos duplicados (entre sí y con el administrador).
- La información se conserva al ir atrás y adelante; el resumen final muestra
  actividad, módulos, categorías, pipeline con tipos, branding y usuarios.
- Validación en frontend (aviso junto al campo) y en backend (400) con las
  mismas reglas y límites.

## Industrias y tipos (versión 2)

| Industria | Tipos de negocio |
|---|---|
| `generic` Genérico | `products` Venta de productos · `services` Venta de servicios · `mixed` Modelo mixto · `other` |
| `retail_ecommerce` Retail y ecommerce | `physical_store` Tienda física · `ecommerce` Ecommerce · `wholesale` Distribuidor / mayorista · `other` |
| `furniture_decor` Muebles y decoración | `showroom` Tienda / showroom · `interior_design` Diseño de interiores · `custom_manufacturing` Fabricación personalizada · `other` |
| `veterinary_pet` Veterinaria y mascotas | `clinic` Clínica veterinaria · `pet_shop` Pet shop · `grooming` Grooming · `boarding` Guardería / hotel · `other` |
| `professional_services` Servicios profesionales | `consulting` Consultoría · `agency` Agencia · `technical_services` Servicios técnicos · `projects` Proyectos · `other` |
| `real_estate` Bienes raíces | `sale` Venta · `rent` Arriendo · `new_projects` Proyectos nuevos · `other` |
| `automotive` Automotriz | `dealership` Concesionario · `workshop` Taller · `parts` Repuestos / accesorios · `other` |

Veterinaria y mascotas es **estrictamente comercial** (citas, reservas,
seguimiento). Una prueba prohíbe términos médicos (historia clínica,
diagnóstico, receta, tratamiento) en esa plantilla. Otra prueba garantiza que
los términos de muebles solo aparecen en `furniture_decor`.

Cada tipo declara: `businessModel`, `modules` (`catalog`, `quotes`, `tasks`),
`categories` (vacío si no usa catálogo; subconjunto de
`categorySuggestions` de su industria) y `pipeline` (nombre + etapas).
Detalle completo en `docs/contracts/onboarding-templates.v2.json`.

## Módulos

Centrales (siempre): conversaciones, contactos, oportunidades, pipeline.
Opcionales: catálogo, cotizaciones, tareas/seguimientos. Son exactamente las
capacidades que el producto tiene hoy; no se inventa ninguna. Las banderas
`sellsProducts`/`sellsServices` derivan del modelo comercial.

## Categorías

- Sugeridas por el tipo; si el usuario activa catálogo en un tipo que no lo
  traía, se ofrecen las de la industria.
- Editables: marcar/desmarcar, añadir propias, sin duplicados (sin distinguir
  mayúsculas ni espacios), sin vacíos.
- Límites compartidos (`CATEGORY_LIMITS`, backend y frontend): 60 caracteres,
  30 categorías.
- Se guardan en `Company.settings.catalog.categories` y las leen: filtro del
  catálogo, formulario de producto (texto libre + sugerencias), filtro de
  «agregar producto a oportunidad» y el editor de *Configuración → Empresa*.
  Los productos existentes conservan su categoría; las categorías presentes
  en productos se suman a las opciones de filtro. Ninguna empresa ve las de
  otra (todo va por `companyId` del token).

## Pipelines

- Toda plantilla usa tipos explícitos: `OPEN`, `WON`, `LOST`.
- Base genérica: Nuevo lead · Contactado · Calificado · Propuesta o cotización ·
  Negociación · Cerrado ganado (WON) · Cerrado perdido (LOST).
- Invariantes (`validateTypedStages`, backend; `validatePipeline`, frontend):
  al menos una OPEN, exactamente una WON, exactamente una LOST, nombres
  únicos y no vacíos, máximo 40 caracteres y 20 etapas; orden conservado; la
  primera etapa OPEN se marca `isInitial`.
- Compatibilidad: la forma anterior (`stages: string[]`) sigue aceptándose y
  crea etapas OPEN con la primera como inicial.
- **No se modifica ningún pipeline existente.**

## Settings v2

Contrato: `docs/contracts/company-settings.v2.schema.json`. Implementación:
`apps/backend/src/modules/companies/company-settings.ts`.

- `parseCompanySettings` lee v1 (empresas existentes) y v2 con la misma vista
  normalizada; conserva claves desconocidas; nunca lanza al leer.
- Las empresas nuevas se guardan en v2 con `commercial`, `catalog`,
  `vertical` (`industry`, `businessType`, `businessModel`,
  `templateVersion`) y `pipelineDefaults`.
- Sin backfill: una empresa v1 solo pasa a v2 cuando un administrador edita
  sus settings (`PATCH /companies/me/settings`), y entonces se conservan
  banderas y claves desconocidas.
- `GET /companies/me/settings` devuelve la vista normalizada más los límites.
- Ninguna migración Prisma: `Company.settings` sigue siendo `Json`.

## API

| Método | Ruta | Acceso | Uso |
|---|---|---|---|
| GET | `/onboarding/templates` | público (throttle) | Plantillas + límites |
| POST | `/onboarding/company` | código de invitación | Crea la empresa (acepta `commercial.industry/businessType/businessModel`, `pipeline.typedStages`, `pipeline.templateKey`; forma anterior compatible) |
| GET | `/companies/me/settings` | sesión de empresa | Vista normalizada |
| PATCH | `/companies/me/settings` | ADMIN / SUPER_ADMIN de la empresa | `catalog.categories`, `commercial.*` |
