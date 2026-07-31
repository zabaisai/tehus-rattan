/**
 * Nombres de las salas de tiempo real.
 *
 * Están centralizados a propósito: la seguridad de todo el gateway depende de
 * que un cliente solo entre en salas derivadas de SU token, y eso solo se
 * puede auditar si los nombres se construyen en un único sitio.
 */
export const rooms = {
  /** Todos los conectados de una empresa. */
  company: (companyId: string) => `company:${companyId}`,
  /** Un usuario concreto, en todas sus pestañas y dispositivos. */
  user: (userId: string) => `user:${userId}`,
  /**
   * Una conversación. Lleva el companyId dentro del nombre a propósito: aunque
   * alguien lograra unirse con un id de conversación ajeno, la sala a la que
   * entraría no sería aquella a la que emite la empresa dueña.
   */
  conversation: (companyId: string, conversationId: string) =>
    `company:${companyId}:conversation:${conversationId}`,
} as const;

/**
 * Versión del contrato de eventos.
 *
 * Va en el nombre del evento (`v1:message.created`) y no en el payload: así un
 * cliente viejo simplemente no escucha los eventos nuevos, en vez de recibir
 * una forma que no sabe interpretar. Cambiar la forma de un evento significa
 * emitir `v2:` y mantener `v1:` hasta que no queden clientes antiguos.
 */
export const EVENT_VERSION = 'v1';

export const EVENTS = {
  MESSAGE_CREATED: `${EVENT_VERSION}:message.created`,
  MESSAGE_STATUS_CHANGED: `${EVENT_VERSION}:message.status_changed`,
  CONVERSATION_UPDATED: `${EVENT_VERSION}:conversation.updated`,
  LEAD_UPDATED: `${EVENT_VERSION}:lead.updated`,
  TASK_UPDATED: `${EVENT_VERSION}:task.updated`,
  NOTIFICATION_CREATED: `${EVENT_VERSION}:notification.created`,
} as const;

export type RealtimeEvent = (typeof EVENTS)[keyof typeof EVENTS];
