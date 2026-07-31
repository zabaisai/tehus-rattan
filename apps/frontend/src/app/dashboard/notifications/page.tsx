'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useInfiniteQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  CATEGORY_LABELS,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
  type NotificationCategory,
} from '@/lib/notifications';
import { CategoryIcon, relativeTime } from '@/components/notifications/notification-ui';
import { useRealtime } from '@/lib/use-realtime';

type Filter = 'all' | 'unread';

export default function NotificationsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  // La campana se actualiza sola en cuanto entra un aviso.
  useRealtime();
  const [category, setCategory] = useState<NotificationCategory | ''>('');

  const query = useInfiniteQuery({
    queryKey: ['notifications', 'list', filter, category],
    queryFn: ({ pageParam }) =>
      getNotifications({
        unread: filter === 'unread',
        category: category || undefined,
        cursor: pageParam,
        limit: 20,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['notifications'] });

  const open = async (n: AppNotification) => {
    if (!n.readAt) {
      await markNotificationRead(n.id).catch(() => undefined);
      invalidate();
    }
    if (n.actionUrl && n.actionUrl.startsWith('/')) router.push(n.actionUrl);
  };

  const markAll = async () => {
    await markAllNotificationsRead().catch(() => undefined);
    invalidate();
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900">Notificaciones</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Tus alertas de conversaciones, tareas, WhatsApp y más.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/settings/notifications"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            Preferencias
          </Link>
          <button
            type="button"
            onClick={markAll}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            Marcar todas como leídas
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-neutral-200 p-0.5" role="tablist">
          {(['all', 'unread'] as Filter[]).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded px-3 py-1 text-sm ${filter === f ? 'bg-brand-primary text-white' : 'text-neutral-600 hover:bg-neutral-100'}`}
            >
              {f === 'all' ? 'Todas' : 'No leídas'}
            </button>
          ))}
        </div>
        <label htmlFor="notif-category" className="sr-only">
          Filtrar por categoría
        </label>
        <select
          id="notif-category"
          value={category}
          onChange={(e) => setCategory(e.target.value as NotificationCategory | '')}
          className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
        >
          <option value="">Todas las categorías</option>
          {(Object.keys(CATEGORY_LABELS) as NotificationCategory[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {query.isLoading ? (
          <p className="px-4 py-10 text-center text-sm text-neutral-400">Cargando…</p>
        ) : query.isError ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-red-600">No se pudieron cargar las notificaciones.</p>
            <button
              type="button"
              onClick={() => query.refetch()}
              className="mt-2 rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              Reintentar
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-neutral-400">
            No tienes notificaciones{filter === 'unread' ? ' sin leer' : ''}.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => open(n)}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-neutral-50 ${n.readAt ? '' : 'bg-emerald-50/40'}`}
                >
                  <span className="mt-0.5 text-neutral-400">
                    <CategoryIcon category={n.category} size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium text-neutral-800">{n.title}</span>
                      {!n.readAt && (
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-label="No leída" />
                      )}
                    </span>
                    {n.bodyPreview && (
                      <span className="mt-0.5 block text-sm text-neutral-500">{n.bodyPreview}</span>
                    )}
                    <span className="mt-0.5 block text-xs text-neutral-400">
                      {CATEGORY_LABELS[n.category]} · {relativeTime(n.createdAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {query.hasNextPage && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            {query.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
          </button>
        </div>
      )}
    </div>
  );
}
