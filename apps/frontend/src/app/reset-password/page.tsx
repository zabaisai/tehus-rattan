import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ResetPasswordForm } from './ResetPasswordForm';

// noindex — recovery pages must never be indexed by search engines.
export const metadata: Metadata = {
  title: 'Restablecer contraseña',
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-neutral-50">
          <p className="text-sm text-neutral-500">Cargando...</p>
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
