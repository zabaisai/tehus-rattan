import { normalizePhone } from '../../../common/phone/e164.util';

/**
 * Contratos de la fusión de contactos duplicados. Un solo sitio para lo que
 * viajan API y pantalla, de modo que no puedan divergir.
 */

/** De cuál de los dos lados sale el valor final de un campo. */
export type Lado = 'principal' | 'duplicado';

/** Campos escalares que se pueden elegir uno a uno. */
export const CAMPOS_ESCALARES = ['name', 'phone', 'email'] as const;
export type CampoEscalar = (typeof CAMPOS_ESCALARES)[number];

export interface EleccionesFusion {
  /** Campo escalar → de qué lado se toma. Ausente = del principal. */
  campos?: Partial<Record<CampoEscalar, Lado>>;
  /** Id de definición de campo personalizado → de qué lado se toma. */
  camposPersonalizados?: Record<string, Lado>;
  /**
   * Conservar como alternativos el teléfono y el correo que no ganaron.
   * Por defecto sí: tirar una identidad real es la forma de que la persona
   * deje de aparecer cuando alguien la busque por ella.
   */
  conservarAlternativas?: boolean;
}

export interface ContactoResumen {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  tags: string[];
  altPhones: string[];
  altEmails: string[];
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  mergedIntoId: string | null;
}

export interface CampoComparado {
  campo: string;
  etiqueta: string;
  valorPrincipal: string | null;
  valorDuplicado: string | null;
  /** Iguales tras normalizar: no exige decisión aunque el texto difiera. */
  iguales: boolean;
  /** Lado propuesto por defecto. Siempre el principal, nunca se aplica solo. */
  sugerido: Lado;
  /** Ambos tienen valor y son distintos: la persona tiene que elegir. */
  requiereDecision: boolean;
  /** Por qué dos textos distintos cuentan como iguales. */
  nota?: string;
}

export interface RecuentoRelaciones {
  conversaciones: number;
  mensajes: number;
  oportunidades: number;
  tareas: number;
  sugerenciasDeTarea: number;
  cotizaciones: number;
  camposPersonalizados: number;
  ejecucionesDeBot: number;
  notas: number;
}

export type NivelDeCoincidencia = 'alta' | 'sugerida';

export interface VistaPreviaFusion {
  principal: ContactoResumen;
  duplicado: ContactoResumen;
  coincidencia: { nivel: NivelDeCoincidencia; razones: string[] };
  campos: CampoComparado[];
  camposPersonalizados: CampoComparado[];
  etiquetas: { principal: string[]; duplicado: string[]; union: string[] };
  identidadesAlternativas: { telefonos: string[]; correos: string[] };
  /** Lo que se conserva. Se enseña ANTES de confirmar, no después. */
  relaciones: RecuentoRelaciones;
  /**
   * Marcas de versión de ambos contactos. La ejecución las exige de vuelta:
   * si alguno cambió entre la vista previa y el «fusionar», la operación se
   * rechaza en vez de aplicar decisiones tomadas sobre datos viejos.
   */
  versiones: { principal: string; duplicado: string };
  decisionesPendientes: number;
}

export interface CandidatoDeFusion {
  contacto: ContactoResumen;
  nivel: NivelDeCoincidencia;
  razones: string[];
}

export interface ResultadoFusion {
  mergeId: string;
  principalId: string;
  duplicadoId: string;
  trasladadas: RecuentoRelaciones;
  realizadaEn: string;
  /** Hasta cuándo se puede deshacer. */
  deshacerHasta: string;
  /** Segundos que quedan de ventana. 0 = vencida. */
  segundosRestantes: number;
  deshecha: boolean;
}

/**
 * Normalización de correo: recorte y minúsculas, nada más.
 *
 * Deliberadamente NO se tocan puntos ni sufijos `+etiqueta`: eso es política de
 * Gmail, no del correo electrónico, y aplicarla a todos los dominios uniría dos
 * buzones que en otro proveedor son de dos personas distintas. Para decidir si
 * dos fichas son la misma persona basta con ignorar mayúsculas y espacios.
 */
export function normalizarCorreo(
  valor: string | null | undefined,
): string | null {
  const limpio = (valor ?? '').trim().toLowerCase();
  if (!limpio || !limpio.includes('@')) return null;
  return limpio;
}

/** Forma canónica de un teléfono, reutilizando la normalización del producto. */
export function normalizarTelefono(
  valor: string | null | undefined,
): string | null {
  return normalizePhone(valor).e164;
}

/** Une listas sin duplicados y sin vacíos, conservando el orden de aparición. */
export function unirSinDuplicados(...listas: (string[] | null | undefined)[]) {
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const lista of listas) {
    for (const valor of lista ?? []) {
      const limpio = (valor ?? '').trim();
      if (!limpio || vistos.has(limpio)) continue;
      vistos.add(limpio);
      salida.push(limpio);
    }
  }
  return salida;
}

/** Pareja ordenada: (X, Y) y (Y, X) son el mismo descarte. */
export function parejaOrdenada(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}
