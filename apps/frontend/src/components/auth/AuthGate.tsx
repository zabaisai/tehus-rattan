'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { ConnectionUnavailable } from './ConnectionUnavailable';

// Guards protected subtrees. Renders children ONLY once the session is
// confirmed authenticated — while "bootstrapping" it shows a neutral loader,
// when "anonymous" it redirects to /login, and when "unavailable" (bootstrap
// could not reach the server) it shows a retry screen instead of the login
// form. Private content never flashes before auth is known and there is no
// login↔dashboard redirect loop. Real authorization is still enforced by the
// backend on every request.
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    if (status === 'anonymous') {
      router.replace('/login');
    }
  }, [status, router]);

  // A transient bootstrap failure must not look like an expired session: keep
  // private content hidden, but offer a retry rather than bouncing to /login.
  if (status === 'unavailable') {
    return <ConnectionUnavailable />;
  }

  if (status !== 'authenticated') {
    return (
      // `h-dvh` para que el cargador ocupe exactamente lo mismo que el shell
      // que va a sustituirlo: con `100vh` el paso de «Cargando…» al dashboard
      // cambiaba de alto en los navegadores con barra dinámica.
      <div className="flex h-dvh items-center justify-center bg-neutral-50">
        <p className="text-sm text-neutral-500">Cargando...</p>
      </div>
    );
  }

  return <>{children}</>;
}
