import api from './axios';

/** Disparadores soportados por el motor. */
export const DISPARADORES = [
  {
    valor: 'first_message',
    etiqueta: 'Primer mensaje del contacto',
    ayuda: 'Se ejecuta una sola vez, cuando alguien escribe por primera vez.',
  },
  {
    valor: 'keyword',
    etiqueta: 'El mensaje contiene una palabra',
    ayuda: 'Se ejecuta cada vez que el texto incluye alguna de las palabras.',
  },
  {
    valor: 'message_received',
    etiqueta: 'Cualquier mensaje entrante',
    ayuda: 'Se ejecuta con TODOS los mensajes. Úsalo con cuidado.',
  },
] as const;

/** Acciones soportadas por el motor. */
export const ACCIONES = [
  { valor: 'send_message', etiqueta: 'Enviar un mensaje' },
  { valor: 'assign_agent', etiqueta: 'Asignar a un asesor' },
  { valor: 'change_stage', etiqueta: 'Mover la oportunidad de etapa' },
  { valor: 'close_conversation', etiqueta: 'Cerrar la conversación' },
] as const;

export type TipoAccion = (typeof ACCIONES)[number]['valor'];

export interface Accion {
  type: TipoAccion;
  message?: string;
  agentId?: string;
  stage?: string;
}

export interface Automatizacion {
  id: string;
  name: string;
  isActive: boolean;
  trigger: string;
  conditions: { keywords?: string[] } | null;
  actions: Accion[];
  order: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PasoEjecutado {
  type: string;
  ok: boolean;
  error?: string;
  durationMs?: number;
}

export interface EjecucionAutomatizacion {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'DEAD';
  attempts: number;
  triggerType: string;
  automationVersion: number;
  steps: PasoEjecutado[] | null;
  lastError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  automation: { id: string; name: string };
  conversationId: string | null;
}

export async function getAutomations(): Promise<Automatizacion[]> {
  const { data } = await api.get<Automatizacion[]>('/automations');
  return data;
}

export async function createAutomation(payload: {
  name: string;
  trigger: string;
  conditions?: unknown;
  actions: Accion[];
  order?: number;
}): Promise<Automatizacion> {
  const { data } = await api.post<Automatizacion>('/automations', payload);
  return data;
}

export async function updateAutomation(
  id: string,
  payload: Partial<{
    name: string;
    isActive: boolean;
    trigger: string;
    conditions: unknown;
    actions: Accion[];
    order: number;
  }>,
): Promise<Automatizacion> {
  const { data } = await api.patch<Automatizacion>(`/automations/${id}`, payload);
  return data;
}

export async function deleteAutomation(id: string): Promise<void> {
  await api.delete(`/automations/${id}`);
}

export async function getAutomationRuns(filtros: {
  automationId?: string;
  status?: string;
  limit?: number;
} = {}): Promise<EjecucionAutomatizacion[]> {
  const { data } = await api.get<EjecucionAutomatizacion[]>(
    '/automations/runs',
    { params: filtros },
  );
  return data;
}

/**
 * Comprueba una automatización antes de guardarla.
 *
 * Se valida en el cliente ADEMÁS de en el servidor porque el coste de
 * equivocarse aquí no es un error de formulario: una automatización mal
 * configurada le manda mensajes de verdad a clientes de verdad, y eso no se
 * puede deshacer.
 */
export function validarAutomatizacion(borrador: {
  name: string;
  trigger: string;
  conditions?: { keywords?: string[] } | null;
  actions: Accion[];
}): string[] {
  const errores: string[] = [];

  if (!borrador.name.trim()) errores.push('Ponle un nombre.');

  if (borrador.trigger === 'keyword') {
    const palabras = borrador.conditions?.keywords ?? [];
    if (!palabras.length) {
      errores.push('Añade al menos una palabra que dispare la automatización.');
    }
  }

  if (!borrador.actions.length) {
    errores.push('Añade al menos una acción; si no, no hará nada.');
  }

  borrador.actions.forEach((accion, i) => {
    const n = i + 1;
    if (accion.type === 'send_message' && !accion.message?.trim()) {
      errores.push(`La acción ${n} envía un mensaje vacío.`);
    }
    if (accion.type === 'assign_agent' && !accion.agentId) {
      errores.push(`La acción ${n} no dice a qué asesor asignar.`);
    }
    if (accion.type === 'change_stage' && !accion.stage?.trim()) {
      errores.push(`La acción ${n} no dice a qué etapa mover.`);
    }
  });

  return errores;
}
