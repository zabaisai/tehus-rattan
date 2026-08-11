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
  ACTIVE: 'bg-status-success-surface text-status-success-strong',
  ENDED: 'bg-neutral-100 text-neutral-600',
  EXPIRED: 'bg-status-warning-surface text-status-warning-strong',
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
    <div className="border-t border-neutral-100 pt-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold text-neutral-500">
          Sesión de soporte
        </p>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[session.status]}`}
        >
          {statusLabels[session.status]}
        </span>
      </div>

      <div className="rounded-md border border-neutral-100 p-3 text-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs text-neutral-500">Empresa</p>
            <p className="text-neutral-800">{session.company.name}</p>
          </div>
          <div>
            <p className="text-xs text-neutral-500">
              {isActive ? 'Expira en' : 'Expiraba'}
            </p>
            <p className="text-neutral-800">
              {isActive
                ? `${minutesUntil(session.expiresAt)} min (${formatDate(session.expiresAt)})`
                : formatDate(session.expiresAt)}
            </p>
          </div>
        </div>
        <div className="mt-3">
          <p className="text-xs text-neutral-500">Motivo</p>
          <p className="whitespace-pre-wrap text-neutral-800">{session.reason}</p>
        </div>

        {isActive && (
          <div className="mt-3 flex items-center justify-between">
            {endError && <p className="text-xs text-status-error">{endError}</p>}
            <button
              type="button"
              disabled={ending}
              onClick={handleEnd}
              className="ml-auto rounded-md border border-status-error/20 px-3 py-1.5 text-xs text-status-error hover:bg-status-error-surface disabled:opacity-50"
            >
              {ending ? 'Cerrando...' : 'Cerrar sesión de soporte'}
            </button>
          </div>
        )}

        {!isActive && (
          <p className="mt-3 text-xs text-neutral-400">
            Esta sesión ya no está activa. Inicia una nueva para ver
            conversaciones.
          </p>
        )}
      </div>

      {isActive && (
        <div className="mt-3">
          <p className="mb-2 text-xs font-semibold text-neutral-500">
            Conversaciones (vista superficial, sin mensajes)
          </p>

          {isLoading && (
            <p className="text-xs text-neutral-400">Cargando conversaciones...</p>
          )}

          {!isLoading && isError && (
            <p className="text-xs text-status-error">
              No se pudieron cargar las conversaciones.
            </p>
          )}

          {!isLoading && !isError && (conversations?.length ?? 0) === 0 && (
            <p className="text-xs text-neutral-400">Sin conversaciones.</p>
          )}

          {!isLoading && !isError && (conversations?.length ?? 0) > 0 && (
            <ul className="space-y-2">
              {conversations!.map((conversation) => (
                <li
                  key={conversation.id}
                  className="rounded-md border border-neutral-100 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-neutral-800">
                      {conversation.contact?.name ?? 'Contacto sin nombre'}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                        {conversation.status}
                      </span>
                      <button
                        type="button"
                        onClick={() => setOpenConversationId(conversation.id)}
                        className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
                      >
                        Ver mensajes
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">
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
              className="rounded-md px-2 py-1 text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
            >
              Anterior
            </button>
            <span className="text-neutral-400">Página {page}</span>
            <button
              type="button"
              disabled={(conversations?.length ?? 0) < CONVERSATIONS_LIMIT}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md px-2 py-1 text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
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
