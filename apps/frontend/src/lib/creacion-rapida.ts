import { Role } from '@/types';
import { ResultadoDeBusqueda, TipoBuscable } from './busqueda';
import {
  catalogVocabulary,
  type CatalogRules,
  type TenantCapabilityKey,
} from './tenant-capabilities';

/**
 * Las acciones del panel «Crear rápidamente» del mockup 16.
 *
 * `roles` ESPEJA lo que exige el backend. No es la protección —esa vive en los
 * guardas del servidor— sino la forma de no ofrecer un botón que va a devolver
 * 403: enseñar una acción prohibida y fallar al pulsarla es peor que no
 * enseñarla, porque el usuario cree que le falta algo.
 *
 *   POST /products  → @Roles('ADMIN', 'SUPER_ADMIN')
 *   POST /flowbots  → @Roles('ADMIN', 'MANAGER', 'SUPER_ADMIN')
 *   el resto        → cualquier usuario de la empresa
 */
export type AccionRapida =
  | 'contacto'
  | 'oportunidad'
  | 'tarea'
  | 'cotizacion'
  | 'producto'
  | 'bot';

export interface DefinicionDeAccion {
  accion: AccionRapida;
  etiqueta: string;
  /** `null` = cualquier usuario de la empresa. */
  roles: Role[] | null;
  /**
   * Algunas acciones no abren un modal: navegan. Una cotización SIEMPRE
   * pertenece a una oportunidad (`POST /quotes/from-lead/:leadId`), así que sin
   * elegirla antes no hay nada que crear; y un bot se edita en su propia
   * pantalla, no en un diálogo.
   */
  ruta?: string;
  /** Se muestra cuando la acción navega en vez de abrir un formulario. */
  nota?: string;
  /**
   * Módulo de la empresa que tiene que estar activo (Fase 4). Sin él la
   * acción no se ofrece: el servidor respondería `403 MODULE_DISABLED`.
   */
  capability?: TenantCapabilityKey;
}

export const ACCIONES_RAPIDAS: DefinicionDeAccion[] = [
  { accion: 'contacto', etiqueta: 'Nuevo contacto', roles: null },
  { accion: 'oportunidad', etiqueta: 'Nueva oportunidad', roles: null },
  { accion: 'tarea', etiqueta: 'Nueva tarea', roles: null, capability: 'tasks' },
  {
    accion: 'cotizacion',
    etiqueta: 'Nueva cotización',
    roles: null,
    ruta: '/dashboard/pipeline',
    nota: 'Elige la oportunidad',
    capability: 'quotes',
  },
  {
    // La etiqueta es la genérica; `accionesPara` la sustituye por el
    // vocabulario del catálogo de la empresa (producto / servicio / elemento).
    accion: 'producto',
    etiqueta: 'Nuevo producto',
    roles: ['ADMIN', 'SUPER_ADMIN'],
    capability: 'catalog',
  },
  {
    accion: 'bot',
    etiqueta: 'Nuevo bot',
    roles: ['ADMIN', 'MANAGER', 'SUPER_ADMIN'],
    ruta: '/dashboard/flowbots/new',
    nota: 'Se abre el editor',
  },
];

export interface ContextoDeAcciones {
  /**
   * `can()` de `useTenantCapabilities`. Si no se pasa, no se filtra por
   * módulo (uso fuera del shell, por ejemplo en pruebas del propio catálogo).
   */
  can?: (key: TenantCapabilityKey) => boolean;
  /** Reglas del catálogo, para nombrar la acción como habla la empresa. */
  catalogo?: CatalogRules | null;
}

/**
 * Acciones que ve ESTE rol en ESTA empresa: primero el rol, después el
 * módulo. La acción de catálogo toma el nombre del vocabulario de la empresa:
 * «Nuevo servicio» para quien solo vende servicios, «Nuevo elemento» para
 * quien vende ambos.
 */
export function accionesPara(
  rol: Role | undefined,
  contexto: ContextoDeAcciones = {},
): DefinicionDeAccion[] {
  if (!rol) return [];
  const { can, catalogo } = contexto;
  const vocabulario = catalogVocabulary(catalogo);
  return ACCIONES_RAPIDAS.filter(
    (a) => a.roles === null || a.roles.includes(rol),
  )
    .filter((a) => !a.capability || !can || can(a.capability))
    .map((a) =>
      a.accion === 'producto' ? { ...a, etiqueta: vocabulario.newItem } : a,
    );
}

// ─────────────────────────────────────────────────────────────
// Recientes
// ─────────────────────────────────────────────────────────────

export interface Reciente {
  tipo: TipoBuscable;
  id: string;
  titulo: string;
  subtitulo: string | null;
}

const MAXIMO_RECIENTES = 6;

/**
 * Lo último que ESTE usuario abrió desde la búsqueda.
 *
 * Vive en memoria, NO en `localStorage`. Dos razones, y ninguna es pereza:
 *
 *   · El nombre de un contacto es un dato personal. Este producto guarda el
 *     token solo en memoria justamente para no dejar rastro en el disco;
 *     escribir ahí una lista de clientes contradiría esa decisión.
 *   · Un navegador compartido filtraría entre usuarios —y entre empresas— lo
 *     que cada uno estuvo mirando.
 *
 * El precio es que la lista se vacía al recargar. Está documentado como
 * limitación; persistirla exige decidir antes dónde y con qué retención.
 */
let recientes: Reciente[] = [];
/** Ámbito actual. Si cambia la sesión, la lista se descarta entera. */
let ambito: string | null = null;

function claveDeAmbito(companyId: string | null | undefined, userId: string | undefined) {
  return `${companyId ?? '-'}|${userId ?? '-'}`;
}

export function registrarReciente(
  r: ResultadoDeBusqueda,
  sesion: { companyId?: string | null; userId?: string },
) {
  const clave = claveDeAmbito(sesion.companyId, sesion.userId);
  if (clave !== ambito) {
    ambito = clave;
    recientes = [];
  }
  recientes = [
    { tipo: r.tipo, id: r.id, titulo: r.titulo, subtitulo: r.subtitulo },
    // Sin duplicados: abrir dos veces lo mismo no debe llenar la lista.
    ...recientes.filter((x) => !(x.tipo === r.tipo && x.id === r.id)),
  ].slice(0, MAXIMO_RECIENTES);
}

export function leerRecientes(sesion: {
  companyId?: string | null;
  userId?: string;
}): Reciente[] {
  // Si el ámbito no coincide, no se devuelve nada: es la garantía de que la
  // lista de una sesión no aparece en otra.
  if (claveDeAmbito(sesion.companyId, sesion.userId) !== ambito) return [];
  return recientes;
}

export function olvidarRecientes() {
  recientes = [];
  ambito = null;
}
