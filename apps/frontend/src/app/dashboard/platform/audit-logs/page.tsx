'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPlatformAuditLogs } from '@/lib/platform';
import { useAuthStore } from '@/store/auth.store';
import { PlatformAuditLog } from '@/types';

const actionFilterOptions: { value: string; label: string }[] = [
  { value: '', label: 'Todas' },
  { value: 'CREATE_COMPANY', label: 'CREATE_COMPANY' },
  { value: 'UPDATE_COMPANY_STATUS', label: 'UPDATE_COMPANY_STATUS' },
  { value: 'VIEW_COMPANY_SUPPORT_OVERVIEW', label: 'VIEW_COMPANY_SUPPORT_OVERVIEW' },
  { value: 'START_SUPPORT_SESSION', label: 'START_SUPPORT_SESSION' },
  { value: 'VIEW_SUPPORT_CONVERSATIONS', label: 'VIEW_SUPPORT_CONVERSATIONS' },
  { value: 'END_SUPPORT_SESSION', label: 'END_SUPPORT_SESSION' },
];

const actionLabels: Record<string, string> = {
  CREATE_COMPANY: 'Crear empresa',
  UPDATE_COMPANY_STATUS: 'Cambiar estado de empresa',
  VIEW_COMPANY_SUPPORT_OVERVIEW: 'Ver overview de soporte',
  START_SUPPORT_SESSION: 'Iniciar sesión de soporte',
  VIEW_SUPPORT_CONVERSATIONS: 'Ver conversaciones de soporte',
  END_SUPPORT_SESSION: 'Cerrar sesión de soporte',
};

const metadataLabels: Record<string, string> = {
  companyName: 'Nombre de empresa',
  companyPhone: 'Teléfono de empresa',
  adminEmail: 'Email del admin',
  adminUserId: 'ID admin',
  companyId: 'ID empresa',
  fromStatus: 'Estado anterior',
  toStatus: 'Estado nuevo',
  supportSessionId: 'ID sesión de soporte',
  reason: 'Motivo',
  expiresAt: 'Expira',
  resultCount: 'Resultados',
  page: 'Página',
  limit: 'Límite',
  durationSeconds: 'Duración (s)',
};

function formatDate(value: string) {
  return new Date(value).toLocaleString('es-CO');
}

function truncate(value: string | null, max = 36) {
  if (!value) return '-';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function MetadataView({ metadata }: { metadata: Record<string, unknown> | null }) {
  if (!metadata || Object.keys(metadata).length === 0) {
    return <span className="text-stone-400">-</span>;
  }

  return (
    <ul className="space-y-0.5 text-xs">
      {Object.entries(metadata).map(([key, value]) => (
        <li key={key} className="whitespace-nowrap">
          <span className="text-stone-400">{metadataLabels[key] ?? key}:</span>{' '}
          <span className="text-stone-700">{String(value ?? '-')}</span>
        </li>
      ))}
    </ul>
  );
}

function ActorCell({ log }: { log: PlatformAuditLog }) {
  if (log.actor) {
    return (
      <div>
        <p className="text-stone-800">{log.actor.name}</p>
        <p className="text-xs text-stone-500">{log.actor.email}</p>
      </div>
    );
  }
  // The actor's User row can be gone (e.g. deleted later) — the log still
  // keeps the role it was performed under, per the audit model's design.
  return <span className="text-stone-400">{log.actorRole} (usuario eliminado)</span>;
}

export default function PlatformAuditLogsPage() {
  const user = useAuthStore((s) => s.user);
  const isPlatformSuperAdmin =
    user?.role === 'SUPER_ADMIN' && user?.companyId === null;

  const [actionFilter, setActionFilter] = useState('');
  const [affectedCompanyId, setAffectedCompanyId] = useState('');
  const [actorUserId, setActorUserId] = useState('');

  const {
    data: logs,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['platform-audit-logs', actionFilter, affectedCompanyId, actorUserId],
    queryFn: () =>
      getPlatformAuditLogs({
        action: actionFilter || undefined,
        affectedCompanyId: affectedCompanyId.trim() || undefined,
        actorUserId: actorUserId.trim() || undefined,
      }),
    enabled: isPlatformSuperAdmin,
  });

  if (!isPlatformSuperAdmin) {
    return (
      <div>
        <h2 className="text-xl font-semibold text-stone-900">Auditoría</h2>
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
      <div className="mb-5">
        <h2 className="text-xl font-semibold text-stone-900">Auditoría</h2>
        <p className="mt-1 text-sm text-stone-500">
          Revisa las acciones sensibles realizadas en la plataforma.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
        >
          {actionFilterOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={affectedCompanyId}
          onChange={(e) => setAffectedCompanyId(e.target.value)}
          placeholder="ID de empresa afectada"
          className="w-56 rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
        />

        <input
          type="text"
          value={actorUserId}
          onChange={(e) => setActorUserId(e.target.value)}
          placeholder="ID del actor"
          className="w-56 rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 bg-stone-50 text-left text-xs text-stone-500">
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Fecha</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Acción</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Actor</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Empresa afectada</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Entidad</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Motivo</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">IP</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">User Agent</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Metadata</th>
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
                  No se pudo cargar la auditoría.
                </td>
              </tr>
            )}

            {!isLoading && !isError && (logs?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-stone-400">
                  No hay registros de auditoría.
                </td>
              </tr>
            )}

            {logs?.map((log) => (
              <tr key={log.id} className="border-b border-stone-100 align-top last:border-0">
                <td className="whitespace-nowrap px-4 py-2.5 text-stone-600">
                  {formatDate(log.createdAt)}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-stone-800">
                  {actionLabels[log.action] ?? log.action}
                </td>
                <td className="px-4 py-2.5">
                  <ActorCell log={log} />
                </td>
                <td className="px-4 py-2.5 text-stone-600">
                  {log.affectedCompany?.name ?? '-'}
                </td>
                <td className="px-4 py-2.5 text-stone-600">
                  {log.entityType}
                  {log.entityId ? ` #${log.entityId}` : ''}
                </td>
                <td className="max-w-[16rem] px-4 py-2.5 text-stone-600">
                  {log.reason || '-'}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-stone-600">
                  {log.ipAddress || '-'}
                </td>
                <td
                  className="whitespace-nowrap px-4 py-2.5 text-stone-600"
                  title={log.userAgent ?? undefined}
                >
                  {truncate(log.userAgent)}
                </td>
                <td className="px-4 py-2.5">
                  <MetadataView metadata={log.metadata} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
