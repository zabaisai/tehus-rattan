'use client';

import { useState } from 'react';
import Link from 'next/link';
import { forgotPassword } from '@/lib/auth';
import { TaktoLogo } from '@/components/ui/TaktoLogo';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';

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
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm">
        {/* Recuperar el acceso sigue siendo la puerta del producto, así que
            aquí manda TAKTO igual que en el login. Antes esta pantalla no
            llevaba logotipo y se veía como de otro sitio. */}
        <div className="mb-8 flex flex-col items-center text-center">
          <TaktoLogo height={30} />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-content-primary">
            Recuperar contraseña
          </h1>
          <p className="mt-1 text-sm text-content-secondary">
            Te enviaremos un enlace para restablecerla.
          </p>
        </div>

        {sent ? (
          <Card>
            <p
              role="status"
              aria-live="polite"
              className="text-sm leading-relaxed text-neutral-700"
            >
              {GENERIC_MESSAGE}
            </p>
            <Link
              href="/login"
              className="mt-6 inline-block rounded text-sm text-content-secondary outline-none transition-colors hover:text-content-primary focus-visible:ring-2 focus-visible:ring-line-focus focus-visible:ring-offset-1"
            >
              Volver a iniciar sesión
            </Link>
          </Card>
        ) : (
          <Card>
            <form onSubmit={handleSubmit}>
              <Field label="Correo" required className="mb-5">
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@correo.com"
                />
              </Field>

              <Button type="submit" disabled={loading} className="w-full py-2">
                {loading ? 'Enviando...' : 'Enviar instrucciones'}
              </Button>

              <Link
                href="/login"
                className="mt-4 block rounded text-center text-sm text-content-secondary outline-none transition-colors hover:text-content-primary focus-visible:ring-2 focus-visible:ring-line-focus focus-visible:ring-offset-1"
              >
                Volver a iniciar sesión
              </Link>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
