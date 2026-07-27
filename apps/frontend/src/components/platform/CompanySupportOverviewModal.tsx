'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getPlatformCompanySupportOverview, getSupportSessions } from '@/lib/platform';
import { CompanyStatus, PlatformSupportSession } from '@/types';
import { StartSupportSessionModal } from './StartSupportSessionModal';
import { SupportSessionPanel } from './SupportSessionPanel';
import { Modal } from '@/components/ui/Modal';

const statusLabels: Record<CompanyStatus, string> = {
  ACTIVE: 'Activa',
  SUSPENDED: 'Suspendida',
  DELETED: 'Eliminada',
};

const statusColors: Record<CompanyStatus, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  SUSPENDED: 'bg-amber-50 text-amber-700',
  DELETED: 'bg-red-50 text-red-700',
};

function formatDate(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('es-CO');
}

interface CompanySupportOverviewModalProps {
  companyId: string;
  onClose: () => void;
}

export function CompanySupportOverviewModal({
  companyId,
  onClose,
}: CompanySupportOverviewModalProps) {
  const queryClient = useQueryClient();
  const {
    data: overview,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['platform-company-support-overview', companyId],
    queryFn: () => getPlatformCompanySupportOverview(companyId),
  });

  const [localSession, setLocalSession] = useState<PlatformSupportSession | null>(
    null,
  );
  const [startModalOpen, setStartModalOpen] = useState(false);

  const { data: activeSessions, isLoading: loadingActiveSession } = useQuery({
    queryKey: ['platform-support-sessions-active', companyId],
    queryFn: () => getSupportSessions({ companyId, status: 'ACTIVE' }),
  });

  // Whatever this modal just created or ended locally always wins over the
  // list query — it reflects a state change we already know happened,
  // while the query result may still be the pre-invalidation snapshot.
  const session = localSession ?? activeSessions?.[0] ?? null;
  const hasActiveSession = session?.status === 'ACTIVE';

  return (
    <>
      <Modal
        title="Overview de soporte"
        onClose={onClose}
        maxWidth="2xl"
        headerActions={
          !hasActiveSession && !loadingActiveSession && overview ? (
            <button
              onClick={() => setStartModalOpen(true)}
              className="whitespace-nowrap rounded-md bg-stone-900 px-3 py-1.5 text-xs text-white hover:bg-stone-800"
            >
              Iniciar soporte
            </button>
          ) : undefined
        }
      >
        {isLoading && <p className="text-sm text-stone-400">Cargando...</p>}

        {!isLoading && isError && (
          <p className="text-sm text-red-600">
            No se pudo cargar el overview de soporte.
          </p>
        )}

        {!isLoading && !isError && overview && (
          <div className="space-y-5 text-sm">
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-base font-semibold text-stone-900">
                  {overview.company.name}
                </h4>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[overview.company.status]}`}
                >
                  {statusLabels[overview.company.status]}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-stone-500">Teléfono</p>
                  <p className="text-stone-800">
                    {overview.company.phone || '-'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-stone-500">Creada</p>
                  <p className="text-stone-800">
                    {formatDate(overview.company.createdAt)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-stone-500">
                    Última actualización
                  </p>
                  <p className="text-stone-800">
                    {formatDate(overview.company.updatedAt)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-stone-500">Última actividad</p>
                  <p className="text-stone-800">
                    {formatDate(overview.lastActivityAt)}
                  </p>
                </div>
              </div>
            </div>

            <div className="border-t border-stone-100 pt-4">
              <p className="mb-2 text-xs font-semibold text-stone-500">
                Recursos
              </p>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                <div>
                  <p className="text-xs text-stone-500">Contactos</p>
                  <p className="text-stone-800">{overview.counts.contacts}</p>
                </div>
                <div>
                  <p className="text-xs text-stone-500">Leads</p>
                  <p className="text-stone-800">{overview.counts.leads}</p>
                </div>
                <div>
                  <p className="text-xs text-stone-500">Conversaciones</p>
                  <p className="text-stone-800">
                    {overview.counts.conversations}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-stone-500">Tareas</p>
                  <p className="text-stone-800">{overview.counts.tasks}</p>
                </div>
                <div>
                  <p className="text-xs text-stone-500">Productos</p>
                  <p className="text-stone-800">{overview.counts.products}</p>
                </div>
              </div>
            </div>

            <div className="border-t border-stone-100 pt-4">
              <p className="mb-2 text-xs font-semibold text-stone-500">
                WhatsApp
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-stone-500">Conectado</p>
                  <p className="text-stone-800">
                    {overview.whatsapp.connected ? 'Sí' : 'No'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-stone-500">Estado</p>
                  <p className="text-stone-800">
                    {overview.whatsapp.status || '-'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-stone-500">Phone Number ID</p>
                  <p className="text-stone-800">
                    {overview.whatsapp.phoneNumberId || '-'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-stone-500">Número visible</p>
                  <p className="text-stone-800">
                    {overview.whatsapp.displayPhoneNumber || '-'}
                  </p>
                </div>
              </div>
            </div>

            <div className="border-t border-stone-100 pt-4">
              <p className="mb-2 text-xs font-semibold text-stone-500">
                Usuarios ({overview.users.active} activos / {overview.users.total} total)
              </p>
              {overview.users.items.length === 0 ? (
                <p className="text-xs text-stone-400">Sin usuarios.</p>
              ) : (
                <ul className="space-y-2">
                  {overview.users.items.map((u) => (
                    <li
                      key={u.id}
                      className="flex items-center justify-between rounded-md border border-stone-100 px-3 py-2"
                    >
                      <div>
                        <p className="text-stone-800">{u.name}</p>
                        <p className="text-xs text-stone-500">{u.email}</p>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-600">
                          {u.role}
                        </span>
                        <span
                          className={
                            u.isActive ? 'text-emerald-600' : 'text-stone-400'
                          }
                        >
                          {u.isActive ? 'Activo' : 'Inactivo'}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t border-stone-100 pt-4">
              <p className="mb-2 text-xs font-semibold text-stone-500">
                Leads recientes
              </p>
              {overview.recentLeads.length === 0 ? (
                <p className="text-xs text-stone-400">Sin leads.</p>
              ) : (
                <ul className="space-y-2">
                  {overview.recentLeads.map((lead) => (
                    <li
                      key={lead.id}
                      className="rounded-md border border-stone-100 px-3 py-2"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-stone-800">{lead.title}</p>
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                          {lead.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-stone-500">
                        {lead.stageName || 'Sin etapa'} ·{' '}
                        {lead.assignedUser?.name ?? 'Sin asignar'} ·{' '}
                        {formatDate(lead.updatedAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t border-stone-100 pt-4">
              <p className="mb-2 text-xs font-semibold text-stone-500">
                Conversaciones recientes
              </p>
              {overview.recentConversations.length === 0 ? (
                <p className="text-xs text-stone-400">Sin conversaciones.</p>
              ) : (
                <ul className="space-y-2">
                  {overview.recentConversations.map((conversation) => (
                    <li
                      key={conversation.id}
                      className="rounded-md border border-stone-100 px-3 py-2"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-stone-800">
                          {conversation.contact?.name ?? 'Contacto sin nombre'}
                        </p>
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                          {conversation.status}
                        </span>
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
            </div>

            <div className="border-t border-stone-100 pt-4">
              <p className="mb-2 text-xs font-semibold text-stone-500">
                Tareas recientes
              </p>
              {overview.recentTasks.length === 0 ? (
                <p className="text-xs text-stone-400">Sin tareas.</p>
              ) : (
                <ul className="space-y-2">
                  {overview.recentTasks.map((task) => (
                    <li
                      key={task.id}
                      className="rounded-md border border-stone-100 px-3 py-2"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-stone-800">{task.title}</p>
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                          {task.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-stone-500">
                        Vence: {formatDate(task.dueDate)} ·{' '}
                        {task.assignedUser?.name ?? 'Sin asignar'} ·{' '}
                        {formatDate(task.updatedAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p className="border-t border-stone-100 pt-4 text-xs text-stone-400">
              Esta vista es superficial: no muestra mensajes ni contenido de
              conversaciones.
            </p>

            {session && (
              <SupportSessionPanel
                session={session}
                onEnded={(ended) => setLocalSession(ended)}
              />
            )}
          </div>
        )}
      </Modal>

      {startModalOpen && overview && (
        <StartSupportSessionModal
          companyId={companyId}
          companyName={overview.company.name}
          onClose={() => setStartModalOpen(false)}
          onCreated={(created) => {
            setLocalSession(created);
            setStartModalOpen(false);
            // Starting a session is an audited action (START_SUPPORT_SESSION)
            // — same reasoning as the other platform mutations: refresh the
            // audit trail so it isn't stale for up to 30s.
            queryClient.invalidateQueries({ queryKey: ['platform-audit-logs'] });
            queryClient.invalidateQueries({
              queryKey: ['platform-support-sessions-active', companyId],
            });
          }}
        />
      )}
    </>
  );
}
