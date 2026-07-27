import api from './axios';

export type NotificationCategory =
  | 'CONVERSATION'
  | 'MESSAGE'
  | 'CONTACT'
  | 'LEAD'
  | 'TASK'
  | 'QUOTE'
  | 'WHATSAPP'
  | 'SECURITY'
  | 'PLATFORM'
  | 'SYSTEM';

export type NotificationPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';

export interface AppNotification {
  id: string;
  type: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  bodyPreview: string | null;
  entityType: string | null;
  entityId: string | null;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  items: AppNotification[];
  nextCursor: string | null;
}

export interface NotificationPreference {
  category: NotificationCategory;
  inAppEnabled: boolean;
  emailEnabled: boolean;
}

export interface ListParams {
  unread?: boolean;
  category?: NotificationCategory;
  cursor?: string;
  limit?: number;
}

export async function getNotifications(
  params: ListParams = {},
): Promise<NotificationPage> {
  const { data } = await api.get<NotificationPage>('/notifications', {
    params: {
      ...(params.unread ? { unread: 'true' } : {}),
      ...(params.category ? { category: params.category } : {}),
      ...(params.cursor ? { cursor: params.cursor } : {}),
      ...(params.limit ? { limit: params.limit } : {}),
    },
  });
  return data;
}

export async function getUnreadCount(): Promise<number> {
  const { data } = await api.get<{ count: number }>(
    '/notifications/unread-count',
  );
  return data.count;
}

export async function markNotificationRead(id: string): Promise<boolean> {
  const { data } = await api.post<{ updated: boolean }>(
    `/notifications/${id}/read`,
  );
  return data.updated;
}

export async function markAllNotificationsRead(): Promise<number> {
  const { data } = await api.post<{ count: number }>('/notifications/read-all');
  return data.count;
}

export async function getNotificationPreferences(): Promise<
  NotificationPreference[]
> {
  const { data } = await api.get<NotificationPreference[]>(
    '/notifications/preferences',
  );
  return data;
}

export async function updateNotificationPreferences(
  preferences: {
    category: NotificationCategory;
    inAppEnabled?: boolean;
    emailEnabled?: boolean;
  }[],
): Promise<NotificationPreference[]> {
  const { data } = await api.put<NotificationPreference[]>(
    '/notifications/preferences',
    { preferences },
  );
  return data;
}

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  CONVERSATION: 'Conversaciones',
  MESSAGE: 'Mensajes',
  CONTACT: 'Contactos',
  LEAD: 'Oportunidades',
  TASK: 'Tareas',
  QUOTE: 'Cotizaciones',
  WHATSAPP: 'WhatsApp',
  SECURITY: 'Seguridad',
  PLATFORM: 'Plataforma',
  SYSTEM: 'Sistema',
};
