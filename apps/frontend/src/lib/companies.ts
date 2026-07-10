import api from './axios';
import { Company, UpdateCompanyPayload, CompanyLogoUploadResult } from '@/types';

export async function getMyCompany(): Promise<Company> {
  const { data } = await api.get<Company>('/companies/me');
  return data;
}

export async function updateMyCompany(payload: UpdateCompanyPayload): Promise<Company> {
  const { data } = await api.patch<Company>('/companies/me', payload);
  return data;
}

export function resolveCompanyAssetUrl(path: string): string {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || '';
  const origin = apiBase.replace(/\/api\/?$/, '');
  return `${origin}${path}`;
}

export async function uploadCompanyLogo(
  file: File,
  type: 'primary' | 'secondary' = 'primary',
): Promise<CompanyLogoUploadResult> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', type);

  const { data } = await api.post<CompanyLogoUploadResult>('/companies/me/logo', formData);
  return data;
}
