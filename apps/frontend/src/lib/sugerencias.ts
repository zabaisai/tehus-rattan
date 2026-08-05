import api from "./axios";

export type EstadoSugerencia =
  "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CANCELLED";

/**
 * Una tarea PROPUESTA, todavía no creada.
 *
 * El bot no puede meter trabajo en la lista de una persona sin que esa persona
 * lo acepte: cuando eso pasa, la lista deja de ser de quien la usa y se
 * vuelve un vertedero que nadie mira.
 */
export interface SugerenciaDeTarea {
  id: string;
  status: EstadoSugerencia;
  source: string;
  reason: string | null;
  excerpt: string | null;
  title: string;
  description: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  dueAt: string | null;
  suggestedAssignee: string | null;
  suggestedUser: { id: string; name: string } | null;
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdTaskId: string | null;
  contactId: string | null;
  conversationId: string | null;
  leadId: string | null;
  contact: { id: string; name: string | null; phone: string } | null;
  createdAt: string;
}

export async function getSugerencias(
  filtros: {
    estado?: EstadoSugerencia;
    contactId?: string;
    conversationId?: string;
    leadId?: string;
    limit?: number;
  } = {},
): Promise<SugerenciaDeTarea[]> {
  const { data } = await api.get<SugerenciaDeTarea[]>("/task-suggestions", {
    params: filtros,
  });
  return data;
}

/**
 * Aprobar es lo ÚNICO que crea una tarea real.
 *
 * Los ajustes son opcionales: lo que el bot sugiere es un borrador, y quien
 * aprueba puede corregir el título, la prioridad, el vencimiento y a quién se
 * asigna antes de aceptarlo.
 */
export async function aprobarSugerencia(
  id: string,
  ajustes: {
    title?: string;
    description?: string;
    priority?: string;
    dueAt?: string;
    assignedTo?: string;
    note?: string;
  } = {},
): Promise<{ tarea: { id: string } | null; yaEstaba: boolean }> {
  const { data } = await api.post(`/task-suggestions/${id}/aprobar`, ajustes);
  return data;
}

export async function rechazarSugerencia(
  id: string,
  note?: string,
): Promise<{ rechazada: boolean }> {
  const { data } = await api.post(`/task-suggestions/${id}/rechazar`, { note });
  return data;
}
