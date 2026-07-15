import api from './axios';
import {
  CreateInvitationCodePayload,
  CreateInvitationCodeResult,
  InvitationCode,
  InvitationCodeStatus,
} from '@/types';

export async function getInvitationCodes(params?: {
  status?: InvitationCodeStatus;
}): Promise<InvitationCode[]> {
  const { data } = await api.get<InvitationCode[]>('/admin/invitation-codes', {
    params,
  });
  return data;
}

export async function createInvitationCode(
  payload: CreateInvitationCodePayload,
): Promise<CreateInvitationCodeResult> {
  const { data } = await api.post<CreateInvitationCodeResult>(
    '/admin/invitation-codes',
    payload,
  );
  return data;
}

export async function revokeInvitationCode(id: string): Promise<InvitationCode> {
  const { data } = await api.post<InvitationCode>(
    `/admin/invitation-codes/${id}/revoke`,
  );
  return data;
}
