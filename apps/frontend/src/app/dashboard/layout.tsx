'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
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
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const setSession = useAuthStore((s) => s.setSession);
  const clearSession = useAuthStore((s) => s.clearSession);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const isPlatformSuperAdmin =
    user?.role === 'SUPER_ADMIN' && user?.companyId === null;
  const isOnPlatformRoute = pathname.startsWith('/dashboard/platform');

  useEffect(() => {
    if (user) return;

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) {
      router.push('/login');
      return;
    }

    getMe()
      .then((freshUser) => {
        setSession(freshUser, token);
      })
      .catch(() => {
        clearSession();
        router.push('/login');
      });
  }, [user, router, setSession, clearSession]);

  useEffect(() => {
    // A global SUPER_ADMIN has no companyId, so every normal CRM page
    // (dashboard home, contacts, leads, tasks, ...) fires business queries
    // that assume a real company and 500 silently. Keep them confined to
    // /dashboard/platform/* instead of letting those pages ever mount.
    if (isPlatformSuperAdmin && !isOnPlatformRoute) {
      router.replace('/dashboard/platform/companies');
    }
  }, [isPlatformSuperAdmin, isOnPlatformRoute, router]);

  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-stone-50">
        <p className="text-sm text-stone-500">Cargando...</p>
      </div>
    );
  }

  if (isPlatformSuperAdmin && !isOnPlatformRoute) {
    return (
      <div className="flex h-screen items-center justify-center bg-stone-50">
        <p className="text-sm text-stone-500">Redirigiendo...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-stone-50">
      <Sidebar mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onMenuClick={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}