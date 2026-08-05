import api from './axios';
import { Pipeline, KanbanData } from '@/types';

export async function getPipelines(): Promise<Pipeline[]> {
  const { data } = await api.get<Pipeline[]>('/pipelines');
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
  type?: 'OPEN' | 'WON' | 'LOST';
  isInitial?: boolean;
}

export async function createPipeline(datos: { name: string; isDefault?: boolean }) {
  const { data } = await api.post<Pipeline>('/pipelines', datos);
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

export async function createStage(pipelineId: string, datos: DatosEtapa & { name: string }) {
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
  const { data } = await api.delete(`/pipelines/${pipelineId}/stages/${stageId}`);
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
