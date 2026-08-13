import api from './axios';

/**
 * Cliente de la fusión de contactos duplicados (mockup 22).
 *
 * UN SOLO SITIO para los tipos, las claves de consulta, las peticiones, los
 * códigos de conflicto y qué hay que invalidar después. La alternativa —cada
 * componente armando su URL y su `queryKey`— es la forma segura de que la
 * pantalla de contactos y el perfil acaben enseñando dos verdades distintas
 * sobre el mismo contacto.
 *
 * Los tipos son copia literal del contrato del backend
 * (`modules/contacts/fusion/fusion.tipos.ts`). No se «mejoran» aquí: si
 * divergen, el que manda es el servidor.
 */

export type Lado = 'principal' | 'duplicado';
export type NivelDeCoincidencia = 'alta' | 'sugerida';

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
  iguales: boolean;
  sugerido: Lado;
  requiereDecision: boolean;
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

export interface VistaPreviaFusion {
  principal: ContactoResumen;
  duplicado: ContactoResumen;
  coincidencia: { nivel: NivelDeCoincidencia; razones: string[] };
  campos: CampoComparado[];
  camposPersonalizados: CampoComparado[];
  etiquetas: { principal: string[]; duplicado: string[]; union: string[] };
  identidadesAlternativas: { telefonos: string[]; correos: string[] };
  relaciones: RecuentoRelaciones;
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
  /** Marca del SERVIDOR. La cuenta atrás se calcula contra esto. */
  deshacerHasta: string;
  segundosRestantes: number;
  deshecha: boolean;
}

export interface ResolucionCanonica {
  solicitado: string;
  canonicoId: string;
  fueFusionado: boolean;
  fusionadoEn: string | null;
}

export interface EleccionesFusion {
  campos?: Partial<Record<'name' | 'phone' | 'email', Lado>>;
  camposPersonalizados?: Record<string, Lado>;
  conservarAlternativas?: boolean;
}

// ── Claves de consulta ──────────────────────────────────────────────────

export const clavesDeFusion = {
  candidatos: (contactoId: string) => ['fusion', 'candidatos', contactoId] as const,
  comparacion: (principalId: string, duplicadoId: string) =>
    ['fusion', 'comparar', principalId, duplicadoId] as const,
  canonico: (contactoId: string) => ['fusion', 'canonico', contactoId] as const,
  estado: (mergeId: string) => ['fusion', 'estado', mergeId] as const,
};

// ── Códigos de conflicto ────────────────────────────────────────────────

/**
 * Los códigos que devuelve el backend en un 409, con el texto que se le
 * enseña a una persona. Se traducen aquí y no en el componente para que la
 * misma situación no se cuente de dos maneras en dos pantallas.
 */
export const CONFLICTOS = {
  VISTA_PREVIA_OBSOLETA:
    'Uno de los dos contactos cambió mientras revisabas. Vuelve a compararlos antes de fusionar.',
  YA_FUSIONADO: 'Ese contacto ya se fusionó dentro de otro.',
  PRINCIPAL_ES_ALIAS:
    'Ese contacto ya fue absorbido por otro, así que no puede ser el principal.',
  FUSION_CONCURRENTE:
    'Otra persona completó una fusión sobre este contacto primero. Vuelve a revisar.',
  CONTACTO_ANONIMIZADO:
    'Un contacto anonimizado por una solicitud de datos no se puede fusionar.',
  VENTANA_VENCIDA:
    'Pasaron los 10 minutos para deshacer esta fusión.',
  YA_DESHECHA: 'Esta fusión ya se deshizo.',
  REVERSION_INSEGURA:
    'Algo cambió después de la fusión. Deshacerla ahora perdería ese cambio, así que queda bloqueada.',
} as const;

export type CodigoDeConflicto = keyof typeof CONFLICTOS;

export interface ErrorDeFusion {
  /** 409 con código conocido, 403 sin permiso, 404, o cualquier otro. */
  tipo: 'conflicto' | 'sinPermiso' | 'noEncontrado' | 'otro';
  codigo: CodigoDeConflicto | null;
  mensaje: string;
}

/**
 * Traduce el error de axios a algo que la pantalla pueda enseñar.
 *
 * Un 409 aquí no es una avería: es el producto impidiendo aplicar decisiones
 * tomadas sobre datos viejos. Se distingue del resto para poder ofrecer
 * «volver a comparar» en vez de «reintentar», que no arreglaría nada.
 */
export function leerErrorDeFusion(error: unknown): ErrorDeFusion {
  const e = error as {
    response?: { status?: number; data?: { codigo?: string; mensaje?: string; message?: string } };
  };
  const status = e?.response?.status;
  const datos = e?.response?.data;
  const codigo = (datos?.codigo ?? null) as CodigoDeConflicto | null;

  if (status === 403)
    return {
      tipo: 'sinPermiso',
      codigo: null,
      mensaje: 'Tu rol no permite fusionar contactos. Pídeselo a un administrador.',
    };
  if (status === 404)
    return {
      tipo: 'noEncontrado',
      codigo: null,
      mensaje: 'Ese contacto ya no existe.',
    };
  if (status === 409)
    return {
      tipo: 'conflicto',
      codigo,
      mensaje:
        (codigo && CONFLICTOS[codigo]) ||
        datos?.mensaje ||
        'La fusión no se puede aplicar tal como estaba preparada.',
    };

  return {
    tipo: 'otro',
    codigo: null,
    mensaje:
      datos?.mensaje ||
      datos?.message ||
      'No se pudo completar la operación. Inténtalo de nuevo.',
  };
}

