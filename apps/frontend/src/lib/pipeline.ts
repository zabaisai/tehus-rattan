import api from "./axios";
import { Pipeline, KanbanData } from "@/types";

export async function getPipelines(): Promise<Pipeline[]> {
  const { data } = await api.get<Pipeline[]>("/pipelines");
  return data;
}

export async function getKanban(pipelineId: string): Promise<KanbanData> {
  const { data } = await api.get<KanbanData>(`/pipelines/${pipelineId}/kanban`);
  return data;
}

export async function changeLeadStage(leadId: string, stageId: string) {
  const { data } = await api.patch(`/leads/${leadId}/stage`, { stageId });
  return data;
}
// ── administración ──────────────────────────────────────────────

export interface DatosPipeline {
  name?: string;
  isDefault?: boolean;
  order?: number;
  isArchived?: boolean;
}

export interface DatosEtapa {
  name?: string;
  order?: number;
  color?: string;
  probability?: number;
  type?: "OPEN" | "WON" | "LOST";
  isInitial?: boolean;
}

export async function createPipeline(datos: {
  name: string;
  isDefault?: boolean;
}) {
  const { data } = await api.post<Pipeline>("/pipelines", datos);
  return data;
}

export async function updatePipeline(id: string, datos: DatosPipeline) {
  const { data } = await api.patch<Pipeline>(`/pipelines/${id}`, datos);
  return data;
}

export async function deletePipeline(id: string) {
  const { data } = await api.delete(`/pipelines/${id}`);
  return data;
}

export async function createStage(
  pipelineId: string,
  datos: DatosEtapa & { name: string },
) {
  const { data } = await api.post(`/pipelines/${pipelineId}/stages`, datos);
  return data;
}

export async function updateStage(
  pipelineId: string,
  stageId: string,
  datos: DatosEtapa,
) {
  const { data } = await api.patch(
    `/pipelines/${pipelineId}/stages/${stageId}`,
    datos,
  );
  return data;
}

export async function deleteStage(pipelineId: string, stageId: string) {
  const { data } = await api.delete(
    `/pipelines/${pipelineId}/stages/${stageId}`,
  );
  return data;
}

export async function reorderStages(
  pipelineId: string,
  stages: Array<{ id: string; order: number }>,
) {
  const { data } = await api.patch(`/pipelines/${pipelineId}/stages/reorder`, {
    stages,
  });
  return data;
}

// ── retiro de embudos ───────────────────────────────────────────

/** Lo que hay dentro de un embudo antes de retirarlo. Solo lectura. */
export interface ResumenDeRetiro {
  pipelineId: string;
  nombre: string;
  archivado: boolean;
  esPredeterminado: boolean;
  oportunidades: {
    abiertas: number;
    ganadas: number;
    perdidas: number;
    total: number;
  };
  porEtapa: Array<{ stageId: string; nombre: string; total: number }>;
  enUsoPorLaConfiguracion: boolean;
  puede: {
    eliminar: boolean;
    archivar: boolean;
    requiereTraslado: boolean;
  };
  motivo: string | null;
}

export async function getResumenDeRetiro(id: string): Promise<ResumenDeRetiro> {
  const { data } = await api.get<ResumenDeRetiro>(`/pipelines/${id}/retiro`);
  return data;
}

/**
 * Mueve TODAS las oportunidades del embudo a una etapa de otro.
 *
 * El destino va por id, nunca por nombre: buscar «Cotizaciones» rompe en
 * cuanto alguien renombra su embudo, y renombrarlo es algo que puede pasar
 * cualquier día.
 */
export async function trasladarOportunidades(
  id: string,
  destino: { pipelineDestinoId: string; etapaDestinoId: string },
): Promise<{
  trasladadas: number;
  destino: { pipeline: string; etapa: string };
}> {
  const { data } = await api.post(
    `/pipelines/${id}/trasladar-oportunidades`,
    destino,
  );
  return data;
}

export async function archivarPipeline(
  id: string,
): Promise<{ archivado: boolean; oportunidades: number }> {
  const { data } = await api.post(`/pipelines/${id}/archivar`);
  return data;
}

export async function restaurarPipeline(
  id: string,
): Promise<{ restaurado: boolean }> {
  const { data } = await api.post(`/pipelines/${id}/restaurar`);
  return data;
}

export async function reordenarPipelines(
  pipelines: Array<{ id: string; order: number }>,
): Promise<{ reordenados: number }> {
  const { data } = await api.patch("/pipelines/reordenar/embudos", {
    pipelines,
  });
  return data;
}
