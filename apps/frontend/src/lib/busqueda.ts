import api from './axios';

/** Los tipos que la búsqueda global sabe recorrer. Espejo del DTO del backend. */
export const TIPOS_BUSCABLES = [
  'contactos',
  'conversaciones',
  'oportunidades',
  'productos',
  'cotizaciones',
] as const;

export type TipoBuscable = (typeof TIPOS_BUSCABLES)[number];

/** Igual que en el backend: con una letra la búsqueda deja de discriminar. */
export const LONGITUD_MINIMA_CONSULTA = 2;

export const ETIQUETA_DE_TIPO: Record<TipoBuscable, string> = {
  contactos: 'Contactos',
  conversaciones: 'Conversaciones',
  oportunidades: 'Oportunidades',
  productos: 'Productos',
  cotizaciones: 'Cotizaciones',
};

export interface ResultadoDeBusqueda {
  tipo: TipoBuscable;
  id: string;
  titulo: string;
  subtitulo: string | null;
  insignia: string | null;
  contactoId: string | null;
  archivado?: boolean;
}

export interface GrupoDeBusqueda {
  tipo: TipoBuscable;
  total: number;
  resultados: ResultadoDeBusqueda[];
}

export interface RespuestaDeBusqueda {
  consulta: string;
  total: number;
  grupos: GrupoDeBusqueda[];
}

export async function buscar(opciones: {
  q: string;
  tipos?: TipoBuscable[];
  incluirPapelera?: boolean;
  limite?: number;
  signal?: AbortSignal;
}): Promise<RespuestaDeBusqueda> {
  const { data } = await api.get<RespuestaDeBusqueda>('/search', {
    params: {
      q: opciones.q,
      // Coma y no repetición del parámetro: produce una URL legible en las
      // herramientas de red, que es donde se depura esto.
      ...(opciones.tipos?.length ? { tipos: opciones.tipos.join(',') } : {}),
      ...(opciones.incluirPapelera ? { incluirPapelera: true } : {}),
      ...(opciones.limite ? { limite: opciones.limite } : {}),
    },
    signal: opciones.signal,
  });
  return data;
}

/**
 * A dónde lleva cada resultado.
 *
 * Vive en el frontend a propósito: la API devuelve `tipo` e `id`, no rutas.
 * Si el backend las construyera, mover una pantalla obligaría a desplegar la
 * API para arreglar un enlace.
 *
 * Cada destino es una ruta que YA existe y que lee su parámetro, así que el
 * enlace abre el objeto exacto y sobrevive a una recarga:
 *   - conversaciones → `?c=` lo selecciona en la bandeja;
 *   - oportunidades  → `?lead=` abre su ficha en el embudo;
 *   - contactos      → `?perfil=` abre el perfil 360 sobre el embudo;
 *   - cotizaciones   → `?open=` abre su detalle;
 *   - productos      → `?abrir=` abre su ficha en el catálogo.
 */
export function rutaDelResultado(r: ResultadoDeBusqueda): string {
  switch (r.tipo) {
    case 'conversaciones':
      return `/dashboard/conversations?c=${encodeURIComponent(r.id)}`;
    case 'oportunidades':
      return `/dashboard/pipeline?lead=${encodeURIComponent(r.id)}`;
    case 'contactos':
      return `/dashboard/pipeline?perfil=${encodeURIComponent(r.id)}`;
    case 'cotizaciones':
      return `/dashboard/quotes?open=${encodeURIComponent(r.id)}`;
    case 'productos':
      return `/dashboard/products?abrir=${encodeURIComponent(r.id)}`;
  }
}

/** Aplana los grupos en el orden en que se ven, para navegar con flechas. */
export function resultadosEnOrden(
  respuesta: RespuestaDeBusqueda | undefined,
): ResultadoDeBusqueda[] {
  if (!respuesta) return [];
  return respuesta.grupos.flatMap((g) => g.resultados);
}
