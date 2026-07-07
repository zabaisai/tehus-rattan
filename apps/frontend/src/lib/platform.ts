import api from './axios';
import {
  CompanyStatus,
  CreatePlatformCompanyPayload,
  PlatformCompanyCreated,
  PlatformCompanyDetail,
  PlatformCompanyListItem,
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
): Promise<PlatformCompanyListItem> {
  const { data } = await api.patch<PlatformCompanyListItem>(
    `/platform/companies/${id}/status`,
    { status },
  );
  return data;
}