/** Roles que pueden fusionar, espejados de los `@Roles` del controlador. */
export const ROLES_QUE_FUSIONAN = ['ADMIN', 'MANAGER', 'SUPER_ADMIN'];

export function puedeFusionar(rol: string | null | undefined): boolean {
  return ROLES_QUE_FUSIONAN.includes(rol ?? '');
}

// ── Peticiones ──────────────────────────────────────────────────────────

export async function getCandidatos(
  contactoId: string,
): Promise<CandidatoDeFusion[]> {
  const { data } = await api.get<CandidatoDeFusion[]>(
    `/contacts/${contactoId}/duplicados`,
  );
  return data;
}

export async function getCanonico(
  contactoId: string,
): Promise<ResolucionCanonica> {
  const { data } = await api.get<ResolucionCanonica>(
    `/contacts/${contactoId}/canonico`,
  );
  return data;
}

export async function compararContactos(
  principalId: string,
  duplicadoId: string,
): Promise<VistaPreviaFusion> {
  const { data } = await api.get<VistaPreviaFusion>('/contacts/fusion/comparar', {
    params: { principalId, duplicadoId },
  });
  return data;
}

export async function descartarDuplicado(
  contactoAId: string,
  contactoBId: string,
): Promise<{ descartado: boolean; nuevo: boolean }> {
  const { data } = await api.post('/contacts/fusion/descartar', {
    contactoAId,
    contactoBId,
  });
  return data;
}

export async function ejecutarFusion(payload: {
  principalId: string;
  duplicadoId: string;
  versiones: { principal: string; duplicado: string };
  elecciones: EleccionesFusion;
}): Promise<ResultadoFusion> {
  const { data } = await api.post<ResultadoFusion>('/contacts/fusion/ejecutar', {
    ...payload,
    // El servidor la exige. Va explícita aquí para que se vea que la pantalla
    // no la manda sola: la marca una persona en el paso de confirmación.
    confirmoMismaPersona: true,
  });
  return data;
}

export async function deshacerFusion(mergeId: string) {
  const { data } = await api.post(`/contacts/fusion/${mergeId}/deshacer`);
  return data as { deshecha: boolean; principalId: string; duplicadoId: string };
}

export async function getEstadoDeFusion(
  mergeId: string,
): Promise<ResultadoFusion> {
  const { data } = await api.get<ResultadoFusion>(
    `/contacts/fusion/${mergeId}/estado`,
  );
  return data;
}

// ── Caché ───────────────────────────────────────────────────────────────

/**
 * Lo que deja de ser cierto en cuanto una fusión entra o se deshace.
 *
 * Es deliberadamente amplio: una fusión mueve conversaciones, oportunidades,
 * tareas y cotizaciones de un contacto a otro, así que casi cualquier listado
 * que hubiera cargado antes está mostrando el reparto anterior. Invalidar de
 * menos aquí se ve como datos que «no se actualizan solos».
 */
export const CLAVES_A_INVALIDAR = [
  ['contacts'],
  ['contacts', 'papelera'],
  ['fusion'],
  ['conversations'],
  ['inbox'],
  ['leads'],
  ['tasks'],
  ['quotes'],
  ['perfil-comercial'],
] as const;

export function invalidarTrasFusion(queryClient: {
  invalidateQueries: (filtro: { queryKey: readonly unknown[] }) => unknown;
}) {
  for (const queryKey of CLAVES_A_INVALIDAR)
    queryClient.invalidateQueries({ queryKey });
}

/**
 * Segundos que quedan para deshacer, calculados contra la marca DEL SERVIDOR.
 *
 * No se cuentan diez minutos desde que la pantalla recibió la respuesta: el
 * reloj del navegador puede ir desviado y la ventana la fija el backend al
 * fusionar. Si el resultado es 0, la fusión ya no se puede deshacer, y la
 * pantalla tiene que decirlo en vez de ofrecer un botón que va a fallar.
 */
export function segundosParaDeshacer(
  resultado: Pick<ResultadoFusion, 'deshacerHasta' | 'deshecha'>,
  ahora: number = Date.now(),
): number {
  if (resultado.deshecha) return 0;
  const hasta = new Date(resultado.deshacerHasta).getTime();
  if (!Number.isFinite(hasta)) return 0;
  return Math.max(0, Math.floor((hasta - ahora) / 1000));
}

/** «9:58» a partir de los segundos que quedan. */
export function relojDeCuentaAtras(segundos: number): string {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
