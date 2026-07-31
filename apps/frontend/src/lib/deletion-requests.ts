import api from './axios';

/**
 * Aprobación y ejecución de eliminaciones. Rutas de PLATAFORMA.
 *
 * Separado de `compliance.ts` a propósito: allí vive lo que una empresa puede
 * hacer con sus propios datos, aquí lo que solo la plataforma puede consumar.
 * Mezclarlos invitaría a llamar a `execute` desde una pantalla de empresa.
 */

export interface ResumenEliminacion {
  mensajes: number;
  conversaciones: number;
  oportunidades: number;
  tareas: number;
  cotizaciones: number;
  contactos: number;
  automatizaciones: number;
  flujosChatbot: number;
}

export interface SolicitudPlataforma {
  id: string;
  companyId: string;
  company: { id: string; name: string };
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED';
  reason: string | null;
  requestedAt: string;
  requestedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  executedAt: string | null;
  executedBy: string | null;
  rejectionReason: string | null;
}

export interface PrevisualizacionEliminacion {
  empresa: { id: string; name: string };
  status: SolicitudPlataforma['status'];
  resumen: ResumenEliminacion;
}

/** Orden fijo para que el recuento se lea siempre igual. */
export const FILAS_RESUMEN: Array<{
  clave: keyof ResumenEliminacion;
  etiqueta: string;
}> = [
  { clave: 'mensajes', etiqueta: 'Mensajes' },
  { clave: 'conversaciones', etiqueta: 'Conversaciones' },
  { clave: 'contactos', etiqueta: 'Contactos' },
  { clave: 'oportunidades', etiqueta: 'Oportunidades' },
  { clave: 'cotizaciones', etiqueta: 'Cotizaciones' },
  { clave: 'tareas', etiqueta: 'Tareas' },
  { clave: 'automatizaciones', etiqueta: 'Automatizaciones' },
  { clave: 'flujosChatbot', etiqueta: 'Flujos de chatbot' },
];

export async function getDeletionRequests(status?: string) {
  const { data } = await api.get<SolicitudPlataforma[]>(
    '/platform/deletion-requests',
    { params: status ? { status } : undefined },
  );
  return data;
}

export async function previewDeletion(id: string) {
  const { data } = await api.get<PrevisualizacionEliminacion>(
    `/platform/deletion-requests/${id}/preview`,
  );
  return data;
}

export async function approveDeletion(id: string) {
  const { data } = await api.post<SolicitudPlataforma>(
    `/platform/deletion-requests/${id}/approve`,
  );
  return data;
}

export async function rejectDeletion(id: string, reason: string) {
  const { data } = await api.post<SolicitudPlataforma>(
    `/platform/deletion-requests/${id}/reject`,
    { reason },
  );
  return data;
}

export async function executeDeletion(id: string, confirmation: string) {
  const { data } = await api.post<{ resumen: ResumenEliminacion }>(
    `/platform/deletion-requests/${id}/execute`,
    { confirmation },
  );
  return data;
}

export const ETIQUETA_ESTADO: Record<SolicitudPlataforma['status'], string> = {
  PENDING: 'Pendiente',
  APPROVED: 'Aprobada',
  REJECTED: 'Rechazada',
  COMPLETED: 'Ejecutada',
};

export const CLASE_ESTADO: Record<SolicitudPlataforma['status'], string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-red-100 text-red-800',
  REJECTED: 'bg-neutral-200 text-neutral-700',
  COMPLETED: 'bg-neutral-800 text-white',
};
