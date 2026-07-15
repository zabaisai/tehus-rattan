'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { getInvitationCodes, revokeInvitationCode } from '@/lib/invitation-codes';
import { useAuthStore } from '@/store/auth.store';
import { InvitationCode, InvitationCodeStatus } from '@/types';
import { CreateInvitationCodeModal } from '@/components/platform/CreateInvitationCodeModal';

const statusLabels: Record<InvitationCodeStatus, string> = {
  ACTIVE: 'Activo',
  USED: 'Utilizado',
  REVOKED: 'Revocado',
  EXPIRED: 'Vencido',
};

const statusColors: Record<InvitationCodeStatus, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  USED: 'bg-sky-50 text-sky-700',
  REVOKED: 'bg-red-50 text-red-700',
  EXPIRED: 'bg-stone-100 text-stone-500',
};

const statusFilterOptions: { value: InvitationCodeStatus | ''; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'ACTIVE', label: 'Activos' },
  { value: 'USED', label: 'Utilizados' },
  { value: 'REVOKED', label: 'Revocados' },
  { value: 'EXPIRED', label: 'Vencidos' },
];

function formatDate(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('es-CO');
}

export default function PlatformInvitationCodesPage() {
  const user = useAuthStore((s) => s.user);
  const isPlatformSuperAdmin =
    user?.role === 'SUPER_ADMIN' && user?.companyId === null;
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<InvitationCodeStatus | ''>('');
  const [createOpen, setCreateOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState('');

  const {
    data: codes,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['platform-invitation-codes', statusFilter],
    queryFn: () => getInvitationCodes({ status: statusFilter || undefined }),
    enabled: isPlatformSuperAdmin,
  });

  // Does NOT close the modal — CreateInvitationCodeModal stays open on its
  // own "código generado" panel until the admin checks "ya lo copié" and
  // closes it themselves (see its handleClose). Closing it here as a side
  // effect of generation would unmount that panel before the one-time
  // plaintext code is ever shown.
  function handleCreated() {
    setSuccessMessage('Código de invitación generado correctamente.');
    queryClient.invalidateQueries({ queryKey: ['platform-invitation-codes'] });
    queryClient.invalidateQueries({ queryKey: ['platform-audit-logs'] });
  }

  async function handleRevoke(code: InvitationCode) {
    setRevokeError('');
    setRevokingId(code.id);
    try {
      await revokeInvitationCode(code.id);
      setSuccessMessage(`Código para "${code.intendedCompanyName}" revocado.`);
      await queryClient.invalidateQueries({ queryKey: ['platform-invitation-codes'] });
      await queryClient.invalidateQueries({ queryKey: ['platform-audit-logs'] });
    } catch {
      setRevokeError('No se pudo revocar el código. Intenta de nuevo.');
    } finally {
      setRevokingId(null);
    }
  }

  if (!isPlatformSuperAdmin) {
    return (
      <div>
        <h2 className="text-xl font-semibold text-stone-900">Códigos de invitación</h2>
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
          <h2 className="text-xl font-semibold text-stone-900">Códigos de invitación</h2>
          <p className="mt-1 text-sm text-stone-500">
            Genera y administra los códigos únicos usados para dar de alta nuevas empresas.
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 rounded-md bg-stone-900 px-3 py-2 text-sm text-white hover:bg-stone-800"
        >
          <Plus size={16} />
          Generar código
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as InvitationCodeStatus | '')}
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
      {revokeError && <p className="mb-3 text-sm text-red-600">{revokeError}</p>}

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 bg-stone-50 text-left text-xs text-stone-500">
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Código</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Empresa invitada</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Contacto</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Estado</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Creado por</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Creado</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Vence</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Usado por</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-stone-400">
                  Cargando...
                </td>
              </tr>
            )}

            {!isLoading && isError && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-red-600">
                  No se pudo cargar el listado de códigos.
                </td>
              </tr>
            )}

            {!isLoading && !isError && (codes?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-stone-400">
                  No hay códigos de invitación.
                </td>
              </tr>
            )}

            {codes?.map((code) => (
              <tr key={code.id} className="border-b border-stone-100 last:border-0">
                <td className="px-4 py-2.5 font-mono text-xs text-stone-700">
                  {code.codePreview}
                </td>
                <td className="px-4 py-2.5 text-stone-800">{code.intendedCompanyName}</td>
                <td className="px-4 py-2.5 text-stone-600">
                  {code.intendedContactEmail || '-'}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[code.status]}`}
                  >
                    {statusLabels[code.status]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-stone-600">{code.createdBy.name}</td>
                <td className="px-4 py-2.5 text-stone-600">{formatDate(code.createdAt)}</td>
                <td className="px-4 py-2.5 text-stone-600">{formatDate(code.expiresAt)}</td>
                <td className="px-4 py-2.5 text-stone-600">
                  {code.usedBy ? `${code.usedBy.name} (${code.company?.name ?? '-'})` : '-'}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end">
                    {code.status === 'ACTIVE' && (
                      <button
                        onClick={() => handleRevoke(code)}
                        disabled={revokingId === code.id}
                        className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        {revokingId === code.id ? 'Revocando...' : 'Revocar'}
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
        <CreateInvitationCodeModal
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
