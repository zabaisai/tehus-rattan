'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { getMe } from '@/lib/auth';
import { useAuthStore } from '@/store/auth.store';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setSession = useAuthStore((s) => s.setSession);
  const clearSession = useAuthStore((s) => s.clearSession);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (user) {
      setChecking(false);
      return;
    }

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) {
      router.push('/login');
      return;
    }

    getMe()
      .then((freshUser) => {
        setSession(freshUser, token);
        setChecking(false);
      })
      .catch(() => {
        clearSession();
        router.push('/login');
      });
  }, [user, router, setSession, clearSession]);

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center bg-stone-50">
        <p className="text-sm text-stone-500">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-stone-50">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}