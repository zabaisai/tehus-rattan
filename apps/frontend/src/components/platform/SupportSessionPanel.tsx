'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { endSupportSession, getSupportSessionConversations } from '@/lib/platform';
import { PlatformSupportSession, SupportSessionStatus } from '@/types';
import { SupportConversationDetailModal } from './SupportConversationDetailModal';

type ApiError = {
  response?: {
    status?: number;
    data?: {
      message?: string | string[];
    };
  };
};

function extractErrorMessage(err: unknown, fallback: string): string {
  const response = (err as ApiError).response;
  if (response?.status === 403) return 'No tienes permiso para esta acción.';
  const message = response?.data?.message;
  return (Array.isArray(message) ? message[0] : message) || fallback;
}

const statusLabels: Record<SupportSessionStatus, string> = {
  ACTIVE: 'Activa',
  ENDED: 'Cerrada',
  EXPIRED: 'Expirada',
};

const statusColors: Record<SupportSessionStatus, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  ENDED: 'bg-stone-100 text-stone-600',
  EXPIRED: 'bg-amber-50 text-amber-700',
};

const CONVERSATIONS_LIMIT = 20;

function formatDate(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('es-CO');
}

function minutesUntil(value: string) {
  const diffMs = new Date(value).getTime() - Date.now();
  return Math.max(0, Math.round(diffMs / 60000));
}

interface SupportSessionPanelProps {
  session: PlatformSupportSession;
  onEnded: (session: PlatformSupportSession) => void;
}

export function SupportSessionPanel({
  session,
  onEnded,
}: SupportSessionPanelProps) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState('');
  const [openConversationId, setOpenConversationId] = useState<string | null>(
    null,
  );

  const isActive = session.status === 'ACTIVE';

  const {
    data: conversations,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['platform-support-session-conversations', session.id, page],
    queryFn: () =>
      getSupportSessionConversations(session.id, {
        page,
        limit: CONVERSATIONS_LIMIT,
      }),
    enabled: isActive,
  });

  async function handleEnd() {
    setEndError('');
    setEnding(true);
    try {
      const ended = await endSupportSession(session.id);
      onEnded(ended);
      queryClient.invalidateQueries({ queryKey: ['platform-audit-logs'] });
      queryClient.invalidateQueries({
        queryKey: ['platform-support-sessions-active', session.companyId],
      });
    } catch (err) {
      setEndError(extractErrorMessage(err, 'No se pudo cerrar la sesión'));
    } finally {
      setEnding(false);
    }
  }

  return (
    <div className="border-t border-stone-100 pt-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold text-stone-500">
          Sesión de soporte
        </p>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[session.status]}`}
        >
          {statusLabels[session.status]}
        </span>
      </div>

      <div className="rounded-md border border-stone-100 p-3 text-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs text-stone-500">Empresa</p>
            <p className="text-stone-800">{session.company.name}</p>
          </div>
          <div>
            <p className="text-xs text-stone-500">
              {isActive ? 'Expira en' : 'Expiraba'}
            </p>
            <p className="text-stone-800">
              {isActive
                ? `${minutesUntil(session.expiresAt)} min (${formatDate(session.expiresAt)})`
                : formatDate(session.expiresAt)}
            </p>
          </div>
        </div>
        <div className="mt-3">
          <p className="text-xs text-stone-500">Motivo</p>
          <p className="whitespace-pre-wrap text-stone-800">{session.reason}</p>
        </div>

        {isActive && (
          <div className="mt-3 flex items-center justify-between">
            {endError && <p className="text-xs text-red-600">{endError}</p>}
            <button
              type="button"
              disabled={ending}
              onClick={handleEnd}
              className="ml-auto rounded-md border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {ending ? 'Cerrando...' : 'Cerrar sesión de soporte'}
            </button>
          </div>
        )}

        {!isActive && (
          <p className="mt-3 text-xs text-stone-400">
            Esta sesión ya no está activa. Inicia una nueva para ver
            conversaciones.
          </p>
        )}
      </div>

      {isActive && (
        <div className="mt-3">
          <p className="mb-2 text-xs font-semibold text-stone-500">
            Conversaciones (vista superficial, sin mensajes)
          </p>

          {isLoading && (
            <p className="text-xs text-stone-400">Cargando conversaciones...</p>
          )}

          {!isLoading && isError && (
            <p className="text-xs text-red-600">
              No se pudieron cargar las conversaciones.
            </p>
          )}

          {!isLoading && !isError && (conversations?.length ?? 0) === 0 && (
            <p className="text-xs text-stone-400">Sin conversaciones.</p>
          )}

          {!isLoading && !isError && (conversations?.length ?? 0) > 0 && (
            <ul className="space-y-2">
              {conversations!.map((conversation) => (
                <li
                  key={conversation.id}
                  className="rounded-md border border-stone-100 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-stone-800">
                      {conversation.contact?.name ?? 'Contacto sin nombre'}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                        {conversation.status}
                      </span>
                      <button
                        type="button"
                        onClick={() => setOpenConversationId(conversation.id)}
                        className="rounded-md border border-stone-200 px-2 py-1 text-xs text-stone-600 hover:bg-stone-100"
                      >
                        Ver mensajes
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-stone-500">
                    {conversation.channel} ·{' '}
                    {conversation.assignedUser?.name ?? 'Sin asignar'} ·{' '}
                    {formatDate(conversation.updatedAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex items-center justify-between text-xs">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md px-2 py-1 text-stone-600 hover:bg-stone-100 disabled:opacity-40"
            >
              Anterior
            </button>
            <span className="text-stone-400">Página {page}</span>
            <button
              type="button"
              disabled={(conversations?.length ?? 0) < CONVERSATIONS_LIMIT}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md px-2 py-1 text-stone-600 hover:bg-stone-100 disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}

      {openConversationId && (
        <SupportConversationDetailModal
          sessionId={session.id}
          conversationId={openConversationId}
          onClose={() => setOpenConversationId(null)}
        />
      )}
    </div>
  );
}
