'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut, Menu, Search } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { logout } from '@/lib/auth';
import { broadcastAuthEvent } from '@/lib/auth-events';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { PaletaDeBusqueda } from '@/components/busqueda/PaletaDeBusqueda';

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const clearSession = useAuthStore((s) => s.clearSession);
  const [paletaAbierta, setPaletaAbierta] = useState(false);

  // Ctrl/⌘+K desde cualquier pantalla. Se escucha en `document` y en captura
  // para que funcione aunque el foco esté dentro de un campo de texto: si no,
  // el atajo dejaría de responder justo cuando el usuario está escribiendo.
  useEffect(() => {
    function alPulsar(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletaAbierta(true);
      }
    }
    document.addEventListener('keydown', alPulsar, true);
    return () => document.removeEventListener('keydown', alPulsar, true);
  }, []);

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
    // Drop all cached queries (notifications, etc.) so nothing leaks into the
    // next session in this tab.
    queryClient.clear();
    // Tell other tabs of this browser to drop the (now closed) session too.
    broadcastAuthEvent('logout');
    router.push('/login');
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-3 sm:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Abrir menú de navegación"
        className="rounded-md p-2 text-neutral-600 hover:bg-neutral-100 lg:hidden"
      >
        <Menu size={20} />
      </button>

      {/* El disparador es un botón de verdad, no un adorno: quien no conoce el
          atajo tiene que poder abrir la búsqueda con el ratón. */}
      <button
        type="button"
        onClick={() => setPaletaAbierta(true)}
        className="ml-2 flex min-w-0 flex-1 items-center gap-2 rounded-md border border-neutral-300 px-3 py-1.5 text-left text-sm text-content-secondary outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-line-focus lg:ml-0 lg:max-w-sm"
      >
        <Search size={15} aria-hidden="true" className="shrink-0" />
        <span className="truncate">Buscar…</span>
        <kbd className="ml-auto hidden shrink-0 rounded border border-neutral-300 px-1.5 py-0.5 font-mono text-[10px] text-content-secondary sm:inline">
          Ctrl K
        </kbd>
      </button>

      <div className="flex items-center gap-2 sm:gap-3">
        <NotificationBell />
        <span className="hidden text-sm text-neutral-700 sm:inline">{user?.name ?? '...'}</span>
        <button
          onClick={handleLogout}
          aria-label="Cerrar sesión"
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
        >
          <LogOut size={15} />
          <span className="hidden sm:inline">Salir</span>
        </button>
      </div>

      {paletaAbierta && (
        <PaletaDeBusqueda onCerrar={() => setPaletaAbierta(false)} />
      )}
    </header>
  );
}
