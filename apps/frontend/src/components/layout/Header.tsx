'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { logout } from '@/lib/auth';

export function Header() {
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
    <header className="flex h-14 items-center justify-between border-b border-stone-200 bg-white px-6">
      <div />
      <div className="flex items-center gap-3">
        <span className="text-sm text-stone-700">{user?.name ?? '...'}</span>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
        >
          <LogOut size={15} />
          Salir
        </button>
      </div>
    </header>
  );
}