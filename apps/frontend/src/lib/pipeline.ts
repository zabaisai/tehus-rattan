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