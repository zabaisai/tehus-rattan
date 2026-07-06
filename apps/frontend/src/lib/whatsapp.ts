import api from './axios';
import { ConnectWhatsAppIntegrationPayload, WhatsAppIntegration } from '@/types';

export async function getWhatsAppIntegration(): Promise<WhatsAppIntegration | null> {
  const { data } = await api.get<WhatsAppIntegration | null>(
    '/whatsapp-integrations/me',
  );
  return data;
}

export async function connectOrUpdateWhatsAppIntegration(
  payload: ConnectWhatsAppIntegrationPayload,
): Promise<WhatsAppIntegration> {
  const { data } = await api.put<WhatsAppIntegration>(
    '/whatsapp-integrations/me',
    payload,
  );
  return data;
}

export async function disconnectWhatsAppIntegration(): Promise<WhatsAppIntegration> {
  const { data } = await api.post<WhatsAppIntegration>(
    '/whatsapp-integrations/me/disconnect',
  );
  return data;
}
