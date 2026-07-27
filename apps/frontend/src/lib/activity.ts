import api from './axios';
import {
  DeviceType,
  PlatformActivitySummary,
  PlatformCompanyActivity,
  PlatformSessionsPage,
  PlatformUserSession,
  UserSessionStatus,
} from '@/types';

export async function getActivitySummary(): Promise<PlatformActivitySummary> {
  const { data } = await api.get<PlatformActivitySummary>('/platform/activity/summary');
  return data;
}

export async function getCompanyActivity(companyId: string): Promise<PlatformCompanyActivity> {
  const { data } = await api.get<PlatformCompanyActivity>(
    `/platform/companies/${companyId}/activity`,
  );
  return data;
}

export async function getCompanySessions(
  companyId: string,
  params?: {
    page?: number;
    pageSize?: number;
    userId?: string;
    status?: UserSessionStatus;
    deviceType?: DeviceType;
    dateFrom?: string;
    dateTo?: string;
  },
): Promise<PlatformSessionsPage> {
  const { data } = await api.get<PlatformSessionsPage>(
    `/platform/companies/${companyId}/sessions`,
    { params },
  );
  return data;
}

export async function revokeSession(sessionId: string): Promise<PlatformUserSession> {
  const { data } = await api.post<PlatformUserSession>(
    `/platform/sessions/${sessionId}/revoke`,
  );
  return data;
}

export async function revokeAllUserSessions(
  userId: string,
): Promise<{ revokedCount: number }> {
  const { data } = await api.post<{ revokedCount: number }>(
    `/platform/users/${userId}/sessions/revoke-all`,
  );
  return data;
}

export async function revokeAllCompanySessions(
  companyId: string,
): Promise<{ revokedCount: number }> {
  const { data } = await api.post<{ revokedCount: number }>(
    `/platform/companies/${companyId}/sessions/revoke-all`,
  );
  return data;
}
