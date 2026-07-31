'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check } from 'lucide-react';
import {
  getNotifications,
  getUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from '@/lib/notifications';
import { CategoryIcon, relativeTime } from './notification-ui';

const UNREAD_POLL_MS = 30_000;

export function NotificationBell() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: unread = 0 } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: getUnreadCount,
    refetchInterval: UNREAD_POLL_MS,
    refetchOnWindowFocus: true,
  });

  const { data: page, isLoading } = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: () => getNotifications({ limit: 8 }),
    enabled: open,
    refetchOnWindowFocus: true,
  });

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  const openItem = async (n: AppNotification) => {
    if (!n.readAt) {
      await markNotificationRead(n.id).catch(() => undefined);
      invalidate();
    }
    setOpen(false);
    if (n.actionUrl && n.actionUrl.startsWith('/')) router.push(n.actionUrl);
  };

  const markAll = async () => {
    await markAllNotificationsRead().catch(() => undefined);
    invalidate();
  };

  const badge = unread > 99 ? '99+' : String(unread);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          unread > 0 ? `Notificaciones, ${unread} sin leer` : 'Notificaciones'
        }
        aria-haspopup="true"
        aria-expanded={open}
        className="relative rounded-md p-2 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
      >
        <Bell size={19} aria-hidden />
        {unread > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold leading-4 text-white"
            aria-hidden
          >
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Notificaciones"
          className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2">
            <span className="text-sm font-semibold text-neutral-800">
              Notificaciones
            </span>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAll}
                className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800"
              >
                <Check size={13} aria-hidden /> Marcar todas
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <p className="px-3 py-6 text-center text-sm text-neutral-400">
                Cargando…
              </p>
            ) : !page || page.items.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-neutral-400">
                No tienes notificaciones.
              </p>
            ) : (
              <ul>
                {page.items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-neutral-50 ${n.readAt ? '' : 'bg-emerald-50/40'}`}
                    >
                      <span className="mt-0.5 text-neutral-400">
                        <CategoryIcon category={n.category} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-neutral-800">
                            {n.title}
                          </span>
                          {!n.readAt && (
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
                              aria-label="No leída"
                            />
                          )}
                        </span>
                        {n.bodyPreview && (
                          <span className="mt-0.5 block truncate text-xs text-neutral-500">
                            {n.bodyPreview}
                          </span>
                        )}
                        <span className="mt-0.5 block text-[11px] text-neutral-400">
                          {relativeTime(n.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-neutral-100 px-3 py-2 text-center">
            <Link
              href="/dashboard/notifications"
              onClick={() => setOpen(false)}
              className="text-sm text-neutral-600 hover:text-neutral-900"
            >
              Ver todas
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
