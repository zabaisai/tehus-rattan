'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { getPlatformCompanies, updatePlatformCompanyStatus } from '@/lib/platform';
import { useAuthStore } from '@/store/auth.store';
import { CompanyStatus, PlatformCompanyListItem } from '@/types';
import { CreateCompanyModal } from '@/components/platform/CreateCompanyModal';
import { CompanyDetailModal } from '@/components/platform/CompanyDetailModal';
import { ChangeCompanyStatusModal } from '@/components/platform/ChangeCompanyStatusModal';
import { CompanySupportOverviewModal } from '@/components/platform/CompanySupportOverviewModal';

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

const statusFilterOptions: { value: CompanyStatus | ''; label: string }[] = [
  { value: '', label: 'Todas' },
  { value: 'ACTIVE', label: 'Activas' },
  { value: 'SUSPENDED', label: 'Suspendidas' },
  { value: 'DELETED', label: 'Eliminadas' },
];

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('es-CO');
}

export default function PlatformCompaniesPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const isPlatformSuperAdmin =
    user?.role === 'SUPER_ADMIN' && user?.companyId === null;
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<CompanyStatus | ''>('');
  const [createOpen, setCreateOpen] = useState(false);
  const [detailCompanyId, setDetailCompanyId] = useState<string | null>(null);
  const [supportOverviewCompanyId, setSupportOverviewCompanyId] = useState<
    string | null
  >(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [pendingStatusChange, setPendingStatusChange] = useState<{
    company: PlatformCompanyListItem;
    targetStatus: CompanyStatus;
  } | null>(null);

  const {
    data: companies,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['platform-companies', search, statusFilter],
    queryFn: () =>
      getPlatformCompanies({
        search: search.trim() || undefined,
        status: statusFilter || undefined,
      }),
    enabled: isPlatformSuperAdmin,
  });

  function handleCreated(companyName: string) {
    setCreateOpen(false);
    setSuccessMessage(`Empresa "${companyName}" creada correctamente.`);
    queryClient.invalidateQueries({ queryKey: ['platform-companies'] });
    // Creating a company is an audited action — refresh the audit trail
    // too, so it doesn't show up to 30s stale if the admin checks right
    // after (react-query's default staleTime).
    queryClient.invalidateQueries({ queryKey: ['platform-audit-logs'] });
  }

  function openStatusChange(
    company: PlatformCompanyListItem,
    targetStatus: CompanyStatus,
  ) {
    setSuccessMessage('');
    setPendingStatusChange({ company, targetStatus });
  }

  // Left uncaught on purpose: ChangeCompanyStatusModal awaits this and shows
  // the error itself, keeping the modal open so the user can retry or
  // cancel instead of losing whatever reason they already typed.
  async function confirmStatusChange(reason?: string) {
    if (!pendingStatusChange) return;
    const { company, targetStatus } = pendingStatusChange;

    await updatePlatformCompanyStatus(company.id, targetStatus, reason);
    await queryClient.invalidateQueries({ queryKey: ['platform-companies'] });
    // Same reasoning as handleCreated: status changes are audited too.
    await queryClient.invalidateQueries({ queryKey: ['platform-audit-logs'] });
    setPendingStatusChange(null);
    setSuccessMessage(`Estado de "${company.name}" actualizado a ${statusLabels[targetStatus]}.`);
  }

  if (!isPlatformSuperAdmin) {
    return (
      <div>
        <h2 className="text-xl font-semibold text-stone-900">Empresas</h2>
        <div className="mt-6 rounded-lg border border-stone-200 bg-white p-4">
          <p className="text-sm text-stone-600">
            No tienes permiso para acceder a esta sección.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-stone-900">Empresas</h2>
          <p className="mt-1 text-sm text-stone-500">
            Administra las empresas que usan el CRM.
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center justify-center gap-1.5 rounded-md bg-stone-900 px-3 py-2 text-sm text-white hover:bg-stone-800"
        >
          <Plus size={16} />
          Nueva empresa
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search
            size={15}
            className="absolute left-2.5 top-2.5 text-stone-400"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre"
            className="w-full rounded-md border border-stone-300 py-2 pl-8 pr-3 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as CompanyStatus | '')}
          className="rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
        >
          {statusFilterOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {successMessage && (
        <p className="mb-3 text-sm text-emerald-600">{successMessage}</p>
      )}

      {isLoading && (
        <p className="rounded-lg border border-stone-200 bg-white py-6 text-center text-sm text-stone-400 sm:hidden">
          Cargando...
        </p>
      )}
      {!isLoading && isError && (
        <p className="rounded-lg border border-stone-200 bg-white py-6 text-center text-sm text-red-600 sm:hidden">
          No se pudo cargar el listado de empresas.
        </p>
      )}
      {!isLoading && !isError && (companies?.length ?? 0) === 0 && (
        <p className="rounded-lg border border-stone-200 bg-white py-6 text-center text-sm text-stone-400 sm:hidden">
          No hay empresas.
        </p>
      )}

      {/* Móvil: tarjetas apiladas en vez de tabla */}
      <div className="flex flex-col gap-2 sm:hidden">
        {companies?.map((company) => (
          <div key={company.id} className="rounded-lg border border-stone-200 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-stone-900">{company.name}</p>
                <p className="mt-0.5 text-xs text-stone-500">{company.phone || '-'}</p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[company.status]}`}
              >
                {statusLabels[company.status]}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-stone-600">
              <div>
                <p className="text-stone-400">Usuarios</p>
                <p>{company.activeUsers} / {company.totalUsers}</p>
              </div>
              <div>
                <p className="text-stone-400">Leads</p>
                <p>{company.totalLeads}</p>
              </div>
              <div>
                <p className="text-stone-400">WhatsApp</p>
                <p>{company.whatsappConnected ? 'Sí' : 'No'}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-stone-100 pt-3">
              <button
                onClick={() => setDetailCompanyId(company.id)}
                className="rounded-md bg-stone-100 px-2.5 py-1.5 text-xs text-stone-700"
              >
                Ver detalle
              </button>
              <button
                onClick={() => router.push(`/dashboard/platform/activity/${company.id}`)}
                className="rounded-md bg-stone-100 px-2.5 py-1.5 text-xs text-stone-700"
              >
                Ver actividad
              </button>
              <button
                onClick={() => setSupportOverviewCompanyId(company.id)}
                className="rounded-md bg-stone-100 px-2.5 py-1.5 text-xs text-stone-700"
              >
                Ver soporte
              </button>
              {company.status === 'ACTIVE' && (
                <button
                  onClick={() => openStatusChange(company, 'SUSPENDED')}
                  className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700"
                >
                  Suspender
                </button>
              )}
              {company.status === 'SUSPENDED' && (
                <button
                  onClick={() => openStatusChange(company, 'ACTIVE')}
                  className="rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700"
                >
                  Reactivar
                </button>
              )}
              {(company.status === 'ACTIVE' || company.status === 'SUSPENDED') && (
                <button
                  onClick={() => openStatusChange(company, 'DELETED')}
                  className="rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-600"
                >
                  Marcar eliminada
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border border-stone-200 bg-white sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 bg-stone-50 text-left text-xs text-stone-500">
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Empresa</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Teléfono</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Estado</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Usuarios</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Contactos</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Leads</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Conversaciones</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">WhatsApp</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Creada</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-stone-400">
                  Cargando...
                </td>
              </tr>
            )}

            {!isLoading && isError && (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-red-600">
                  No se pudo cargar el listado de empresas.
                </td>
              </tr>
            )}

            {!isLoading && !isError && (companies?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-stone-400">
                  No hay empresas.
                </td>
              </tr>
            )}

            {companies?.map((company) => (
              <tr
                key={company.id}
                className="border-b border-stone-100 last:border-0"
              >
                <td className="px-4 py-2.5 text-stone-800">{company.name}</td>
                <td className="px-4 py-2.5 text-stone-600">
                  {company.phone || '-'}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[company.status]}`}
                  >
                    {statusLabels[company.status]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-stone-600">
                  {company.activeUsers} / {company.totalUsers}
                </td>
                <td className="px-4 py-2.5 text-stone-600">
                  {company.totalContacts}
                </td>
                <td className="px-4 py-2.5 text-stone-600">
                  {company.totalLeads}
                </td>
                <td className="px-4 py-2.5 text-stone-600">
                  {company.totalConversations}
                </td>
                <td className="px-4 py-2.5 text-stone-600">
                  {company.whatsappConnected ? 'Sí' : 'No'}
                </td>
                <td className="px-4 py-2.5 text-stone-600">
                  {formatDate(company.createdAt)}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <button
                      onClick={() => setDetailCompanyId(company.id)}
                      className="rounded-md px-2 py-1 text-xs text-stone-600 hover:bg-stone-100"
                    >
                      Ver detalle
                    </button>

                    <button
                      onClick={() => router.push(`/dashboard/platform/activity/${company.id}`)}
                      className="rounded-md px-2 py-1 text-xs text-stone-600 hover:bg-stone-100"
                    >
                      Ver actividad
                    </button>

                    <button
                      onClick={() => setSupportOverviewCompanyId(company.id)}
                      className="rounded-md px-2 py-1 text-xs text-stone-600 hover:bg-stone-100"
                    >
                      Ver soporte
                    </button>

                    {company.status === 'ACTIVE' && (
                      <button
                        onClick={() => openStatusChange(company, 'SUSPENDED')}
                        className="rounded-md px-2 py-1 text-xs text-amber-700 hover:bg-amber-50"
                      >
                        Suspender
                      </button>
                    )}

                    {company.status === 'SUSPENDED' && (
                      <button
                        onClick={() => openStatusChange(company, 'ACTIVE')}
                        className="rounded-md px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50"
                      >
                        Reactivar
                      </button>
                    )}

                    {(company.status === 'ACTIVE' ||
                      company.status === 'SUSPENDED') && (
                      <button
                        onClick={() => openStatusChange(company, 'DELETED')}
                        className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                      >
                        Marcar eliminada
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {createOpen && (
        <CreateCompanyModal
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
      )}

      {detailCompanyId && (
        <CompanyDetailModal
          companyId={detailCompanyId}
          onClose={() => setDetailCompanyId(null)}
        />
      )}

      {pendingStatusChange && (
        <ChangeCompanyStatusModal
          companyName={pendingStatusChange.company.name}
          targetStatus={pendingStatusChange.targetStatus}
          onClose={() => setPendingStatusChange(null)}
          onConfirm={confirmStatusChange}
        />
      )}

      {supportOverviewCompanyId && (
        <CompanySupportOverviewModal
          companyId={supportOverviewCompanyId}
          onClose={() => setSupportOverviewCompanyId(null)}
        />
      )}
    </div>
  );
}
