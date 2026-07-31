'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { AuthGate } from '@/components/auth/AuthGate';
import { useAuthStore } from '@/store/auth.store';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // AuthGate waits for the client-side bootstrap: it only renders the shell
  // once the session is confirmed authenticated (otherwise a loader, or a
  // redirect to /login for anonymous). No token is read from storage here.
  return (
    <AuthGate>
      <DashboardShell>{children}</DashboardShell>
    </AuthGate>
  );
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const isPlatformSuperAdmin =
    user?.role === 'SUPER_ADMIN' && user?.companyId === null;
  const isOnPlatformRoute = pathname.startsWith('/dashboard/platform');

  useEffect(() => {
    // A global SUPER_ADMIN has no companyId, so every normal CRM page fires
    // business queries that assume a real company and 500 silently. Keep them
    // confined to /dashboard/platform/* instead of letting those pages mount.
    if (isPlatformSuperAdmin && !isOnPlatformRoute) {
      router.replace('/dashboard/platform/companies');
    }
  }, [isPlatformSuperAdmin, isOnPlatformRoute, router]);

  if (isPlatformSuperAdmin && !isOnPlatformRoute) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-50">
        <p className="text-sm text-neutral-500">Redirigiendo...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-neutral-50">
      <Sidebar mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onMenuClick={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
