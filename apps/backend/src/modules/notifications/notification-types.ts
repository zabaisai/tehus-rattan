import { NotificationCategory, NotificationPriority } from '@prisma/client';

// Typed catalog of notification event types. `type` is stored as a String in
// Prisma (open-ended) but every value the app emits comes from this const, so
// it is effectively a closed set with a category + default priority.
export const NOTIFICATION_TYPES = [
  'NEW_CONVERSATION',
  'NEW_INBOUND_MESSAGE',
  'CONVERSATION_ASSIGNED',
  'UNASSIGNED_CONVERSATION',
  'CONTACT_ASSIGNED',
  'LEAD_ASSIGNED',
  'LEAD_STAGE_CHANGED',
  'TASK_ASSIGNED',
  'TASK_DUE_SOON',
  'TASK_OVERDUE',
  'QUOTE_CREATED',
  'QUOTE_STATUS_CHANGED',
  'WHATSAPP_CONNECTED',
  'WHATSAPP_CONNECTION_FAILED',
  'WHATSAPP_REAUTH_REQUIRED',
  'WHATSAPP_DISCONNECTED',
  'SESSION_REVOKED',
  'SUSPICIOUS_LOGIN',
  'COMPANY_STATUS_CHANGED',
  'SYSTEM_ANNOUNCEMENT',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

interface TypeMeta {
  category: NotificationCategory;
  priority: NotificationPriority;
}

export const NOTIFICATION_TYPE_META: Record<NotificationType, TypeMeta> = {
  NEW_CONVERSATION: { category: 'CONVERSATION', priority: 'NORMAL' },
  NEW_INBOUND_MESSAGE: { category: 'MESSAGE', priority: 'NORMAL' },
  CONVERSATION_ASSIGNED: { category: 'CONVERSATION', priority: 'NORMAL' },
  // Alta: significa que hay clientes escribiendo y nadie los está viendo.
  UNASSIGNED_CONVERSATION: { category: 'CONVERSATION', priority: 'HIGH' },
  CONTACT_ASSIGNED: { category: 'CONTACT', priority: 'NORMAL' },
  LEAD_ASSIGNED: { category: 'LEAD', priority: 'NORMAL' },
  LEAD_STAGE_CHANGED: { category: 'LEAD', priority: 'LOW' },
  TASK_ASSIGNED: { category: 'TASK', priority: 'NORMAL' },
  TASK_DUE_SOON: { category: 'TASK', priority: 'HIGH' },
  TASK_OVERDUE: { category: 'TASK', priority: 'HIGH' },
  QUOTE_CREATED: { category: 'QUOTE', priority: 'NORMAL' },
  QUOTE_STATUS_CHANGED: { category: 'QUOTE', priority: 'NORMAL' },
  WHATSAPP_CONNECTED: { category: 'WHATSAPP', priority: 'NORMAL' },
  WHATSAPP_CONNECTION_FAILED: { category: 'WHATSAPP', priority: 'HIGH' },
  WHATSAPP_REAUTH_REQUIRED: { category: 'WHATSAPP', priority: 'HIGH' },
  WHATSAPP_DISCONNECTED: { category: 'WHATSAPP', priority: 'NORMAL' },
  SESSION_REVOKED: { category: 'SECURITY', priority: 'HIGH' },
  SUSPICIOUS_LOGIN: { category: 'SECURITY', priority: 'CRITICAL' },
  COMPANY_STATUS_CHANGED: { category: 'PLATFORM', priority: 'HIGH' },
  SYSTEM_ANNOUNCEMENT: { category: 'SYSTEM', priority: 'NORMAL' },
};

export const ALL_CATEGORIES: NotificationCategory[] = [
  'CONVERSATION',
  'MESSAGE',
  'CONTACT',
  'LEAD',
  'TASK',
  'QUOTE',
  'WHATSAPP',
  'SECURITY',
  'PLATFORM',
  'SYSTEM',
];

// Sensible defaults applied when a user has no explicit preference row.
// In-app on for everything; email OFF by default except the important
// categories a user is most likely to want reaching their inbox.
export function defaultPreference(category: NotificationCategory): {
  inAppEnabled: boolean;
  emailEnabled: boolean;
} {
  const emailByDefault: NotificationCategory[] = ['SECURITY', 'WHATSAPP'];
  return {
    inAppEnabled: true,
    emailEnabled: emailByDefault.includes(category),
  };
}

// Only these categories may ever produce an email (guards against emailing
// every low-value in-app notification even if a preference row says so).
export const EMAIL_ELIGIBLE_CATEGORIES: NotificationCategory[] = [
  'SECURITY',
  'WHATSAPP',
  'TASK',
];
