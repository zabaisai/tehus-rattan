'use client';

import { useQuery } from '@tanstack/react-query';
import { getPlatformCompany } from '@/lib/platform';
import { CompanyStatus } from '@/types';
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

interface CompanyDetailModalProps {
  companyId: string;
  onClose: () => void;
}

export function CompanyDetailModal({
  companyId,
  onClose,
}: CompanyDetailModalProps) {
  const {
    data: company,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['platform-company', companyId],
    queryFn: () => getPlatformCompany(companyId),
  });

  return (
    <Modal title="Detalle de empresa" onClose={onClose} maxWidth="lg">
        {isLoading && (
          <p className="text-sm text-stone-400">Cargando...</p>
        )}

        {!isLoading && isError && (
          <p className="text-sm text-red-600">
            No se pudo cargar el detalle de la empresa.
          </p>
        )}

        {!isLoading && !isError && company && (
          <div className="space-y-5 text-sm">
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-base font-semibold text-stone-900">
                  {company.name}
                </h4>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[company.status]}`}
                >
                  {statusLabels[company.status]}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-stone-500">Teléfono</p>
                  <p className="text-stone-800">{company.phone || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-stone-500">Creada</p>
                  <p className="text-stone-800">
                    {formatDate(company.createdAt)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-stone-500">
                    Última actualización
                  </p>
                  <p className="text-stone-800">
                    {formatDate(company.updatedAt)}
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
                  <p className="text-stone-800">{company.counts.contacts}</p>
                </div>
                <div>
                  <p className="text-xs text-stone-500">Leads</p>
                  <p className="text-stone-800">{company.counts.leads}</p>
                </div>
                <div>
                  <p className="text-xs text-stone-500">Conversaciones</p>
                  <p className="text-stone-800">
                    {company.counts.conversations}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-stone-500">Tareas</p>
                  <p className="text-stone-800">{company.counts.tasks}</p>
                </div>
                <div>
                  <p className="text-xs text-stone-500">Productos</p>
                  <p className="text-stone-800">{company.counts.products}</p>
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
                    {company.whatsapp.connected ? 'Sí' : 'No'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-stone-500">Estado</p>
                  <p className="text-stone-800">
                    {company.whatsapp.status || '-'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-stone-500">Phone Number ID</p>
                  <p className="text-stone-800">
                    {company.whatsapp.phoneNumberId || '-'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-stone-500">Número visible</p>
                  <p className="text-stone-800">
                    {company.whatsapp.displayPhoneNumber || '-'}
                  </p>
                </div>
              </div>
            </div>

            <div className="border-t border-stone-100 pt-4">
              <p className="mb-2 text-xs font-semibold text-stone-500">
                Usuarios ({company.users.total})
              </p>
              {company.users.items.length === 0 ? (
                <p className="text-xs text-stone-400">Sin usuarios.</p>
              ) : (
                <ul className="space-y-2">
                  {company.users.items.map((u) => (
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
                            u.isActive
                              ? 'text-emerald-600'
                              : 'text-stone-400'
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
          </div>
        )}
    </Modal>
  );
}
