import api from './axios';
import { Conversation, Message } from '@/types';

export async function getConversations(): Promise<Conversation[]> {
  const { data } = await api.get<Conversation[]>('/conversations');
  return data;
}

export async function getConversation(id: string): Promise<Conversation> {
  const { data } = await api.get<Conversation>(`/conversations/${id}`);
  return data;
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  const { data } = await api.get<Message[]>(`/conversations/${conversationId}/messages`);
  return data;
}

export async function sendMessage(
  conversationId: string,
  message: string,
): Promise<Message> {
  const { data } = await api.post<Message>(
    `/conversations/${conversationId}/send`,
    { message },
  );
  return data;
}

export async function pauseConversation(id: string) {
  const { data } = await api.post(`/conversations/${id}/pause`);
  return data;
}

export async function resumeConversation(id: string) {
  const { data } = await api.post(`/conversations/${id}/resume`);
  return data;
}

// ── Bandeja ────────────────────────────────────────────────────

export interface FiltrosBandeja {
  search?: string;
  status?: string;
  /** `me`, `unassigned`, `any` o el id de un asesor. */
  assigned?: string;
  unread?: boolean;
  withLead?: boolean;
  limit?: number;
  offset?: number;
}

export interface ConversacionBandeja extends Conversation {
  unreadCount: number;
  lastReadAt: string | null;
}

export interface PaginaBandeja {
  items: ConversacionBandeja[];
  hasMore: boolean;
}

export async function getInbox(
  filtros: FiltrosBandeja = {},
): Promise<PaginaBandeja> {
  const { data } = await api.get<PaginaBandeja>('/conversations/inbox', {
    // Se omiten los vacios en vez de mandar cadenas vacias: `status=` en la
    // URL es un filtro que el backend tendria que aprender a ignorar.
    params: {
      ...(filtros.search ? { search: filtros.search } : {}),
      ...(filtros.status ? { status: filtros.status } : {}),
      ...(filtros.assigned && filtros.assigned !== 'any'
        ? { assigned: filtros.assigned }
        : {}),
      ...(filtros.unread ? { unread: true } : {}),
      ...(filtros.withLead !== undefined ? { withLead: filtros.withLead } : {}),
      ...(filtros.limit ? { limit: filtros.limit } : {}),
      ...(filtros.offset ? { offset: filtros.offset } : {}),
    },
  });
  return data;
}

export interface ContadoresBandeja {
  total: number;
  mine: number;
  unassigned: number;
  unread: number;
}

export async function getInboxCounters(): Promise<ContadoresBandeja> {
  const { data } = await api.get<ContadoresBandeja>(
    '/conversations/inbox/counters',
  );
  return data;
}

export type AccionMasiva =
  | { type: 'assign'; assignedTo: string }
  | { type: 'unassign' }
  | { type: 'status'; status: string }
  | { type: 'read' }
  | { type: 'unread' };

export async function bulkConversations(
  conversationIds: string[],
  accion: AccionMasiva,
): Promise<{ updated: number }> {
  const { data } = await api.post<{ updated: number }>('/conversations/bulk', {
    conversationIds,
    ...accion,
  });
  return data;
}

export async function markConversationRead(id: string) {
  const { data } = await api.post(`/conversations/${id}/read`);
  return data;
}

export async function markConversationUnread(id: string) {
  const { data } = await api.post(`/conversations/${id}/unread`);
  return data;
}
