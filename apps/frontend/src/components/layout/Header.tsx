'use client';

import { useRouter } from 'next/navigation';
import { LogOut, Menu } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { logout } from '@/lib/auth';

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const clearSession = useAuthStore((s) => s.clearSession);

  async function handleLogout() {
    // Best-effort: local session state clears and the user is sent to
    // /login either way, even if this request fails (offline, expired
    // cookie, etc.) — logout must never get "stuck" waiting on the network.
    try {
      await logout();
    } catch {
      // ignored — see comment above
    }
    clearSession();
    router.push('/login');
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-stone-200 bg-white px-3 sm:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Abrir menú de navegación"
        className="rounded-md p-2 text-stone-600 hover:bg-stone-100 lg:hidden"
      >
        <Menu size={20} />
      </button>

      <div className="flex items-center gap-2 sm:gap-3">
        <span className="hidden text-sm text-stone-700 sm:inline">{user?.name ?? '...'}</span>
        <button
          onClick={handleLogout}
          aria-label="Cerrar sesión"
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
        >
          <LogOut size={15} />
          <span className="hidden sm:inline">Salir</span>
        </button>
      </div>
    </header>
  );
}
