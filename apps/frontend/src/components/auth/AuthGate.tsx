'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';

// Guards protected subtrees. Renders children ONLY once the session is
// confirmed authenticated — while "bootstrapping" or "anonymous" it shows a
// neutral loader, so private content never flashes before auth is known and
// there is no login↔dashboard redirect loop. Real authorization is still
// enforced by the backend on every request.
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    if (status === 'anonymous') {
      router.replace('/login');
    }
  }, [status, router]);

  if (status !== 'authenticated') {
    return (
      <div className="flex h-screen items-center justify-center bg-stone-50">
        <p className="text-sm text-stone-500">Cargando...</p>
      </div>
    );
  }

  return <>{children}</>;
}
