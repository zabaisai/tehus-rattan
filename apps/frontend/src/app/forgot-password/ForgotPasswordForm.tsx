'use client';

import { useState } from 'react';
import Link from 'next/link';
import { forgotPassword } from '@/lib/auth';

// Always shows the SAME generic message after submitting — success OR error — so
// the page never confirms whether an account exists.
const GENERIC_MESSAGE =
  'Si existe una cuenta asociada a este correo, recibirás las instrucciones para restablecer tu contraseña.';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    // The message is identical regardless of outcome, so a failure is caught and
    // treated exactly like success (anti-enumeration). Resolve to a boolean so no
    // rejection can escape the handler.
    await forgotPassword(email).catch(() => undefined);
    setSent(true);
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
            Recuperar contraseña
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            Te enviaremos un enlace para restablecerla.
          </p>
        </div>

        {sent ? (
          <div className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
            <p
              role="status"
              aria-live="polite"
              className="text-sm leading-relaxed text-stone-700"
            >
              {GENERIC_MESSAGE}
            </p>
            <Link
              href="/login"
              className="mt-6 inline-block text-sm text-stone-500 transition-colors hover:text-stone-700"
            >
              Volver a iniciar sesión
            </Link>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm"
          >
            <div className="mb-5">
              <label
                htmlFor="email"
                className="mb-1.5 block text-sm font-medium text-stone-700"
              >
                Correo
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
                placeholder="tu@correo.com"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-brand-primary py-2 text-sm font-medium text-white transition-colors hover:bg-primary-900 disabled:opacity-50"
            >
              {loading ? 'Enviando...' : 'Enviar instrucciones'}
            </button>

            <Link
              href="/login"
              className="mt-4 block text-center text-sm text-stone-500 transition-colors hover:text-stone-700"
            >
              Volver a iniciar sesión
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
