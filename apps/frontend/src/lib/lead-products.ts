import api from './axios';
import {
  LeadProductItem,
  AddLeadProductPayload,
  UpdateLeadProductPayload,
} from '@/types';

export async function getLeadProducts(leadId: string): Promise<LeadProductItem[]> {
  const { data } = await api.get<LeadProductItem[]>(`/leads/${leadId}/products`);
  return data;
}

export async function addProductToLead(
  leadId: string,
  payload: AddLeadProductPayload,
): Promise<LeadProductItem> {
  const { data } = await api.post<LeadProductItem>(`/leads/${leadId}/products`, payload);
  return data;
}

export async function updateLeadProduct(
  leadId: string,
  leadProductId: string,
  payload: UpdateLeadProductPayload,
): Promise<LeadProductItem> {
  const { data } = await api.patch<LeadProductItem>(
    `/leads/${leadId}/products/${leadProductId}`,
    payload,
  );
  return data;
}

export async function removeLeadProduct(
  leadId: string,
  leadProductId: string,
): Promise<{ id: string }> {
  const { data } = await api.delete<{ id: string }>(
    `/leads/${leadId}/products/${leadProductId}`,
  );
  return data;
}
