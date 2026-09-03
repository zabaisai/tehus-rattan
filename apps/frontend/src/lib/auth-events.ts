// Cross-tab auth signaling over BroadcastChannel. Only carries small,
// non-sensitive EVENT TYPES — never an access token, refresh token, or any
// credential. Other tabs react by clearing their own in-memory session and
// re-bootstrapping; each tab always re-derives its own token via /auth/refresh.
//
// Degrades to a no-op when BroadcastChannel is unavailable (SSR, older
// browsers); the app stays correct, it just loses the cross-tab convenience.

export type AuthEventType = 'logout' | 'session-invalidated';

// Canal canónico (TAKTO). El nombre antiguo se sigue ESCUCHANDO durante la
// transición para que una pestaña con el bundle anterior (abierta antes del
// despliegue) siga enterándose de un cierre de sesión; nunca se emite en él.
// Retiro: en el despliegue siguiente al de la Fase 1 (ver
// docs/phase-1/IDENTITY-CONTRACT.md § Retiro del fallback).
export const AUTH_CHANNEL_NAME = 'takto-auth';
export const LEGACY_AUTH_CHANNEL_NAME = 'tehus-auth';

function openChannel(name: string): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }
  return new BroadcastChannel(name);
}

// Fire-and-forget; opens and closes a short-lived channel so we never hold a
// listener that could double-handle our own message.
export function broadcastAuthEvent(type: AuthEventType): void {
  const channel = openChannel(AUTH_CHANNEL_NAME);
  if (!channel) return;
  try {
    channel.postMessage({ type });
  } finally {
    channel.close();
  }
}

// Subscribe to events from OTHER tabs. Returns an unsubscribe function.
export function subscribeAuthEvents(
  handler: (type: AuthEventType) => void,
): () => void {
  const channels = [
    openChannel(AUTH_CHANNEL_NAME),
    openChannel(LEGACY_AUTH_CHANNEL_NAME),
  ].filter((c): c is BroadcastChannel => c !== null);
  if (channels.length === 0) return () => {};

  const listener = (event: MessageEvent) => {
    const type = event.data?.type;
    if (type === 'logout' || type === 'session-invalidated') {
      handler(type);
    }
  };
  for (const channel of channels) channel.addEventListener('message', listener);

  return () => {
    for (const channel of channels) {
      channel.removeEventListener('message', listener);
      channel.close();
    }
  };
}
