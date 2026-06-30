'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login } from '@/lib/auth';
import { useAuthStore } from '@/store/auth.store';

export default function LoginPage() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { token, user } = await login(email, password);
      setSession(user, token);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Credenciales inválidas');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
            Tehus Rattan
          </h1>
          <p className="mt-1 text-sm text-stone-500">CRM interno</p>
        </div>

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

          {error && (
            <p className="mb-4 text-sm text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-stone-900 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:opacity-50"
          >
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}