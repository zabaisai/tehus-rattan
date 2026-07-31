import api from './axios';

/** Tope por importación, igual que en el backend. */
export const MAXIMO_FILAS = 20_000;

export const CABECERAS_CSV = 'telefono,fecha,direccion,texto,referencia';

export interface FilaHistorial {
  telefono: string;
  fecha: string;
  direccion: 'INBOUND' | 'OUTBOUND';
  texto: string;
  referencia: string;
}

export interface AnalisisHistorial {
  filasValidas: number;
  rechazados: Array<{ fila: number; motivo: string }>;
  muestra: FilaHistorial[];
}

export interface ResultadoImportacion {
  filasLeidas: number;
  importados: number;
  duplicados: number;
  rechazados: Array<{ fila: number; motivo: string }>;
}

export async function previewHistory(csv: string) {
  const { data } = await api.post<AnalisisHistorial>(
    '/whatsapp/history/preview',
    { csv },
  );
  return data;
}

export async function importHistory(csv: string) {
  const { data } = await api.post<ResultadoImportacion>(
    '/whatsapp/history/import',
    { csv },
  );
  return data;
}
