import api from './axios';
import {
  ActividadReciente,
  AgentPerformance,
  AnalyticsOverview,
  LeadsByStage,
  LostReason,
  SalesTrend,
} from '@/types';

export async function getOverview(): Promise<AnalyticsOverview> {
  const { data } = await api.get<AnalyticsOverview>('/analytics/overview');
  return data;
}

export async function getLeadsByStage(): Promise<LeadsByStage[]> {
  const { data } = await api.get<LeadsByStage[]>('/analytics/leads-by-stage');
  return data;
}

export async function getAgentPerformance(): Promise<AgentPerformance[]> {
  const { data } = await api.get<AgentPerformance[]>('/analytics/agent-performance');
  return data;
}

export async function getLostReasons(): Promise<LostReason[]> {
  const { data } = await api.get<LostReason[]>('/analytics/lost-reasons');
  return data;
}

export async function getOverdueTasksCount(): Promise<number> {
  const { data } = await api.get<{ count: number }>('/analytics/tasks-overdue');
  return data.count;
}

export async function getPendingConversationsCount(): Promise<number> {
  const { data } = await api.get<{ count: number }>('/analytics/conversations-pending');
  return data.count;
}

/** Serie diaria: alimenta la tendencia y las comparaciones de las métricas. */
export async function getSalesTrend(days = 30): Promise<SalesTrend> {
  const { data } = await api.get<SalesTrend>('/analytics/sales-trend', {
    params: { days },
  });
  return data;
}

export async function getRecentActivity(
  limit = 8,
): Promise<ActividadReciente[]> {
  const { data } = await api.get<ActividadReciente[]>('/analytics/activity', {
    params: { limit },
  });
  return data;
}