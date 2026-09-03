import type { OnboardingTemplates } from '../onboarding-templates';

// Subconjunto pequeño con la MISMA forma que el contrato del backend
// (docs/contracts/onboarding-templates.v2.json), para pruebas del asistente.
export const TEMPLATES_FIXTURE: OnboardingTemplates = {
  version: 2,
  coreModules: ['conversations', 'contacts', 'leads', 'pipeline'],
  limits: {
    categories: { maxLength: 60, maxCount: 30 },
    stages: { maxNameLength: 40, maxCount: 20 },
  },
  industries: [
    {
      key: 'generic',
      name: 'Genérico',
      description: 'Cualquier negocio.',
      categorySuggestions: ['Productos', 'Servicios', 'Otros'],
      businessTypes: [
        {
          key: 'products',
          name: 'Venta de productos',
          description: 'Vendes artículos.',
          businessModel: 'products',
          modules: { catalog: true, quotes: true, tasks: true },
          categories: ['Productos', 'Otros'],
          pipeline: {
            name: 'Ventas',
            stages: [
              { name: 'Nuevo lead', type: 'OPEN' },
              { name: 'Contactado', type: 'OPEN' },
              { name: 'Cerrado ganado', type: 'WON' },
              { name: 'Cerrado perdido', type: 'LOST' },
            ],
          },
        },
        {
          key: 'services',
          name: 'Venta de servicios',
          description: 'Vendes servicios.',
          businessModel: 'services',
          modules: { catalog: false, quotes: true, tasks: true },
          categories: [],
          pipeline: {
            name: 'Ventas',
            stages: [
              { name: 'Nuevo lead', type: 'OPEN' },
              { name: 'Propuesta', type: 'OPEN' },
              { name: 'Cerrado ganado', type: 'WON' },
              { name: 'Cerrado perdido', type: 'LOST' },
            ],
          },
        },
        {
          key: 'other',
          name: 'Otro / Configurar manualmente',
          description: 'Sin sugerencias.',
          businessModel: 'mixed',
          modules: { catalog: false, quotes: false, tasks: true },
          categories: [],
          pipeline: {
            name: 'Ventas',
            stages: [
              { name: 'Nuevo lead', type: 'OPEN' },
              { name: 'Cerrado ganado', type: 'WON' },
              { name: 'Cerrado perdido', type: 'LOST' },
            ],
          },
          manual: true,
        },
      ],
    },
    {
      key: 'furniture_decor',
      name: 'Muebles y decoración',
      description: 'Showrooms y fabricación.',
      categorySuggestions: ['Salas', 'Comedores', 'Dormitorios', 'Exterior'],
      businessTypes: [
        {
          key: 'showroom',
          name: 'Tienda / showroom',
          description: 'Exhibes y vendes muebles.',
          businessModel: 'products',
          modules: { catalog: true, quotes: true, tasks: true },
          categories: ['Salas', 'Comedores', 'Dormitorios'],
          pipeline: {
            name: 'Ventas',
            stages: [
              { name: 'Nuevo lead', type: 'OPEN' },
              { name: 'Asesoría en proceso', type: 'OPEN' },
              { name: 'Cotización', type: 'OPEN' },
              { name: 'Cerrado ganado', type: 'WON' },
              { name: 'Cerrado perdido', type: 'LOST' },
            ],
          },
        },
        {
          key: 'other',
          name: 'Otro / Configurar manualmente',
          description: 'Sin sugerencias.',
          businessModel: 'mixed',
          modules: { catalog: false, quotes: false, tasks: true },
          categories: [],
          pipeline: {
            name: 'Ventas',
            stages: [
              { name: 'Nuevo lead', type: 'OPEN' },
              { name: 'Cerrado ganado', type: 'WON' },
              { name: 'Cerrado perdido', type: 'LOST' },
            ],
          },
          manual: true,
        },
      ],
    },
    {
      key: 'veterinary_pet',
      name: 'Veterinaria y mascotas',
      description: 'Flujo comercial.',
      categorySuggestions: ['Grooming', 'Pet shop', 'Otros servicios'],
      businessTypes: [
        {
          key: 'grooming',
          name: 'Grooming',
          description: 'Agendas baños y cortes.',
          businessModel: 'services',
          modules: { catalog: true, quotes: false, tasks: true },
          categories: ['Grooming', 'Otros servicios'],
          pipeline: {
            name: 'Citas',
            stages: [
              { name: 'Nuevo contacto', type: 'OPEN' },
              { name: 'Cita agendada', type: 'OPEN' },
              { name: 'Cerrado ganado', type: 'WON' },
              { name: 'Cerrado perdido', type: 'LOST' },
            ],
          },
        },
        {
          key: 'other',
          name: 'Otro / Configurar manualmente',
          description: 'Sin sugerencias.',
          businessModel: 'mixed',
          modules: { catalog: false, quotes: false, tasks: true },
          categories: [],
          pipeline: {
            name: 'Ventas',
            stages: [
              { name: 'Nuevo lead', type: 'OPEN' },
              { name: 'Cerrado ganado', type: 'WON' },
              { name: 'Cerrado perdido', type: 'LOST' },
            ],
          },
          manual: true,
        },
      ],
    },
  ],
};
