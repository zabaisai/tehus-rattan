'use client';

import { useState } from 'react';
import { retryBootstrap } from '@/lib/auth-bootstrap';

// Shown when the initial session bootstrap could not reach the server
// (429 / network / timeout / 5xx). The session may still be valid, so this is
// deliberately NOT the login form: it keeps private content hidden and offers a
// manual retry that re-runs the bootstrap. There is no automatic retry loop —
// the user decides when to try again.
export function ConnectionUnavailable() {
  const [retrying, setRetrying] = useState(false);

  async function handleRetry() {
    setRetrying(true);
    try {
      await retryBootstrap();
    } finally {
      // If the retry resolved to authenticated/anonymous, this component
      // unmounts; if it is still unavailable, re-enable the button.
      setRetrying(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-lg font-semibold text-stone-900">
          No pudimos conectar con el servidor
        </h1>
        <p className="mt-2 text-sm text-stone-500">
          Tu sesión sigue activa. Es un problema temporal de conexión — no
          necesitas volver a iniciar sesión.
        </p>
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          className="mt-6 rounded-md bg-brand-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-900 disabled:opacity-50"
        >
          {retrying ? 'Reintentando...' : 'Reintentar'}
        </button>
      </div>
    </div>
  );
}
