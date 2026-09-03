import { describe, expect, it, beforeEach } from 'vitest';
import { broadcastAuthEvent, subscribeAuthEvents } from './auth-events';

// Node/jsdom expose a global BroadcastChannel; two instances on the same name
// communicate within the test process (a channel never receives its own posts).
const hasBroadcastChannel = typeof BroadcastChannel !== 'undefined';

describe('cross-tab auth events', () => {
  let received: unknown[] = [];
  let unsubscribe: () => void = () => {};

  beforeEach(() => {
    received = [];
  });

  it.runIf(hasBroadcastChannel)(
    'delivers a logout event to another tab and carries no token',
    async () => {
      const raw: unknown[] = [];
      // Capture the raw message payload to prove it never contains a token.
      const spyChannel = new BroadcastChannel('takto-auth');
      spyChannel.addEventListener('message', (e: MessageEvent) => raw.push(e.data));

      unsubscribe = subscribeAuthEvents((type) => received.push(type));

      broadcastAuthEvent('logout');
      await new Promise((r) => setTimeout(r, 20));

      expect(received).toContain('logout');
      // The payload is exactly { type } — no token/credential of any kind.
      for (const payload of raw) {
        const keys = Object.keys(payload as object);
        expect(keys).toEqual(['type']);
        expect(JSON.stringify(payload)).not.toMatch(/token|jwt|bearer|password/i);
      }

      unsubscribe();
      spyChannel.close();
    },
  );

  it.runIf(hasBroadcastChannel)(
    'delivers session-invalidated events',
    async () => {
      unsubscribe = subscribeAuthEvents((type) => received.push(type));
      broadcastAuthEvent('session-invalidated');
      await new Promise((r) => setTimeout(r, 20));
      expect(received).toContain('session-invalidated');
      unsubscribe();
    },
  );

  it('subscribe is a safe no-op when BroadcastChannel is unavailable', () => {
    // subscribeAuthEvents must always return an unsubscribe function.
    const unsub = subscribeAuthEvents(() => {});
    expect(typeof unsub).toBe('function');
    unsub();
  });
  // Fase 1: el canal pasa de 'tehus-auth' a 'takto-auth'. Una pestaña con el
  // bundle anterior sigue emitiendo en el nombre antiguo durante el despliegue.
  it.runIf(hasBroadcastChannel)(
    'sigue recibiendo eventos emitidos en el canal legacy tehus-auth, pero nunca emite en él',
    async () => {
      const legacySpy: unknown[] = [];
      const legacy = new BroadcastChannel('tehus-auth');
      legacy.addEventListener('message', (e: MessageEvent) => legacySpy.push(e.data));
      unsubscribe = subscribeAuthEvents((type) => received.push(type));

      broadcastAuthEvent('logout');
      await new Promise((r) => setTimeout(r, 20));
      expect(legacySpy).toEqual([]);

      const oldTab = new BroadcastChannel('tehus-auth');
      oldTab.postMessage({ type: 'session-invalidated' });
      await new Promise((r) => setTimeout(r, 20));
      expect(received).toContain('session-invalidated');

      unsubscribe();
      legacy.close();
      oldTab.close();
    },
  );
});
