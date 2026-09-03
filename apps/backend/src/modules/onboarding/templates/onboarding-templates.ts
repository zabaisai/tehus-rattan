/**
 * PLANTILLAS DE ONBOARDING POR INDUSTRIA — versionadas en código.
 *
 * Son SUGERENCIAS: el usuario puede cambiar cada tipo de negocio, módulo,
 * categoría y etapa antes de crear la empresa, y el backend valida lo que
 * llega, no lo que se sugirió. Viven aquí y no dentro de un componente visual
 * para que el frontend, el backend y el contrato publicado
 * (`docs/contracts/onboarding-templates.v2.json`) sean el MISMO dato: una
 * prueba compara ese JSON con esta exportación.
 *
 * Jerarquía: industria → tipo de negocio → modelo comercial → módulos →
 * categorías (si hay catálogo) → pipeline → personalización manual.
 *
 * TAKTO es un CRM comercial por WhatsApp. Las plantillas de veterinaria y
 * mascotas describen un flujo estrictamente comercial (citas, reservas,
 * seguimiento); no hay historias clínicas ni funciones médicas.
 *
 * Nada de Tehus aquí: la plantilla de muebles es UNA industria más, no el
 * valor por defecto. La industria por defecto es `generic`.
 */

export const ONBOARDING_TEMPLATES_VERSION = 2;

export type BusinessModel = 'products' | 'services' | 'mixed';
export type StageType = 'OPEN' | 'WON' | 'LOST';

/** Módulos que el producto ofrece hoy y que el onboarding puede activar. */
export type OptionalModule = 'catalog' | 'quotes' | 'tasks';

/** Módulos siempre presentes; se listan solo para mostrarlos al usuario. */
export const CORE_MODULES = [
  'conversations',
  'contacts',
  'leads',
  'pipeline',
] as const;

export interface StageTemplate {
  name: string;
  type: StageType;
}

export interface PipelineTemplate {
  name: string;
  stages: StageTemplate[];
}

export interface ModulesTemplate {
  catalog: boolean;
  quotes: boolean;
  tasks: boolean;
}

export interface BusinessTypeTemplate {
  key: string;
  name: string;
  description: string;
  businessModel: BusinessModel;
  modules: ModulesTemplate;
  /** Categorías sugeridas para este tipo. Vacío cuando no usa catálogo. */
  categories: string[];
  pipeline: PipelineTemplate;
  /** «Otro / Configurar manualmente»: sin sugerencias, todo editable. */
  manual?: boolean;
}

export interface IndustryTemplate {
  key: string;
  name: string;
  description: string;
  /** Sugerencias de toda la industria, para cuando el usuario activa catálogo
   *  en un tipo que no lo traía. */
  categorySuggestions: string[];
  businessTypes: BusinessTypeTemplate[];
}

export interface OnboardingTemplates {
  version: number;
  coreModules: readonly string[];
  industries: IndustryTemplate[];
}

// Etapas base. Cada industria ajusta nombres pero conserva: al menos una
// etapa OPEN, exactamente una salida WON y exactamente una LOST, y el orden.
const WON: StageTemplate = { name: 'Cerrado ganado', type: 'WON' };
const LOST: StageTemplate = { name: 'Cerrado perdido', type: 'LOST' };

function pipeline(name: string, open: string[]): PipelineTemplate {
  return {
    name,
    stages: [
      ...open.map((n) => ({ name: n, type: 'OPEN' as const })),
      WON,
      LOST,
    ],
  };
}

export const GENERIC_PIPELINE: PipelineTemplate = pipeline('Ventas', [
  'Nuevo lead',
  'Contactado',
  'Calificado',
  'Propuesta o cotización',
  'Negociación',
]);

const ALL_MODULES: ModulesTemplate = {
  catalog: true,
  quotes: true,
  tasks: true,
};

function manual(): BusinessTypeTemplate {
  return {
    key: 'other',
    name: 'Otro / Configurar manualmente',
    description:
      'Sin sugerencias predefinidas: eliges módulos, categorías y etapas a tu medida.',
    businessModel: 'mixed',
    modules: { catalog: false, quotes: false, tasks: true },
    categories: [],
    pipeline: GENERIC_PIPELINE,
    manual: true,
  };
}

