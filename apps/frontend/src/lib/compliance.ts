import api from './axios';

/**
 * Retención, exportación y solicitudes de eliminación de la propia empresa.
 *
 * Todo lo de aquí lo consume una sola pantalla, pero vive aparte porque las
 * respuestas del backend tienen forma propia —la previsualización de purga
 * puede decir «no aplicable»— y esa forma hay que respetarla en la interfaz en
 * vez de aplanarla a un número.
 */

export interface PoliticaRetencion {
  retentionMonths: number | null;
  retentionPurgeEnabled: boolean;
}

/** Ninguna política: `aplicable: false`. No es un error, es el estado por defecto. */
export type PrevisualizacionPurga =
  | { aplicable: false; motivo: 'sin-politica'; mensajes: number }
  | {
      aplicable: true;
      corte: string;
      purgaActivada: boolean;
      mensajes: number;
    };

export interface SolicitudEliminacion {
  id: string;
  companyId: string;
  type: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED';
  reason: string | null;
  requestedAt: string;
  requestedBy: string | null;
  approvedAt: string | null;
  executedAt: string | null;
  rejectionReason: string | null;
}

/** Meses mínimos que acepta el backend. Aquí para poder avisar antes de enviar. */
export const RETENCION_MINIMA_MESES = 6;

export async function getRetention() {
  const { data } = await api.get<PoliticaRetencion>('/compliance/retention');
  return data;
}

export async function setRetention(cambio: Partial<PoliticaRetencion>) {
  const { data } = await api.patch<PoliticaRetencion>(
    '/compliance/retention',
    cambio,
  );
  return data;
}

export async function previewPurge() {
  const { data } = await api.get<PrevisualizacionPurga>(
    '/compliance/retention/preview',
  );
  return data;
}

export async function purge() {
  const { data } = await api.post<{ mensajesEliminados: number; corte: string }>(
    '/compliance/retention/purge',
  );
  return data;
}

export async function exportCompanyData() {
  const { data } = await api.get<Record<string, unknown>>('/compliance/export');
  return data;
}

export async function requestDeletion(reason: string) {
  const { data } = await api.post<SolicitudEliminacion>(
    '/compliance/deletion-request',
    { reason },
  );
  return data;
}

export async function getDeletionRequests() {
  const { data } = await api.get<SolicitudEliminacion[]>('/compliance/requests');
  return data;
}

export const ETIQUETA_ESTADO_SOLICITUD: Record<
  SolicitudEliminacion['status'],
  string
> = {
  PENDING: 'Pendiente de revisión',
  APPROVED: 'Aprobada, sin ejecutar',
  REJECTED: 'Rechazada',
  COMPLETED: 'Ejecutada',
};

/**
 * Descarga la exportación como fichero.
 *
 * Se hace en el navegador y no en el servidor porque el backend ya devuelve
 * el JSON completo: pedirle además que sirva un adjunto añadiría una ruta
 * autenticada que descarga datos de la empresa entera, y esa es exactamente la
 * clase de URL que acaba compartida por error.
 */
export function descargarExportacion(
  datos: unknown,
  nombreEmpresa: string,
  crearUrl: (blob: Blob) => string = URL.createObjectURL,
  revocarUrl: (url: string) => void = URL.revokeObjectURL,
) {
  const blob = new Blob([JSON.stringify(datos, null, 2)], {
    type: 'application/json',
  });
  const url = crearUrl(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = `${nombreEmpresa
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}-datos.json`;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  revocarUrl(url);
}
