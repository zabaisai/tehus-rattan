import api from './axios';
import { Lead, LeadDetail, LeadStageHistoryEntry } from '@/types';

export async function getLeads(params?: {
  pipelineId?: string;
  stageId?: string;
  contactId?: string;
  assignedTo?: string;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<Lead[]> {
  const { data } = await api.get<Lead[]>('/leads', { params });
  return data;
}

export async function getLead(id: string): Promise<LeadDetail> {
  const { data } = await api.get<LeadDetail>(`/leads/${id}`);
  return data;
}

export async function getLeadHistory(id: string): Promise<LeadStageHistoryEntry[]> {
  const { data } = await api.get<LeadStageHistoryEntry[]>(`/leads/${id}/history`);
  return data;
}

export async function createLead(payload: {
  title: string;
  contactId: string;
  pipelineId: string;
  stageId: string;
  value?: number;
  expectedCloseDate?: string;
  assignedTo?: string;
}): Promise<Lead> {
  const { data } = await api.post<Lead>('/leads', payload);
  return data;
}

export async function updateLead(
  id: string,
  payload: {
    title?: string;
    value?: number;
    expectedCloseDate?: string;
    assignedTo?: string;
  },
): Promise<Lead> {
  const { data } = await api.patch<Lead>(`/leads/${id}`, payload);
  return data;
}

export async function updateLeadStatus(
  id: string,
  status: 'WON' | 'LOST',
  lostReason?: string,
): Promise<Lead> {
  const { data } = await api.patch<Lead>(`/leads/${id}/status`, { status, lostReason });
  return data;
}

export async function markLeadWon(id: string): Promise<Lead> {
  return updateLeadStatus(id, 'WON');
}

export async function markLeadLost(id: string, lostReason?: string): Promise<Lead> {
  return updateLeadStatus(id, 'LOST', lostReason);
}
