# Fase 3 — Catálogo canónico de plantillas (versión 3)

Fuente única de runtime: `apps/backend/src/modules/onboarding/templates/onboarding-templates.ts`
(`ONBOARDING_TEMPLATES_VERSION = 3`). Se publica como
`docs/contracts/onboarding-templates.v3.json`, regenerado desde el código, y la
prueba `onboarding-templates.spec.ts` exige que ambos sean idénticos. El
frontend NO lleva copia: pide `GET /onboarding/templates` (público, solo lectura,
limitado por IP, sin datos de ninguna empresa).

Regenerar el JSON tras cambiar el código:

```bash
cd apps/backend
node --input-type=module -e "import fs from 'node:fs'; const m = await import('./src/modules/onboarding/templates/onboarding-templates.ts'); fs.writeFileSync('../../docs/contracts/onboarding-templates.v3.json', JSON.stringify(m.ONBOARDING_TEMPLATES, null, 2) + '\n');"
```

Historial: `onboarding-templates.v1.json` = inventario de Fase 0 (valores de
muebles fijados en código, `INVENTORY_ONLY`); `v2.json` = Fase 1; `v3.json` =
esta fase. Las empresas creadas guardan `settings.vertical.templateVersion`
con la versión usada; `parseCompanySettings` acepta cualquier número.

## Qué cambia en la versión 3

| Industria | Cambio | Motivo |
|---|---|---|
| `furniture_decor` › `showroom` | modelo `products` → **`mixed`**; categorías **Salas, Comedores, Sillas, Decoración, Instalación**; sugerencias de la industria incluyen Sillas e Instalación | La mueblería cobra además la instalación o el armado (plantilla A) |
| `veterinary_pet` › **`vet_petshop`** (nuevo, primero) | mixto; catálogo y tareas; categorías **Consultas, Vacunas, Peluquería, Alimentos, Medicamentos**; pipeline «Citas y pedidos»: Nueva solicitud · Contactado · Cita o pedido confirmado · Seguimiento · ganado · perdido | Plantilla B: consulta + tienda en un mismo negocio. Sigue siendo estrictamente comercial (sin historias clínicas) |
| `professional_services` › **`software`** (nuevo, primero) | servicios; catálogo, cotizaciones y tareas; categorías **Implementación, Consultoría, Soporte, Licencias**; pipeline: Nuevo lead · Descubrimiento · Propuesta · Negociación · ganado · perdido | Plantilla C |
| `*` › `other` (manual) | pipeline propio `MANUAL_PIPELINE`: Nuevo lead · Contactado · Propuesta · Seguimiento · ganado · perdido; categorías vacías (solo las sugerencias neutrales de su industria) | Plantilla D: nada específico de ninguna industria |

Las demás industrias y tipos de la versión 2 se conservan (retail y ecommerce,
diseño de interiores, fabricación personalizada, clínica, pet shop, grooming,
guardería, consultoría, agencia, servicios técnicos, proyectos, bienes raíces,
automotriz).

## Invariantes (probadas)

- Claves `snake_case` únicas; nombres y descripciones en español no vacíos.
- Cada tipo: `businessModel` ∈ {products, services, mixed}; módulos booleanos
  (`catalog`, `quotes`, `tasks`, los únicos que existen hoy); categorías
  normalizadas (`normalizeCategories` estricta), vacías si no hay catálogo y
  subconjunto de las sugerencias de su industria; pipeline válido para
  `validateTypedStages` (≥1 OPEN, exactamente 1 WON y 1 LOST, nombres únicos
  ≤40, ≤20 etapas), primera etapa OPEN, últimas WON y LOST.
- Los términos de muebles (salas, comedor, sillas, muebles, ratán…) solo
  aparecen en `furniture_decor`; «tehus» en ninguna.
- Veterinaria sin términos médicos (historia clínica, diagnóstico médico,
  receta, tratamiento).
- Todas las industrias terminan en «Otro / Configurar manualmente».

## Cómo las usa el asistente (Fase 3)

1. **Industria** (paso «Datos de empresa») → propone la **forma de vender**
   (`recommendedModelFor`: el modelo de la primera plantilla no manual).
2. **Forma de vender** → **plantilla recomendada** (`recommendedBusinessType`:
   la primera no manual cuyo modelo coincide; si ninguna, la primera).
3. **Recomendación** explicada (`recommendationReason`): industria, forma de
   vender, módulos, número de categorías y etapas. La persona la usa, elige
   otra plantilla de la industria o «Configurar manualmente».
4. Módulos, categorías y pipeline se cargan como **sugerencia** y llevan
   estado Sugerido/Editado; ver `ONBOARDING-CONTRACT.md` § Procedencia.
