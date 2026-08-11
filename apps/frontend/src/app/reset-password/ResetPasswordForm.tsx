'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { resetPassword } from '@/lib/auth';
import { isStrongPassword } from '@/lib/password-policy';
import { PasswordRequirements } from '@/components/auth/PasswordRequirements';
import { TaktoLogo } from '@/components/ui/TaktoLogo';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';

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

  // No token in the URL at all → the link is malformed/incomplete.
  if (!token) {
    return (
      <Shell title="Enlace inválido">
        <Card>
          <p role="alert" className="text-sm leading-relaxed text-neutral-700">
            El enlace de recuperación es inválido o está incompleto.
          </p>
          <Link href="/forgot-password" className={ENLACE}>
            Solicitar un nuevo enlace
          </Link>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell title="Restablecer contraseña">
      <Card>
        <form onSubmit={handleSubmit}>
          <Field label="Nueva contraseña" required className="mb-4">
            <Input
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              // Explícito: gana al `aria-describedby` que genera `Field`, y es
              // el que apunta a la lista de requisitos, que es lo que hay que
              // oír al entrar en el campo.
              aria-describedby="password-requirements"
              placeholder="••••••••"
            />
            <div id="password-requirements">
              <PasswordRequirements password={password} />
            </div>
          </Field>

          <Field label="Confirmar contraseña" required className="mb-3">
            <Input
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
            />
          </Field>

          <label className="mb-5 flex items-center gap-2 text-sm text-content-secondary">
            <input
              type="checkbox"
              checked={showPassword}
              onChange={(e) => setShowPassword(e.target.checked)}
              className="h-4 w-4 rounded border-neutral-300 accent-brand-primary"
            />
            Mostrar contraseña
          </label>

          {error && (
            <p
              role="alert"
              aria-live="assertive"
              className="mb-4 text-sm text-status-error"
            >
              {error}
            </p>
          )}

          <Button type="submit" disabled={loading} className="w-full py-2">
            {loading ? 'Guardando...' : 'Cambiar contraseña'}
          </Button>

          <Link href="/forgot-password" className={`mt-4 block ${ENLACE}`}>
            Solicitar un nuevo enlace
          </Link>
        </form>
      </Card>
    </Shell>
  );
}

const ENLACE =
  'rounded text-center text-sm text-content-secondary outline-none transition-colors ' +
  'hover:text-content-primary focus-visible:ring-2 focus-visible:ring-line-focus focus-visible:ring-offset-1';

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm">
        {/* Restablecer también es la puerta del producto: manda TAKTO. */}
        <div className="mb-8 flex flex-col items-center text-center">
          <TaktoLogo height={30} />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-content-primary">
            {title}
          </h1>
        </div>
        {children}
      </div>
    </div>
  );
}
