import api from './axios';

export type TipoNodo = 'message' | 'question' | 'menu' | 'handoff' | 'end';

export const TIPOS_NODO: Array<{
  valor: TipoNodo;
  etiqueta: string;
  ayuda: string;
}> = [
  {
    valor: 'message',
    etiqueta: 'Enviar un mensaje',
    ayuda: 'Escribe y sigue al paso siguiente sin esperar respuesta.',
  },
  {
    valor: 'question',
    etiqueta: 'Hacer una pregunta',
    ayuda: 'Espera la respuesta y la guarda para usarla después.',
  },
  {
    valor: 'menu',
    etiqueta: 'Ofrecer opciones',
    ayuda: 'El cliente elige una y el flujo continúa por ahí.',
  },
  {
    valor: 'handoff',
    etiqueta: 'Pasar a una persona',
    ayuda: 'Termina el bot y asigna la conversación a un asesor.',
  },
  {
    valor: 'end',
    etiqueta: 'Terminar',
    ayuda: 'Cierra la conversación con el bot.',
  },
];

export interface OpcionMenu {
  label: string;
  next: string;
}

export interface NodoChatbot {
  id: string;
  type: TipoNodo;
  text?: string;
  next?: string;
  options?: OpcionMenu[];
  saveAs?: string;
}

export interface FlujoChatbot {
  start: string;
  nodes: NodoChatbot[];
}

export interface ProblemaFlujo {
  nodeId?: string;
  mensaje: string;
}

export interface FlujoResumen {
  id: string;
  name: string;
  status: 'DRAFT' | 'PUBLISHED';
  isActive: boolean;
  publishedVersion: number | null;
  triggerKeywords: string[];
  draftNodes: FlujoChatbot;
  updatedAt: string;
  _count?: { sessions: number };
  versions?: Array<{ version: number; publishedAt: string }>;
}

export interface SesionChatbot {
  id: string;
  status: 'ACTIVE' | 'HANDED_OVER' | 'COMPLETED' | 'ABANDONED';
  currentNode: string;
  steps: number;
  startedAt: string;
  lastInteractionAt: string;
  endedAt: string | null;
  conversationId: string;
  flow: { id: string; name: string };
  flowVersion: { version: number };
}

export async function getFlows(): Promise<FlujoResumen[]> {
  const { data } = await api.get<FlujoResumen[]>('/chatbot/flows');
  return data;
}

export async function getFlow(id: string): Promise<FlujoResumen> {
  const { data } = await api.get<FlujoResumen>(`/chatbot/flows/${id}`);
  return data;
}

export async function createFlow(payload: {
  name: string;
  draftNodes?: FlujoChatbot;
  triggerKeywords?: string[];
}): Promise<FlujoResumen> {
  const { data } = await api.post<FlujoResumen>('/chatbot/flows', payload);
  return data;
}

export async function updateFlow(
  id: string,
  payload: Partial<{
    name: string;
    draftNodes: FlujoChatbot;
    triggerKeywords: string[];
    isActive: boolean;
  }>,
): Promise<FlujoResumen> {
  const { data } = await api.patch<FlujoResumen>(`/chatbot/flows/${id}`, payload);
  return data;
}

export async function publishFlow(id: string): Promise<FlujoResumen> {
  const { data } = await api.post<FlujoResumen>(`/chatbot/flows/${id}/publish`);
  return data;
}

export async function deleteFlow(id: string): Promise<void> {
  await api.delete(`/chatbot/flows/${id}`);
}

export async function getChatbotSessions(filtros: {
  status?: string;
  limit?: number;
} = {}): Promise<SesionChatbot[]> {
  const { data } = await api.get<SesionChatbot[]>('/chatbot/flows/sessions', {
    params: filtros,
  });
  return data;
}

/**
 * Validación del flujo, ESPEJO de la del servidor.
 *
 * Se duplica a propósito: el servidor es la autoridad —es quien impide
 * publicar algo roto— pero esperar a un viaje de red para enterarse de que
 * falta un texto convierte la edición en un ensayo y error. Si las dos
 * divergen, manda el servidor: aquí solo se adelanta el aviso.
 */
export function validarFlujo(flujo: FlujoChatbot): ProblemaFlujo[] {
  const problemas: ProblemaFlujo[] = [];
  const nodos = flujo?.nodes ?? [];

  if (!nodos.length) return [{ mensaje: 'El flujo no tiene ningún paso.' }];

  const porId = new Map(nodos.map((n) => [n.id, n]));
  if (porId.size !== nodos.length) {
    problemas.push({ mensaje: 'Hay pasos con el mismo identificador.' });
  }
  if (!flujo.start || !porId.has(flujo.start)) {
    problemas.push({ mensaje: 'El paso inicial no existe.' });
  }

  for (const nodo of nodos) {
    if (nodo.type !== 'end' && !nodo.text?.trim()) {
      problemas.push({ nodeId: nodo.id, mensaje: 'No tiene texto que enviar.' });
    }

    if (nodo.type === 'menu') {
      const opciones = nodo.options ?? [];
      if (!opciones.length) {
        problemas.push({ nodeId: nodo.id, mensaje: 'Un menú sin opciones.' });
      }
      opciones.forEach((o, i) => {
        if (!o.label?.trim()) {
          problemas.push({
            nodeId: nodo.id,
            mensaje: `La opción ${i + 1} no tiene texto.`,
          });
        }
        if (!porId.has(o.next)) {
          problemas.push({
            nodeId: nodo.id,
            mensaje: `La opción "${o.label}" lleva a un paso que no existe.`,
          });
        }
      });
    }

    if ((nodo.type === 'message' || nodo.type === 'question') && !nodo.next) {
      problemas.push({
        nodeId: nodo.id,
        mensaje: 'No dice cuál es el paso siguiente.',
      });
    }
    if (nodo.next && !porId.has(nodo.next)) {
      problemas.push({
        nodeId: nodo.id,
        mensaje: 'Lleva a un paso que no existe.',
      });
    }
  }

  const alcanzables = new Set<string>();
  const pendientes = [flujo.start].filter(Boolean);
  while (pendientes.length) {
    const id = pendientes.pop()!;
    if (alcanzables.has(id)) continue;
    alcanzables.add(id);
    const nodo = porId.get(id);
    if (!nodo) continue;
    if (nodo.next) pendientes.push(nodo.next);
    for (const o of nodo.options ?? []) pendientes.push(o.next);
  }
  for (const nodo of nodos) {
    if (!alcanzables.has(nodo.id)) {
      problemas.push({
        nodeId: nodo.id,
        mensaje: 'No se llega a este paso desde el inicio.',
      });
    }
  }

  return problemas;
}

/** Identificador legible y único dentro del flujo. */
export function nuevoIdNodo(existentes: string[]): string {
  let n = existentes.length + 1;
  while (existentes.includes(`paso${n}`)) n += 1;
  return `paso${n}`;
}
