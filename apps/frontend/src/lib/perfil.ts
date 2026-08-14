import api from "./axios";

/**
 * El perfil comercial: UN contrato para las dos pantallas.
 *
 * Lo consumen el panel del Pipeline y el de Conversaciones. Si cada una se
 * armara el suyo con consultas sueltas acabarían discrepando —una enseñaría el
 * asesor y la otra no, una contaría las tareas abiertas y la otra todas— y
 * nadie sabría cuál dice la verdad. El servidor lo resuelve entero y viaja una
 * vez.
 */
export interface PerfilComercial {
  contacto: {
    id: string;
    nombre: string | null;
    telefono: string;
    email: string | null;
    etiquetas: string[];
    bloqueado: boolean;
    archivadoEn: string | null;
    motivoDeArchivo: string | null;
    anonimizado: boolean;
    creadoEn: string;
  };
  empresa: { id: string; nombre: string };
  oportunidad: {
    id: string;
    titulo: string;
    valor: number;
    estado: string;
    pipeline: { id: string; nombre: string };
    etapa: { id: string; nombre: string; color: string | null };
    asesor: { id: string; nombre: string } | null;
  } | null;
  conversacion: {
    id: string;
    estado: string;
    pausada: boolean;
    asesor: { id: string; nombre: string } | null;
    ultimoMensaje: {
      cuerpo: string | null;
      entrante: boolean;
      fecha: string;
    } | null;
  } | null;
  tareasPendientes: Array<{
    id: string;
    titulo: string;
    vence: string | null;
    prioridad: string;
  }>;
  cotizaciones: Array<{
    id: string;
    numero: string;
    estado: string;
    total: number;
    creadaEn: string;
  }>;
  /** Conteos reales, contados en la base y no derivados de las listas. */
  resumen: {
    valorAbierto: number;
    conversaciones: number;
    oportunidades: number;
    tareasPendientes: number;
    cotizaciones: number;
    documentos: number;
  };
  conversaciones: Array<{
    id: string;
    canal: string;
    estado: string;
    pausada: boolean;
    ultimoMensajeEn: string | null;
    asesor: { id: string; nombre: string } | null;
  }>;
  oportunidades: Array<{
    id: string;
    titulo: string;
    valor: number;
    estado: string;
    pipeline: { id: string; nombre: string };
    etapa: { id: string; nombre: string; color: string | null };
    asesor: { id: string; nombre: string } | null;
    actualizadaEn: string;
  }>;
  /** Los documentos del producto son los PDF de cotizaciones emitidas. */
  documentos: Array<{
    id: string;
    numero: string;
    estado: string;
    creadaEn: string;
  }>;
  ultimaInteraccionEn: string | null;
  camposPersonalizados: Array<{
    key: string;
    label: string;
    valor: string | null;
  }>;
  /** Qué está haciendo el bot en esta conversación ahora mismo. */
  pulso: {
    ejecucionId: string;
    bot: string;
    estado: string;
    esperando: boolean;
    yaPasoAPersona: boolean;
  } | null;
  actividad: Array<{
    tipo: "etapa" | "nota" | "cotizacion";
    descripcion: string;
    fecha: string;
  }>;
}

export async function getPerfilComercial(
  contactId: string,
): Promise<PerfilComercial> {
  const { data } = await api.get<PerfilComercial>(
    `/contacts/${contactId}/perfil`,
  );
  return data;
}

/** Clave de caché compartida: las dos pantallas leen la misma entrada. */
export const clavePerfil = (contactId: string) => ["perfil", contactId];
