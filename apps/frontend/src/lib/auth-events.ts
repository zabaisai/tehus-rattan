// Cross-tab auth signaling over BroadcastChannel. Only carries small,
// non-sensitive EVENT TYPES — never an access token, refresh token, or any
// credential. Other tabs react by clearing their own in-memory session and
// re-bootstrapping; each tab always re-derives its own token via /auth/refresh.
//
// Degrades to a no-op when BroadcastChannel is unavailable (SSR, older
// browsers); the app stays correct, it just loses the cross-tab convenience.

export type AuthEventType = 'logout' | 'session-invalidated';

const CHANNEL_NAME = 'tehus-auth';

function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }
  return new BroadcastChannel(CHANNEL_NAME);
}

// Fire-and-forget; opens and closes a short-lived channel so we never hold a
// listener that could double-handle our own message.
export function broadcastAuthEvent(type: AuthEventType): void {
  const channel = getChannel();
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
  const channel = getChannel();
  if (!channel) return () => {};

  const listener = (event: MessageEvent) => {
    const type = event.data?.type;
    if (type === 'logout' || type === 'session-invalidated') {
      handler(type);
    }
  };
  channel.addEventListener('message', listener);

  return () => {
    channel.removeEventListener('message', listener);
    channel.close();
  };
}
