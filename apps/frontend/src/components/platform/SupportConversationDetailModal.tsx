'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSupportSessionConversationDetail } from '@/lib/platform';
import { Modal } from '@/components/ui/Modal';

const MESSAGES_LIMIT = 50;

function formatDate(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('es-CO');
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface SupportConversationDetailModalProps {
  sessionId: string;
  conversationId: string;
  onClose: () => void;
}

export function SupportConversationDetailModal({
  sessionId,
  conversationId,
  onClose,
}: SupportConversationDetailModalProps) {
  const [page, setPage] = useState(1);

  const {
    data: detail,
    isLoading,
    isError,
  } = useQuery({
    queryKey: [
      'platform-support-session-conversation-detail',
      sessionId,
      conversationId,
      page,
    ],
    queryFn: () =>
      getSupportSessionConversationDetail(sessionId, conversationId, {
        page,
        limit: MESSAGES_LIMIT,
      }),
  });

  const showFooter = !isLoading && !isError && !!detail;

  return (
    <Modal
      title={`Conversación${detail ? ` — ${detail.conversation.contact?.name ?? 'Contacto sin nombre'}` : ''}`}
      onClose={onClose}
      maxWidth="2xl"
      footer={
        showFooter && detail ? (
          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md px-2 py-1 text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
            >
              Anterior
            </button>
            <span className="text-neutral-400">Página {detail.page}</span>
            <button
              type="button"
              disabled={detail.messages.length < MESSAGES_LIMIT}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md px-2 py-1 text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        ) : undefined
      }
    >
        {isLoading && (
          <p className="text-sm text-neutral-400">Cargando...</p>
        )}

        {!isLoading && isError && (
          <p className="text-sm text-red-600">
            No se pudo cargar el detalle de la conversación.
          </p>
        )}

        {!isLoading && !isError && detail && (
          <>
            <div className="mb-4 border-b border-neutral-100 pb-4 text-sm">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-neutral-500">Estado</p>
                  <p className="text-neutral-800">{detail.conversation.status}</p>
                </div>
                <div>
                  <p className="text-xs text-neutral-500">Canal</p>
                  <p className="text-neutral-800">{detail.conversation.channel}</p>
                </div>
                <div>
                  <p className="text-xs text-neutral-500">Agente asignado</p>
                  <p className="text-neutral-800">
                    {detail.conversation.assignedUser?.name ?? 'Sin asignar'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-neutral-500">Creada</p>
                  <p className="text-neutral-800">
                    {formatDate(detail.conversation.createdAt)}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-xs text-neutral-400">
                Actualizada: {formatDate(detail.conversation.updatedAt)}
              </p>
            </div>

            <div>
              {detail.messages.length === 0 ? (
                <p className="text-center text-sm text-neutral-400">
                  Sin mensajes en esta página.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {detail.messages.map((message) => {
                    const isOutbound = message.direction === 'OUTBOUND';
                    return (
                      <div
                        key={message.id}
                        className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                            isOutbound
                              ? 'bg-brand-primary text-white'
                              : 'border border-neutral-200 bg-white text-neutral-800'
                          }`}
                        >
                          <p
                            className={`mb-1 text-[10px] uppercase tracking-wide ${
                              isOutbound ? 'text-neutral-300' : 'text-neutral-400'
                            }`}
                          >
                            {isOutbound ? 'Equipo' : 'Contacto'} · {message.type}
                            {message.status ? ` · ${message.status}` : ''}
                          </p>
                          <p className="whitespace-pre-wrap">
                            {message.body?.trim()
                              ? message.body
                              : 'Mensaje sin texto disponible'}
                          </p>
                          <p
                            className={`mt-1 text-[10px] ${
                              isOutbound ? 'text-neutral-300' : 'text-neutral-400'
                            }`}
                          >
                            {formatTime(message.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
    </Modal>
  );
}
