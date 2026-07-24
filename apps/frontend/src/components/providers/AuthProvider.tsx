'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { bootstrapSession } from '@/lib/auth-bootstrap';
import { subscribeAuthEvents } from '@/lib/auth-events';
import { useAuthStore } from '@/store/auth.store';

// Runs the one-time session bootstrap on load and reacts to cross-tab auth
// events. Wraps the whole app so both public (/login) and protected views can
// read the resolved auth status.
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const clearSession = useAuthStore((s) => s.clearSession);

  useEffect(() => {
    void bootstrapSession();
  }, []);

  useEffect(() => {
    // Another tab logged out or had its session invalidated → this tab's
    // session is the same browser session, so drop it here too. Events never
    // carry tokens; each tab always re-derives its own via /auth/refresh.
    const unsubscribe = subscribeAuthEvents(() => {
      clearSession();
      if (
        typeof window !== 'undefined' &&
        window.location.pathname !== '/login'
      ) {
        router.push('/login');
      }
    });
    return unsubscribe;
  }, [clearSession, router]);

  return <>{children}</>;
}
