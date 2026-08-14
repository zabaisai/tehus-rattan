import type { FiltrosBandeja } from './conversations';

/**
 * La URL de la bandeja: qué se está mirando, no solo qué se abrió.
 *
 * Antes solo viajaba `?c=`. Los filtros vivían en estado de React, y eso
 * significaba tres cosas que se notaban usándolo: recargar con «Sin leer»
 * activo devolvía «Todas» sin decirlo, Atrás no deshacía un cambio de filtro
 * porque nunca hubo entrada en el historial, y un enlace compartido llevaba a
 * otra bandeja distinta de la que había visto quien lo mandó.
 *
 * El códec vive aquí, en funciones puras, y no dentro de la pantalla: así se
 * puede comprobar qué sobrevive a una recarga sin montar los tres paneles.
 */

export type ClaveDePestana = 'todas' | 'mias' | 'libres' | 'sinleer';

export const PESTANAS: ReadonlyArray<{
  clave: ClaveDePestana;
  etiqueta: string;
  /** De qué contador de `inbox/counters` sale su cifra. */
  contador: 'total' | 'mine' | 'unassigned' | 'unread';
}> = [
  { clave: 'todas', etiqueta: 'Todas', contador: 'total' },
  { clave: 'mias', etiqueta: 'Mías', contador: 'mine' },
  { clave: 'libres', etiqueta: 'Sin asignar', contador: 'unassigned' },
  { clave: 'sinleer', etiqueta: 'Sin leer', contador: 'unread' },
];

/** Los estados que admite el contrato del backend. Otro valor se ignora. */
export const ESTADOS_DE_CONVERSACION = [
  'OPEN',
  'PENDING',
  'RESOLVED',
  'CLOSED',
  'ARCHIVED',
] as const;

export interface EstadoDeBandeja {
  filtros: FiltrosBandeja;
  conversacionId: string | null;
  perfilAbierto: boolean;
  /** Ruta de regreso ya codificada, para volver por donde se vino. */
  volverA?: string | null;
}

/** Qué pestaña corresponde a unos filtros. Deriva; no se guarda dos veces. */
export function pestanaActiva(filtros: FiltrosBandeja): ClaveDePestana {
  if (filtros.unread) return 'sinleer';
  if (filtros.assigned === 'me') return 'mias';
  if (filtros.assigned === 'unassigned') return 'libres';
  return 'todas';
}

function filtrosDePestana(clave: string): FiltrosBandeja {
  if (clave === 'mias') return { assigned: 'me' };
  if (clave === 'libres') return { assigned: 'unassigned' };
  if (clave === 'sinleer') return { unread: true };
  // Cualquier otra cosa —incluido un valor inventado a mano en la barra de
  // direcciones— es «Todas». Una bandeja vacía por un parámetro mal escrito
  // parecería que no hay conversaciones.
  return {};
}

export function leerEstadoDeBandeja(params: URLSearchParams): EstadoDeBandeja {
  const filtros: FiltrosBandeja = filtrosDePestana(params.get('vista') ?? '');

  const busqueda = (params.get('q') ?? '').trim();
  if (busqueda) filtros.search = busqueda;

  const estado = params.get('estado') ?? '';
  if ((ESTADOS_DE_CONVERSACION as readonly string[]).includes(estado)) {
    filtros.status = estado;
  }

  return {
    filtros,
    conversacionId: params.get('c'),
    perfilAbierto: params.get('perfil') === '1',
    volverA: params.get('volverA'),
  };
}

/**
 * La query que representa un estado. Sin valores por defecto: una bandeja
 * limpia deja la URL limpia, que es lo que se copia y se comparte.
 */
export function queryDeEstado(estado: EstadoDeBandeja): string {
  const params = new URLSearchParams();

  const pestana = pestanaActiva(estado.filtros);
  if (pestana !== 'todas') params.set('vista', pestana);
  if (estado.filtros.search?.trim()) params.set('q', estado.filtros.search.trim());
  if (estado.filtros.status) params.set('estado', estado.filtros.status);
  if (estado.conversacionId) params.set('c', estado.conversacionId);
  if (estado.perfilAbierto) params.set('perfil', '1');
  if (estado.volverA) params.set('volverA', estado.volverA);

  return params.toString();
}

export interface CambiosDeBandeja {
  pestana?: ClaveDePestana;
  search?: string;
  status?: string;
  conversacionId?: string | null;
  perfilAbierto?: boolean;
}

/**
 * Aplica un cambio conservando todo lo demás.
 *
 * Cambiar de pestaña SUSTITUYE asignación y no-leídos a la vez: «Mías» y «Sin
 * leer» son excluyentes, y dejar restos de la anterior produce combinaciones
 * que nadie pidió. Lo que sí se conserva siempre es la conversación abierta:
 * filtrar es cambiar la lista, no cerrar el chat que se está leyendo.
 */
export function aplicarCambios(
  estado: EstadoDeBandeja,
  cambios: CambiosDeBandeja,
): EstadoDeBandeja {
  const filtros: FiltrosBandeja = { ...estado.filtros };

  if (cambios.pestana !== undefined) {
    delete filtros.assigned;
    delete filtros.unread;
    Object.assign(filtros, filtrosDePestana(cambios.pestana));
  }

  if (cambios.search !== undefined) {
    const limpia = cambios.search.trim();
    if (limpia) filtros.search = limpia;
    else delete filtros.search;
  }

  if (cambios.status !== undefined) {
    if ((ESTADOS_DE_CONVERSACION as readonly string[]).includes(cambios.status)) {
      filtros.status = cambios.status;
    } else {
      delete filtros.status;
    }
  }

  return {
    filtros,
    conversacionId:
      cambios.conversacionId !== undefined
        ? cambios.conversacionId
        : estado.conversacionId,
    perfilAbierto:
      cambios.perfilAbierto !== undefined
        ? cambios.perfilAbierto
        : estado.perfilAbierto,
    volverA: estado.volverA,
  };
}
