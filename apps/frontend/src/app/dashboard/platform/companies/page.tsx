'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { getPlatformCompanies, updatePlatformCompanyStatus } from '@/lib/platform';
import { useAuthStore } from '@/store/auth.store';
import { CompanyStatus, PlatformCompanyListItem } from '@/types';
import { CreateCompanyModal } from '@/components/platform/CreateCompanyModal';
import { CompanyDetailModal } from '@/components/platform/CompanyDetailModal';

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
  const isPlatformSuperAdmin =
    user?.role === 'SUPER_ADMIN' && user?.companyId === null;
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<CompanyStatus | ''>('');
  const [createOpen, setCreateOpen] = useState(false);
  const [detailCompanyId, setDetailCompanyId] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

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
  }

  async function handleStatusChange(
    company: PlatformCompanyListItem,
    newStatus: CompanyStatus,
  ) {
    const confirmMessages: Record<CompanyStatus, string> = {
      SUSPENDED: `¿Suspender "${company.name}"? Sus usuarios no podrán iniciar sesión mientras esté suspendida.`,
      ACTIVE: `¿Reactivar "${company.name}"?`,
      DELETED: `¿Marcar "${company.name}" como eliminada? No podrá reactivarse después.`,
    };
    if (!window.confirm(confirmMessages[newStatus])) return;

    setActionError('');
    setSuccessMessage('');
    setActioningId(company.id);
    try {
      await updatePlatformCompanyStatus(company.id, newStatus);
      await queryClient.invalidateQueries({ queryKey: ['platform-companies'] });
    } catch (err) {
      setActionError(extractErrorMessage(err, 'Ocurrió un error'));
    } finally {
      setActioningId(null);
    }
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
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-stone-900">Empresas</h2>
          <p className="mt-1 text-sm text-stone-500">
            Administra las empresas que usan el CRM.
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 rounded-md bg-stone-900 px-3 py-2 text-sm text-white hover:bg-stone-800"
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
      {actionError && (
        <p className="mb-3 text-sm text-red-600">{actionError}</p>
      )}

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
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

                    {company.status === 'ACTIVE' && (
                      <button
                        disabled={actioningId === company.id}
                        onClick={() => handleStatusChange(company, 'SUSPENDED')}
                        className="rounded-md px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                      >
                        Suspender
                      </button>
                    )}

                    {company.status === 'SUSPENDED' && (
                      <button
                        disabled={actioningId === company.id}
                        onClick={() => handleStatusChange(company, 'ACTIVE')}
                        className="rounded-md px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        Reactivar
                      </button>
                    )}

                    {(company.status === 'ACTIVE' ||
                      company.status === 'SUSPENDED') && (
                      <button
                        disabled={actioningId === company.id}
                        onClick={() => handleStatusChange(company, 'DELETED')}
                        className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
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
    </div>
  );
}
