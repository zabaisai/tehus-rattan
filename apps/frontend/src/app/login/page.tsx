'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { login, getMe } from '@/lib/auth';
import { useAuthStore } from '@/store/auth.store';
import { ConnectionUnavailable } from '@/components/auth/ConnectionUnavailable';
import { TaktoLogo } from '@/components/ui/TaktoLogo';

type ApiError = {
  response?: {
    data?: {
      message?: string;
    };
  };
};

export default function LoginPage() {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const setSession = useAuthStore((s) => s.setSession);
  const setUser = useAuthStore((s) => s.setUser);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetNotice, setResetNotice] = useState('');

  // Already logged in (e.g. bootstrap found a live session, or another tab) —
  // don't show the login form, go to the app.
  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/dashboard');
    }
  }, [status, router]);

  // Show the success banner after a password reset (reset page redirects here
  // with ?reset=1), then strip the query so a refresh doesn't keep showing it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('reset') === '1') {
      // Client-only read (window) — must run after mount to avoid a hydration
      // mismatch, so the setState here is intentional.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResetNotice('Contraseña actualizada correctamente. Ya puedes iniciar sesión.');
      window.history.replaceState(null, '', '/login');
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { token, user } = await login(email, password);
      // The login response only carries id/email/name. role and companyId
      // (needed right away for role-gated nav like the platform section) only
      // come from /auth/me, so fetch the full profile before navigating. The
      // token is stored ONLY in memory (setSession → lib/auth-token.ts).
      setSession(user, token);
      const fullUser = await getMe();
      setUser(fullUser);

      // A global SUPER_ADMIN (companyId null) has no company to scope the
      // normal CRM dashboard to — every business query on it expects a real
      // companyId and 500s. Send them straight to the platform area.
      const isPlatformSuperAdmin =
        fullUser.role === 'SUPER_ADMIN' && fullUser.companyId === null;
      router.push(
        isPlatformSuperAdmin ? '/dashboard/platform/companies' : '/dashboard',
      );
    } catch (err) {
      const response = (err as ApiError).response;
      setError(response?.data?.message || 'Credenciales inválidas');
    } finally {
      setLoading(false);
    }
  }

  // The server was unreachable during bootstrap (429 / network / 5xx): show the
  // retry screen, not a form that implies the session expired.
  if (status === 'unavailable') {
    return <ConnectionUnavailable />;
  }

  // While the initial bootstrap runs, or when already authenticated (redirect
  // pending), don't flash the login form.
  if (status !== 'anonymous') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50">
        <p className="text-sm text-stone-500">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          {/* Puerta de entrada del producto: aquí la marca es TAKTO. La
              identidad de cada empresa cliente aparece despues, dentro de su
              propio espacio, y las dos nunca se mezclan. */}
          <h1 className="sr-only">TAKTO</h1>
          <TaktoLogo height={34} />
          <p className="mt-2 text-sm text-neutral-500">
            CRM conversacional para vender por WhatsApp
          </p>
        </div>

        {resetNotice && (
          <p
            role="status"
            aria-live="polite"
            className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700"
          >
            {resetNotice}
          </p>
        )}

        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm"
        >
          <div className="mb-4">
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

          <div className="mb-5">
            <label
              htmlFor="password"
              className="mb-1.5 block text-sm font-medium text-stone-700"
            >
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
              placeholder="••••••••"
            />
          </div>

          <div className="mb-4 -mt-1 text-right">
            <Link
              href="/forgot-password"
              className="text-sm text-stone-500 transition-colors hover:text-stone-700"
            >
              ¿Olvidaste tu contraseña?
            </Link>
          </div>

          {error && (
            <p role="alert" aria-live="assertive" className="mb-4 text-sm text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-brand-primary py-2 text-sm font-medium text-white transition-colors hover:bg-primary-900 disabled:opacity-50"
          >
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}