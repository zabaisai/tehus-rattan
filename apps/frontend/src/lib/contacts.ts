import api from './axios';
import { Contact } from '@/types';

export async function getContacts(): Promise<Contact[]> {
  const { data } = await api.get<Contact[]>('/contacts');
  return data;
}

export async function createContact(payload: {
  phone: string;
  name?: string;
  email?: string;
}): Promise<Contact> {
  const { data } = await api.post<Contact>('/contacts', payload);
  return data;
}

export async function updateContact(
  id: string,
  payload: { name?: string; email?: string },
): Promise<Contact> {
  const { data } = await api.patch<Contact>(`/contacts/${id}`, payload);
  return data;
}

export async function deleteContact(id: string): Promise<void> {
  await api.delete(`/contacts/${id}`);
}