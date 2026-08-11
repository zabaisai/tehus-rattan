'use client';

import { useState } from 'react';
import { retryBootstrap } from '@/lib/auth-bootstrap';
import { TaktoLogo } from '@/components/ui/TaktoLogo';
import { Button } from '@/components/ui/Button';

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
    <div className="flex h-screen items-center justify-center bg-neutral-50 px-4">
      {/* `role="status"` con `aria-live`: la pantalla sustituye a la que se
          esperaba, y sin esto un lector de pantalla no anuncia el cambio. */}
      <div
        role="status"
        aria-live="polite"
        className="flex w-full max-w-sm flex-col items-center text-center"
      >
        {/* Con el servidor caído esto es lo único que se ve del producto. Sin
            logotipo parecía una página de error de cualquier sitio. */}
        <TaktoLogo height={28} />
        <h1 className="mt-5 text-lg font-semibold text-content-primary">
          No pudimos conectar con el servidor
        </h1>
        <p className="mt-2 text-sm text-content-secondary">
          Tu sesión sigue activa. Es un problema temporal de conexión — no
          necesitas volver a iniciar sesión.
        </p>
        <Button onClick={handleRetry} disabled={retrying} className="mt-6 px-4">
          {retrying ? 'Reintentando...' : 'Reintentar'}
        </Button>
      </div>
    </div>
  );
}
