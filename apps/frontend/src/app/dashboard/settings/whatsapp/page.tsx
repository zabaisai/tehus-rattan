'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getWhatsAppIntegration,
  disconnectWhatsAppIntegration,
} from '@/lib/whatsapp';
import { useAuthStore } from '@/store/auth.store';
import { WhatsAppIntegrationStatus } from '@/types';
import { WhatsAppIntegrationForm } from '@/components/whatsapp/WhatsAppIntegrationForm';

const statusLabels: Record<WhatsAppIntegrationStatus, string> = {
  CONNECTED: 'Conectado',
  DISCONNECTED: 'Desconectado',
  PENDING: 'Pendiente',
  REVOKED: 'Revocado',
};

const statusColors: Record<WhatsAppIntegrationStatus, string> = {
  CONNECTED: 'bg-emerald-50 text-emerald-700',
  DISCONNECTED: 'bg-stone-100 text-stone-600',
  PENDING: 'bg-amber-50 text-amber-700',
  REVOKED: 'bg-red-50 text-red-700',
};

function formatDate(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('es-CO');
}

export default function WhatsAppSettingsPage() {
  const user = useAuthStore((s) => s.user);
  const canManage = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const queryClient = useQueryClient();

  const {
    data: integration,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['whatsapp-integration'],
    queryFn: getWhatsAppIntegration,
    enabled: canManage,
  });

  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState('');
  const [disconnectSuccess, setDisconnectSuccess] = useState('');

  function handleFormSuccess() {
    queryClient.invalidateQueries({ queryKey: ['whatsapp-integration'] });
  }

  async function handleDisconnect() {
    const confirmed = window.confirm(
      'Esto desconectará WhatsApp localmente en el CRM. No revoca el token en Meta. ¿Deseas continuar?',
    );
    if (!confirmed) return;

    setDisconnectError('');
    setDisconnectSuccess('');
    setIsDisconnecting(true);
    try {
      await disconnectWhatsAppIntegration();
      await queryClient.invalidateQueries({ queryKey: ['whatsapp-integration'] });
      setDisconnectSuccess('WhatsApp desconectado correctamente.');
    } catch (err) {
      const response = (
        err as {
          response?: {
            status?: number;
            data?: { message?: string | string[] };
          };
        }
      )?.response;

      if (response?.status === 403) {
        setDisconnectError('No tienes permiso para esta acción.');
      } else {
        const message = response?.data?.message;
        setDisconnectError(
          (Array.isArray(message) ? message[0] : message) ||
            'Ocurrió un error',
        );
      }
    } finally {
      setIsDisconnecting(false);
    }
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-stone-900">WhatsApp</h2>
      <p className="mt-1 text-sm text-stone-500">
        Gestiona la integración de WhatsApp Business de tu empresa.
      </p>

      {!canManage ? (
        <div className="mt-6 rounded-lg border border-stone-200 bg-white p-4">
          <p className="text-sm text-stone-600">
            No tienes permiso para administrar WhatsApp.
          </p>
        </div>
      ) : (
        <div className="mt-6 rounded-lg border border-stone-200 bg-white p-4">
          {isLoading && (
            <p className="text-sm text-stone-400">Cargando integración...</p>
          )}

          {!isLoading && isError && (
            <p className="text-sm text-red-600">
              No se pudo cargar la integración de WhatsApp.
            </p>
          )}

          {!isLoading && !isError && !integration && (
            <p className="text-sm text-stone-600">WhatsApp no conectado.</p>
          )}

          {!isLoading && !isError && integration && (
            <div className="space-y-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-stone-500">Estado:</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[integration.status]}`}
                >
                  {statusLabels[integration.status]}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-stone-500">Phone Number ID</p>
                  <p className="text-stone-800">{integration.phoneNumberId}</p>
                </div>
                <div>
                  <p className="text-xs text-stone-500">Número visible</p>
                  <p className="text-stone-800">
                    {integration.displayPhoneNumber || '-'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-stone-500">WABA ID</p>
                  <p className="text-stone-800">{integration.wabaId || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-stone-500">Conectado desde</p>
                  <p className="text-stone-800">
                    {formatDate(integration.connectedAt)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-stone-500">Desconectado desde</p>
                  <p className="text-stone-800">
                    {formatDate(integration.disconnectedAt)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-stone-500">Última actualización</p>
                  <p className="text-stone-800">
                    {formatDate(integration.updatedAt)}
                  </p>
                </div>
              </div>

              <div className="border-t border-stone-100 pt-4">
                {integration.status !== 'DISCONNECTED' ? (
                  <>
                    <button
                      onClick={handleDisconnect}
                      disabled={isDisconnecting}
                      className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      {isDisconnecting
                        ? 'Desconectando...'
                        : 'Desconectar WhatsApp'}
                    </button>
                    <p className="mt-2 text-xs text-stone-400">
                      La desconexión solo cambia el estado local en el CRM; no
                      revoca el token en Meta.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-stone-600">
                    Esta integración está desconectada.
                  </p>
                )}

                {disconnectError && (
                  <p className="mt-2 text-xs text-red-600">
                    {disconnectError}
                  </p>
                )}
                {disconnectSuccess && (
                  <p className="mt-2 text-xs text-emerald-600">
                    {disconnectSuccess}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {canManage && !isLoading && (
        <div className="mt-4 rounded-lg border border-stone-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-stone-800">
            {integration ? 'Actualizar integración' : 'Conectar WhatsApp'}
          </h3>
          <WhatsAppIntegrationForm
            integration={integration ?? null}
            onSuccess={handleFormSuccess}
          />
        </div>
      )}

      <p className="mt-4 text-xs text-stone-400">
        Los tokens de acceso nunca se muestran en esta pantalla.
      </p>
    </div>
  );
}
