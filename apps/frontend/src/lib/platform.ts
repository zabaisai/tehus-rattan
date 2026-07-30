import api from './axios';
import {
  CompanyStatus,
  CreatePlatformCompanyPayload,
  CreateSupportSessionPayload,
  PlatformAuditLog,
  PlatformCompanyCreated,
  PlatformCompanyDetail,
  PlatformCompanyListItem,
  PlatformCompanySupportOverview,
  PlatformSupportConversation,
  PlatformSupportConversationDetail,
  PlatformConnectWhatsAppIntegrationPayload,
  PlatformSupportSession,
  SupportSessionStatus,
  WhatsAppIntegration,
} from '@/types';

export async function getPlatformCompanies(params?: {
  search?: string;
  status?: CompanyStatus;
}): Promise<PlatformCompanyListItem[]> {
  const { data } = await api.get<PlatformCompanyListItem[]>(
    '/platform/companies',
    { params },
  );
  return data;
}

export async function getPlatformCompany(
  id: string,
): Promise<PlatformCompanyDetail> {
  const { data } = await api.get<PlatformCompanyDetail>(
    `/platform/companies/${id}`,
  );
  return data;
}

export async function createPlatformCompany(
  payload: CreatePlatformCompanyPayload,
): Promise<PlatformCompanyCreated> {
  const { data } = await api.post<PlatformCompanyCreated>(
    '/platform/companies',
    payload,
  );
  return data;
}

export async function updatePlatformCompanyStatus(
  id: string,
  status: CompanyStatus,
  reason?: string,
): Promise<PlatformCompanyListItem> {
  const { data } = await api.patch<PlatformCompanyListItem>(
    `/platform/companies/${id}/status`,
    reason ? { status, reason } : { status },
  );
  return data;
}

export async function getPlatformCompanySupportOverview(
  id: string,
): Promise<PlatformCompanySupportOverview> {
  const { data } = await api.get<PlatformCompanySupportOverview>(
    `/platform/companies/${id}/support-overview`,
  );
  return data;
}

// Support-gated manual WhatsApp connection performed by a platform
// SUPER_ADMIN. The companyId travels in the path (never in the body) and the
// server re-validates the support session against it before writing anything.
export async function connectPlatformCompanyWhatsApp(
  companyId: string,
  payload: PlatformConnectWhatsAppIntegrationPayload,
): Promise<WhatsAppIntegration> {
  const { data } = await api.put<WhatsAppIntegration>(
    `/platform/companies/${companyId}/whatsapp-integration`,
    payload,
  );
  return data;
}

export async function getPlatformAuditLogs(params?: {
  action?: string;
  affectedCompanyId?: string;
  actorUserId?: string;
}): Promise<PlatformAuditLog[]> {
  const { data } = await api.get<PlatformAuditLog[]>('/platform/audit-logs', {
    params,
  });
  return data;
}

export async function createSupportSession(
  payload: CreateSupportSessionPayload,
): Promise<PlatformSupportSession> {
  const { data } = await api.post<PlatformSupportSession>(
    '/platform/support-sessions',
    payload,
  );
  return data;
}

export async function getSupportSessions(params?: {
  companyId?: string;
  status?: SupportSessionStatus;
}): Promise<PlatformSupportSession[]> {
  const { data } = await api.get<PlatformSupportSession[]>(
    '/platform/support-sessions',
    { params },
  );
  return data;
}

export async function endSupportSession(
  id: string,
): Promise<PlatformSupportSession> {
  const { data } = await api.post<PlatformSupportSession>(
    `/platform/support-sessions/${id}/end`,
  );
  return data;
}

export async function getSupportSessionConversations(
  id: string,
  params?: { page?: number; limit?: number },
): Promise<PlatformSupportConversation[]> {
  const { data } = await api.get<PlatformSupportConversation[]>(
    `/platform/support-sessions/${id}/conversations`,
    { params },
  );
  return data;
}

export async function getSupportSessionConversationDetail(
  sessionId: string,
  conversationId: string,
  params?: { page?: number; limit?: number },
): Promise<PlatformSupportConversationDetail> {
  const { data } = await api.get<PlatformSupportConversationDetail>(
    `/platform/support-sessions/${sessionId}/conversations/${conversationId}`,
    { params },
  );
  return data;
}