export const ONBOARDING_TEMPLATES: OnboardingTemplates = {
  version: ONBOARDING_TEMPLATES_VERSION,
  coreModules: CORE_MODULES,
  industries: [
    {
      key: 'generic',
      name: 'Genérico',
      description:
        'Cualquier negocio que vende por WhatsApp. Punto de partida neutral.',
      categorySuggestions: ['Productos', 'Servicios', 'Otros'],
      businessTypes: [
        {
          key: 'products',
          name: 'Venta de productos',
          description: 'Vendes artículos físicos o digitales con un catálogo.',
          businessModel: 'products',
          modules: ALL_MODULES,
          categories: ['Productos', 'Otros'],
          pipeline: GENERIC_PIPELINE,
        },
        {
          key: 'services',
          name: 'Venta de servicios',
          description:
            'Vendes servicios o tiempo; normalmente sin catálogo de productos.',
          businessModel: 'services',
          modules: { catalog: false, quotes: true, tasks: true },
          categories: [],
          pipeline: pipeline('Ventas', [
            'Nuevo lead',
            'Contactado',
            'Calificado',
            'Propuesta',
            'Negociación',
          ]),
        },
        {
          key: 'mixed',
          name: 'Modelo mixto',
          description: 'Vendes productos y también servicios.',
          businessModel: 'mixed',
          modules: ALL_MODULES,
          categories: ['Productos', 'Servicios', 'Otros'],
          pipeline: GENERIC_PIPELINE,
        },
        manual(),
      ],
    },
    {
      key: 'retail_ecommerce',
      name: 'Retail y ecommerce',
      description: 'Tiendas físicas, tiendas en línea y distribución.',
      categorySuggestions: [
        'Productos',
        'Novedades',
        'Promociones',
        'Mayorista',
        'Otros',
      ],
      businessTypes: [
        {
          key: 'physical_store',
          name: 'Tienda física',
          description: 'Atiendes en un local y cierras ventas por WhatsApp.',
          businessModel: 'products',
          modules: { catalog: true, quotes: false, tasks: true },
          categories: ['Productos', 'Novedades', 'Promociones', 'Otros'],
          pipeline: pipeline('Ventas', [
            'Nuevo lead',
            'Contactado',
            'Interesado',
            'Reserva o pedido',
          ]),
        },
        {
          key: 'ecommerce',
          name: 'Ecommerce',
          description: 'Vendes en línea y acompañas pedidos por WhatsApp.',
          businessModel: 'products',
          modules: { catalog: true, quotes: false, tasks: true },
          categories: ['Productos', 'Novedades', 'Promociones', 'Otros'],
          pipeline: pipeline('Ventas', [
            'Nuevo lead',
            'Contactado',
            'Pedido en curso',
            'Pago pendiente',
          ]),
        },
        {
          key: 'wholesale',
          name: 'Distribuidor / mayorista',
          description: 'Vendes por volumen a otros negocios con cotización.',
          businessModel: 'products',
          modules: ALL_MODULES,
          categories: ['Productos', 'Mayorista', 'Otros'],
          pipeline: pipeline('Ventas', [
            'Nuevo lead',
            'Contactado',
            'Cotización',
            'Negociación',
          ]),
        },
        manual(),
      ],
    },
    {
      key: 'furniture_decor',
      name: 'Muebles y decoración',
      description: 'Showrooms, diseño de interiores y fabricación a medida.',
      categorySuggestions: [
        'Salas',
        'Comedores',
        'Dormitorios',
        'Exterior',
        'Decoración',
        'Personalizados',
      ],
      businessTypes: [
        {
          key: 'showroom',
          name: 'Tienda / showroom',
          description: 'Exhibes y vendes muebles con asesoría y cotización.',
          businessModel: 'products',
          modules: ALL_MODULES,
          categories: [
            'Salas',
            'Comedores',
            'Dormitorios',
            'Exterior',
            'Decoración',
          ],
          pipeline: pipeline('Ventas', [
            'Nuevo lead',
            'Contactado',
            'Asesoría en proceso',
            'Cotización',
            'Seguimiento',
          ]),
        },
        {
          key: 'interior_design',
          name: 'Diseño de interiores',
          description: 'Vendes proyectos de diseño; el catálogo es opcional.',
          businessModel: 'services',
          modules: { catalog: false, quotes: true, tasks: true },
          categories: [],
          pipeline: pipeline('Proyectos', [
            'Nuevo lead',
            'Contactado',
            'Visita o brief',
            'Propuesta de diseño',
            'Negociación',
          ]),
        },
        {
          key: 'custom_manufacturing',
          name: 'Fabricación personalizada',
          description: 'Fabricas a medida a partir de una cotización.',
          businessModel: 'mixed',
          modules: ALL_MODULES,
          categories: [
            'Personalizados',
            'Salas',
            'Comedores',
            'Dormitorios',
            'Exterior',
          ],
          pipeline: pipeline('Ventas', [
            'Nuevo lead',
            'Contactado',
            'Levantamiento de medidas',
            'Cotización',
            'Negociación',
          ]),
        },
        manual(),
      ],
    },
    {
      key: 'veterinary_pet',
      name: 'Veterinaria y mascotas',
      description:
        'Clínicas, pet shops, grooming y guarderías. Flujo comercial: citas, reservas y seguimiento.',
      categorySuggestions: [
        'Consulta veterinaria',
        'Vacunación',
        'Grooming',
        'Pet shop',
        'Guardería y hotel',
        'Otros servicios',
      ],
      businessTypes: [
        {
          key: 'clinic',
          name: 'Clínica veterinaria',
          description: 'Agendas consultas y vacunación por WhatsApp.',
          businessModel: 'services',
          modules: { catalog: true, quotes: false, tasks: true },
          categories: ['Consulta veterinaria', 'Vacunación', 'Otros servicios'],
          pipeline: pipeline('Citas', [
            'Nuevo contacto',
            'Contactado',
            'Cita agendada',
            'Seguimiento comercial',
          ]),
        },
        {
          key: 'pet_shop',
          name: 'Pet shop',
          description: 'Vendes alimento, accesorios y productos para mascotas.',
          businessModel: 'products',
          modules: { catalog: true, quotes: false, tasks: true },
          categories: ['Pet shop', 'Otros servicios'],
          pipeline: pipeline('Ventas', [
            'Nuevo lead',
            'Contactado',
            'Interesado',
            'Reserva o pedido',
          ]),
        },
        {
          key: 'grooming',
          name: 'Grooming',
          description: 'Agendas baños, cortes y servicios de estética.',
          businessModel: 'services',
          modules: { catalog: true, quotes: false, tasks: true },
          categories: ['Grooming', 'Otros servicios'],
          pipeline: pipeline('Citas', [
            'Nuevo contacto',
            'Contactado',
            'Cita agendada',
            'Seguimiento',
          ]),
        },
        {
          key: 'boarding',
          name: 'Guardería / hotel',
          description: 'Gestionas reservas de estadía por WhatsApp.',
          businessModel: 'services',
          modules: { catalog: true, quotes: true, tasks: true },
          categories: ['Guardería y hotel', 'Otros servicios'],
          pipeline: pipeline('Reservas', [
            'Nuevo contacto',
            'Contactado',
            'Reserva solicitada',
            'Confirmación',
          ]),
        },
        manual(),
      ],
    },
    {
      key: 'professional_services',
      name: 'Servicios profesionales',
      description: 'Consultoría, agencias, servicios técnicos y proyectos.',
      categorySuggestions: [
        'Consultoría',
        'Proyectos',
        'Implementación',
        'Soporte',
        'Otros servicios',
      ],
      businessTypes: [
        {
          key: 'consulting',
          name: 'Consultoría',
          description: 'Vendes diagnóstico y acompañamiento con propuesta.',
          businessModel: 'services',
          modules: { catalog: false, quotes: true, tasks: true },
          categories: [],
          pipeline: pipeline('Ventas', [
            'Nuevo lead',
            'Contactado',
            'Diagnóstico',
            'Propuesta',
            'Negociación',
          ]),
        },
        {
          key: 'agency',
          name: 'Agencia',
          description: 'Recibes briefs y presentas propuestas.',
          businessModel: 'services',
          modules: { catalog: false, quotes: true, tasks: true },
          categories: [],
          pipeline: pipeline('Ventas', [
            'Nuevo lead',
            'Contactado',
            'Brief',
            'Propuesta',
            'Negociación',
          ]),
        },
        {
          key: 'technical_services',
          name: 'Servicios técnicos',
          description: 'Visitas, soporte e implementación con cotización.',
          businessModel: 'services',
          modules: ALL_MODULES,
          categories: ['Soporte', 'Implementación', 'Otros servicios'],
          pipeline: pipeline('Ventas', [
            'Nuevo lead',
            'Contactado',
            'Visita técnica',
            'Cotización',
          ]),
        },
        {
          key: 'projects',
          name: 'Proyectos',
          description: 'Vendes proyectos con alcance definido y propuesta.',
          businessModel: 'services',
          modules: { catalog: false, quotes: true, tasks: true },
          categories: [],
          pipeline: pipeline('Proyectos', [
            'Nuevo lead',
            'Contactado',
            'Alcance definido',
            'Propuesta',
            'Negociación',
          ]),
        },
        manual(),
      ],
    },
    {
      key: 'real_estate',
      name: 'Bienes raíces',
      description: 'Venta, arriendo y proyectos nuevos.',
      categorySuggestions: ['Venta', 'Arriendo', 'Proyecto nuevo', 'Inversión'],
      businessTypes: [
        {
          key: 'sale',
          name: 'Venta',
          description: 'Vendes inmuebles usados o nuevos de terceros.',
          businessModel: 'products',
          modules: { catalog: true, quotes: false, tasks: true },
          categories: ['Venta', 'Inversión'],
          pipeline: pipeline('Ventas', [
            'Nuevo lead',
            'Contactado',
            'Visita agendada',
            'Oferta',
            'Negociación',
          ]),
        },
        {
          key: 'rent',
          name: 'Arriendo',
          description: 'Gestionas arriendos y documentación.',
          businessModel: 'services',
          modules: { catalog: true, quotes: false, tasks: true },
          categories: ['Arriendo'],
          pipeline: pipeline('Arriendos', [
            'Nuevo lead',
            'Contactado',
            'Visita agendada',
            'Documentos en revisión',
          ]),
        },
        {
          key: 'new_projects',
          name: 'Proyectos nuevos',
          description: 'Vendes unidades sobre planos o en construcción.',
          businessModel: 'products',
          modules: ALL_MODULES,
          categories: ['Proyecto nuevo', 'Inversión'],
          pipeline: pipeline('Ventas', [
            'Nuevo lead',
            'Contactado',
            'Visita al proyecto',
            'Separación',
            'Negociación',
          ]),
        },
        manual(),
      ],
    },
    {
      key: 'automotive',
      name: 'Automotriz',
      description: 'Concesionarios, talleres y repuestos.',
      categorySuggestions: ['Vehículos', 'Taller', 'Repuestos', 'Accesorios'],
      businessTypes: [
        {
          key: 'dealership',
          name: 'Concesionario',
          description: 'Vendes vehículos con prueba de manejo y cotización.',
          businessModel: 'products',
          modules: ALL_MODULES,
          categories: ['Vehículos', 'Accesorios'],
          pipeline: pipeline('Ventas', [
            'Nuevo lead',
            'Contactado',
            'Prueba de manejo',
            'Cotización',
            'Negociación',
          ]),
        },
        {
          key: 'workshop',
          name: 'Taller',
          description: 'Diagnosticas y cotizas servicios de taller.',
          businessModel: 'services',
          modules: ALL_MODULES,
          categories: ['Taller', 'Repuestos'],
          pipeline: pipeline('Servicios', [
            'Nuevo lead',
            'Contactado',
            'Diagnóstico',
            'Cotización',
          ]),
        },
        {
          key: 'parts',
          name: 'Repuestos / accesorios',
          description: 'Vendes repuestos y accesorios con cotización.',
          businessModel: 'products',
          modules: ALL_MODULES,
          categories: ['Repuestos', 'Accesorios'],
          pipeline: pipeline('Ventas', [
            'Nuevo lead',
            'Contactado',
            'Cotización',
            'Negociación',
          ]),
        },
        manual(),
      ],
    },
  ],
};

export function findIndustry(key: string): IndustryTemplate | undefined {
  return ONBOARDING_TEMPLATES.industries.find((i) => i.key === key);
}

export function findBusinessType(
  industryKey: string,
  businessTypeKey: string,
): BusinessTypeTemplate | undefined {
  return findIndustry(industryKey)?.businessTypes.find(
    (t) => t.key === businessTypeKey,
  );
}

export const INDUSTRY_KEYS = ONBOARDING_TEMPLATES.industries.map((i) => i.key);
export const BUSINESS_MODELS: readonly BusinessModel[] = [
  'products',
  'services',
  'mixed',
];
