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