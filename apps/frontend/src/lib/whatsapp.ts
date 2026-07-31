import api from './axios';
import { ConnectWhatsAppIntegrationPayload, WhatsAppIntegration } from '@/types';

// Public config + single-use state the backend returns to launch the Meta SDK.
// The app secret is NEVER sent here.
export interface EmbeddedSignupStart {
  appId: string;
  configId: string;
  graphVersion: string;
  state: string;
  expiresAt: string;
}

export type ConnectionStatusValue =
  | 'NOT_CONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'REAUTH_REQUIRED'
  | 'DISCONNECTED'
  | 'REVOKED'
  | 'ERROR';

// Safe, token-free connection snapshot (phone masked, WABA hidden).
export interface WhatsAppConnectionStatus {
  status: ConnectionStatusValue;
  connectionMethod: 'MANUAL' | 'EMBEDDED_SIGNUP' | 'COEXISTENCE' | null;
  coexistence: boolean;
  maskedPhoneNumber: string | null;
  businessName: string | null;
  connectedAt: string | null;
  lastCheckedAt: string | null;
  webhookStatus: 'SUBSCRIBED' | 'UNKNOWN';
  actionRequired: boolean;
  errorCode: string | null;
}

// What the browser posts to finish the flow. The code is the 30s exchangeable
// code from FB.login; the ids come from the Meta message event. The access
// token is NEVER handled by the browser.
export interface EmbeddedSignupCompletePayload {
  state: string;
  code: string;
  phoneNumberId: string;
  wabaId: string;
  businessId?: string;
}

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

export async function getWhatsAppConnectionStatus(): Promise<WhatsAppConnectionStatus> {
  const { data } = await api.get<WhatsAppConnectionStatus>(
    '/whatsapp-integrations/me/connection-status',
  );
  return data;
}

export async function startEmbeddedSignup(): Promise<EmbeddedSignupStart> {
  const { data } = await api.post<EmbeddedSignupStart>(
    '/whatsapp-integrations/me/embedded-signup/start',
  );
  return data;
}

export async function completeEmbeddedSignup(
  payload: EmbeddedSignupCompletePayload,
): Promise<WhatsAppConnectionStatus> {
  const { data } = await api.post<WhatsAppConnectionStatus>(
    '/whatsapp-integrations/me/embedded-signup/complete',
    payload,
  );
  return data;
}

export async function reconnectWhatsApp(): Promise<EmbeddedSignupStart> {
  const { data } = await api.post<EmbeddedSignupStart>(
    '/whatsapp-integrations/me/reconnect',
  );
  return data;
}

// Explicit connection test — sends one text to an E.164 number using the
// company's connected integration. Works only inside Meta's conversation window.
export async function testWhatsAppConnection(
  to: string,
): Promise<{ status: 'ok' }> {
  const { data } = await api.post<{ status: 'ok' }>(
    '/whatsapp-integrations/me/test',
    { to },
  );
  return data;
}

// ── Varios numeros ─────────────────────────────────────────────

/** Un numero conectado de la empresa. Nunca incluye el token. */
export interface NumeroWhatsApp {
  id: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  label: string | null;
  isPrimary: boolean;
  order: number;
  status: ConnectionStatusValue | 'PENDING';
  connectedAt: string | null;
  lastErrorCode: string | null;
}

export async function getWhatsAppNumbers(): Promise<NumeroWhatsApp[]> {
  const { data } = await api.get<NumeroWhatsApp[]>(
    '/whatsapp-integrations/me/numbers',
  );
  return data;
}

export async function renameWhatsAppNumber(
  id: string,
  label: string | null,
): Promise<NumeroWhatsApp> {
  const { data } = await api.patch<NumeroWhatsApp>(
    `/whatsapp-integrations/me/numbers/${id}`,
    { label },
  );
  return data;
}

export async function setPrimaryWhatsAppNumber(
  id: string,
): Promise<NumeroWhatsApp> {
  const { data } = await api.post<NumeroWhatsApp>(
    `/whatsapp-integrations/me/numbers/${id}/primary`,
  );
  return data;
}
