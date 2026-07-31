import { io, type Socket } from "socket.io-client";
import { getAccessToken } from "./auth-token";

/**
 * Nombres de evento versionados. Deben coincidir EXACTAMENTE con los del
 * backend (`common/realtime/realtime.rooms.ts`). La versión va en el nombre y
 * no en el payload a propósito: un cliente antiguo simplemente no escucha los
 * eventos nuevos, en vez de recibir una forma que no sabe interpretar.
 */
export const EVENT_VERSION = "v1";

export const EVENTS = {
  MESSAGE_CREATED: `${EVENT_VERSION}:message.created`,
  MESSAGE_STATUS_CHANGED: `${EVENT_VERSION}:message.status_changed`,
  CONVERSATION_UPDATED: `${EVENT_VERSION}:conversation.updated`,
  LEAD_UPDATED: `${EVENT_VERSION}:lead.updated`,
  TASK_UPDATED: `${EVENT_VERSION}:task.updated`,
  NOTIFICATION_CREATED: `${EVENT_VERSION}:notification.created`,
} as const;

/**
 * URL del canal. La API vive bajo `/api`; el namespace de socket.io cuelga de
 * la raíz del mismo host, así que se recorta el sufijo.
 */
export function realtimeUrl(
  apiUrl: string | undefined = process.env.NEXT_PUBLIC_API_URL,
): string | null {
  if (!apiUrl) return null;
  return apiUrl.replace(/\/api\/?$/, "");
}

let socket: Socket | null = null;

/**
 * Devuelve el socket compartido de la pestaña, creándolo si hace falta.
 *
 * EL TOKEN VA EN `auth`, NUNCA EN LA URL: así no acaba en logs de proxy ni en
 * el historial del navegador. Se lee en cada intento de conexión —no se
 * captura una vez— para que tras un refresco de sesión la reconexión use el
 * token nuevo y no uno ya caducado.
 *
 * Devuelve `null` si aún no hay sesión: sin token no se abre canal, y el
 * polling de React Query sigue cubriendo la actualización.
 */
export function getRealtimeSocket(): Socket | null {
  if (typeof window === "undefined") return null;

  const url = realtimeUrl();
  if (!url) return null;
  if (!getAccessToken()) return null;

  if (!socket) {
    socket = io(`${url}/realtime`, {
      // WebSocket directo: el polling de socket.io no aporta nada aquí y
      // multiplica las peticiones al backend.
      transports: ["websocket"],
      withCredentials: true,
      // Reconexión con espera creciente y algo de aleatoriedad, para que mil
      // pestañas no vuelvan todas a la vez tras un despliegue.
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 15_000,
      randomizationFactor: 0.5,
      auth: (cb) => cb({ token: getAccessToken() }),
    });
  }

  return socket;
}

/** Cierra el canal. Se llama al salir de la sesión. */
export function closeRealtimeSocket(): void {
  socket?.close();
  socket = null;
}
