import api from './axios';
import { CompanyUser } from '@/types';

export async function getCompanyUsers(): Promise<CompanyUser[]> {
  const { data } = await api.get<CompanyUser[]>('/users');
  return data;
}
