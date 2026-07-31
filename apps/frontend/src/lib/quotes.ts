import api from './axios';
import { Quote, QuoteStatus, CreateQuoteFromLeadPayload, UpdateQuotePayload } from '@/types';

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  DRAFT: 'Borrador',
  SENT: 'Enviada',
  ACCEPTED: 'Aceptada',
  REJECTED: 'Rechazada',
  EXPIRED: 'Expirada',
};

export const QUOTE_STATUS_COLORS: Record<QuoteStatus, string> = {
  DRAFT: 'bg-stone-100 text-stone-600',
  SENT: 'bg-blue-50 text-blue-700',
  ACCEPTED: 'bg-green-50 text-green-700',
  REJECTED: 'bg-red-50 text-red-700',
  EXPIRED: 'bg-amber-50 text-amber-700',
};

export async function getQuotes(filters?: {
  leadId?: string;
  status?: string;
}): Promise<Quote[]> {
  const { data } = await api.get<Quote[]>('/quotes', { params: filters });
  return data;
}

export async function getQuote(id: string): Promise<Quote> {
  const { data } = await api.get<Quote>(`/quotes/${id}`);
  return data;
}

export async function createQuoteFromLead(
  leadId: string,
  payload: CreateQuoteFromLeadPayload,
): Promise<Quote> {
  const { data } = await api.post<Quote>(`/quotes/from-lead/${leadId}`, payload);
  return data;
}

export async function updateQuote(
  id: string,
  payload: UpdateQuotePayload,
): Promise<Quote> {
  const { data } = await api.patch<Quote>(`/quotes/${id}`, payload);
  return data;
}

export async function deleteQuote(id: string): Promise<{ id: string }> {
  const { data } = await api.delete<{ id: string }>(`/quotes/${id}`);
  return data;
}

/**
 * Abre el PDF generado por el SERVIDOR.
 *
 * Se descarga con el cliente HTTP y no con `window.open` de la URL directa
 * porque el token de sesion vive en memoria de la pestana, no en una cookie
 * que el navegador adjunte solo: una pestana nueva llegaria sin credenciales
 * y recibiria un 401.
 *
 * El blob se revoca al terminar; no hacerlo deja el PDF entero retenido en
 * memoria mientras la pestana siga abierta.
 */
export async function abrirQuotePdf(id: string, numero: string): Promise<void> {
  const { data } = await api.get<Blob>(`/quotes/${id}/pdf`, {
    responseType: 'blob',
  });

  const url = URL.createObjectURL(data);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.target = '_blank';
  enlace.rel = 'noopener';
  // `download` da nombre al archivo si el usuario decide guardarlo, sin
  // impedir que primero lo vea: lo normal es revisarlo antes de mandarlo.
  enlace.download = `cotizacion-${numero}.pdf`;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
}
