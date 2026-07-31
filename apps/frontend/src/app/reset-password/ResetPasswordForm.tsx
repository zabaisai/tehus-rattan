'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { resetPassword } from '@/lib/auth';
import { isStrongPassword } from '@/lib/password-policy';
import { PasswordRequirements } from '@/components/auth/PasswordRequirements';

type ApiError = { response?: { data?: { message?: string | string[] } } };

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Capture the token into memory ONCE (lazy initializer, so it survives even
  // after we strip it from the URL). Never written to localStorage/sessionStorage.
  // The Suspense boundary means this first render happens client-side with the
  // real query, so the token is never placed in server-rendered HTML.
  const [token] = useState<string | null>(() => searchParams.get('token'));
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Side effect only (no setState): strip the token from the URL so it never
  // lingers in the address bar, browser history, logs, or analytics.
  useEffect(() => {
    if (token && typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/reset-password');
    }
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    if (!isStrongPassword(password)) {
      setError('La contraseña no cumple los requisitos indicados.');
      return;
    }
    setLoading(true);
    try {
      await resetPassword(token!, password, confirm);
      setPassword('');
      setConfirm('');
      router.push('/login?reset=1');
    } catch (err) {
      const message = (err as ApiError).response?.data?.message;
      setError(
        typeof message === 'string'
          ? message
          : 'No se pudo restablecer la contraseña. El enlace puede ser inválido o haber expirado.',
      );
      setLoading(false);
    }
  }

  const inputClass =
    'w-full rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500';

  // No token in the URL at all → the link is malformed/incomplete.
  if (!token) {
    return (
      <Shell title="Enlace inválido">
        <div className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
          <p role="alert" className="text-sm leading-relaxed text-stone-700">
            El enlace de recuperación es inválido o está incompleto.
          </p>
          <Link
            href="/forgot-password"
            className="mt-6 inline-block text-sm text-stone-500 transition-colors hover:text-stone-700"
          >
            Solicitar un nuevo enlace
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title="Restablecer contraseña">
      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm"
      >
        <div className="mb-4">
          <label
            htmlFor="password"
            className="mb-1.5 block text-sm font-medium text-stone-700"
          >
            Nueva contraseña
          </label>
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby="password-requirements"
            className={inputClass}
            placeholder="••••••••"
          />
          <div id="password-requirements">
            <PasswordRequirements password={password} />
          </div>
        </div>

        <div className="mb-3">
          <label
            htmlFor="confirm"
            className="mb-1.5 block text-sm font-medium text-stone-700"
          >
            Confirmar contraseña
          </label>
          <input
            id="confirm"
            type={showPassword ? 'text' : 'password'}
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputClass}
            placeholder="••••••••"
          />
        </div>

        <label className="mb-5 flex items-center gap-2 text-sm text-stone-600">
          <input
            type="checkbox"
            checked={showPassword}
            onChange={(e) => setShowPassword(e.target.checked)}
            className="h-4 w-4 rounded border-stone-300"
          />
          Mostrar contraseña
        </label>

        {error && (
          <p role="alert" aria-live="assertive" className="mb-4 text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-brand-primary py-2 text-sm font-medium text-white transition-colors hover:bg-primary-900 disabled:opacity-50"
        >
          {loading ? 'Guardando...' : 'Cambiar contraseña'}
        </button>

        <Link
          href="/forgot-password"
          className="mt-4 block text-center text-sm text-stone-500 transition-colors hover:text-stone-700"
        >
          Solicitar un nuevo enlace
        </Link>
      </form>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
            {title}
          </h1>
        </div>
        {children}
      </div>
    </div>
  );
}
