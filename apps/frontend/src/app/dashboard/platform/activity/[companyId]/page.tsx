'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import {
  getCompanyActivity,
  getCompanySessions,
  revokeAllCompanySessions,
  revokeAllUserSessions,
  revokeSession,
} from '@/lib/activity';
import { getPlatformCompany } from '@/lib/platform';
import { useAuthStore } from '@/store/auth.store';
import {
  CompanyActivityStatus,
  DeviceType,
  UserSessionStatus,
} from '@/types';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

type Tab = 'resumen' | 'usuarios' | 'actividad' | 'sesiones';

const TABS: { id: Tab; label: string }[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'usuarios', label: 'Usuarios' },
  { id: 'actividad', label: 'Actividad' },
  { id: 'sesiones', label: 'Sesiones y dispositivos' },
];

const activityStatusLabels: Record<CompanyActivityStatus, string> = {
  ACTIVE_TODAY: 'Activa hoy',
  ACTIVE_WEEK: 'Activa esta semana',
  ACTIVE_MONTH: 'Activa este mes',
  INACTIVE: 'Inactiva (30+ días)',
};

const activityStatusColors: Record<CompanyActivityStatus, string> = {
  ACTIVE_TODAY: 'bg-emerald-50 text-emerald-700',
  ACTIVE_WEEK: 'bg-sky-50 text-sky-700',
  ACTIVE_MONTH: 'bg-amber-50 text-amber-700',
  INACTIVE: 'bg-stone-100 text-stone-500',
};

const sessionStatusLabels: Record<UserSessionStatus, string> = {
  ACTIVE: 'Activa',
  LOGGED_OUT: 'Cerrada',
  REVOKED: 'Revocada',
  EXPIRED: 'Vencida',
};

const sessionStatusColors: Record<UserSessionStatus, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  LOGGED_OUT: 'bg-stone-100 text-stone-500',
  REVOKED: 'bg-red-50 text-red-700',
  EXPIRED: 'bg-stone-100 text-stone-400',
};

const deviceTypeLabels: Record<DeviceType, string> = {
  DESKTOP: 'Escritorio',
  MOBILE: 'Móvil',
  TABLET: 'Tablet',
  UNKNOWN: 'Desconocido',
};

function formatDateTime(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('es-CO', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function DailyLoginsChart({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  return (
    <div>
      <div className="flex items-end gap-1" style={{ height: 120 }}>
        {data.map((d, i) => {
          const heightPct = (d.count / max) * 100;
          return (
            <div
              key={d.date}
              className="group relative flex-1"
              style={{ height: '100%' }}
              onMouseEnter={() => setHoverIndex(i)}
              onMouseLeave={() => setHoverIndex(null)}
            >
              <div className="absolute bottom-0 flex w-full flex-col items-center justify-end" style={{ height: '100%' }}>
                {hoverIndex === i && (
                  <div className="mb-1 whitespace-nowrap rounded bg-stone-900 px-1.5 py-0.5 text-[10px] text-white">
                    {d.count} {d.count === 1 ? 'acceso' : 'accesos'}
                  </div>
                )}
                <div
                  className="w-full rounded-t bg-stone-700 transition-colors group-hover:bg-stone-900"
                  style={{ height: `${Math.max(heightPct, d.count > 0 ? 4 : 1)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1 text-[10px] text-stone-400">
        {data.map((d, i) => (
          <div key={d.date} className="flex-1 text-center">
            {i % 2 === 0
              ? new Date(d.date).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' })
              : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CompanyActivityDetailPage() {
  const params = useParams<{ companyId: string }>();
  const companyId = params.companyId;
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isPlatformSuperAdmin =
    user?.role === 'SUPER_ADMIN' && user?.companyId === null;

  const [tab, setTab] = useState<Tab>('resumen');
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<
    | { type: 'session'; sessionId: string }
    | { type: 'user'; userId: string; userName: string }
    | { type: 'company' }
    | null
  >(null);

  const [sessionFilters, setSessionFilters] = useState<{
    userId: string;
    status: UserSessionStatus | '';
    deviceType: DeviceType | '';
    page: number;
  }>({ userId: '', status: '', deviceType: '', page: 1 });

  const { data: company } = useQuery({
    queryKey: ['platform-company', companyId],
    queryFn: () => getPlatformCompany(companyId),
    enabled: isPlatformSuperAdmin && !!companyId,
  });

  const {
    data: activity,
    isLoading: activityLoading,
    isError: activityError,
  } = useQuery({
    queryKey: ['platform-company-activity', companyId],
    queryFn: () => getCompanyActivity(companyId),
    enabled: isPlatformSuperAdmin && !!companyId,
  });

  const {
    data: sessionsPage,
    isLoading: sessionsLoading,
    isError: sessionsError,
  } = useQuery({
    queryKey: ['platform-company-sessions', companyId, sessionFilters],
    queryFn: () =>
      getCompanySessions(companyId, {
        page: sessionFilters.page,
        pageSize: 20,
        userId: sessionFilters.userId || undefined,
        status: sessionFilters.status || undefined,
        deviceType: sessionFilters.deviceType || undefined,
      }),
    enabled: isPlatformSuperAdmin && !!companyId && tab === 'sesiones',
  });

  const usersNeverLoggedInIds = useMemo(() => {
    if (!activity || !activity.hasHistoricalData) return new Set<string>();
    return new Set(activity.usersNeverLoggedIn.map((u) => u.id));
  }, [activity]);

  function invalidateActivity() {
    queryClient.invalidateQueries({ queryKey: ['platform-company-activity', companyId] });
    queryClient.invalidateQueries({ queryKey: ['platform-company-sessions', companyId] });
    queryClient.invalidateQueries({ queryKey: ['platform-activity-summary'] });
  }

  async function handleRevokeSession(sessionId: string) {
    setActionError('');
    setRevokingId(sessionId);
    try {
      await revokeSession(sessionId);
      setActionMessage('Sesión revocada.');
      invalidateActivity();
    } catch {
      setActionError('No se pudo revocar la sesión.');
    } finally {
      setRevokingId(null);
    }
  }

  async function handleRevokeAllForUser(userId: string) {
    setActionError('');
    setRevokingId(userId);
    try {
      const result = await revokeAllUserSessions(userId);
      setActionMessage(`${result.revokedCount} sesión(es) revocada(s) para este usuario.`);
      invalidateActivity();
    } catch {
      setActionError('No se pudieron revocar las sesiones del usuario.');
    } finally {
      setRevokingId(null);
    }
  }

  async function handleRevokeAllForCompany() {
    setActionError('');
    setRevokingId('company');
    try {
      const result = await revokeAllCompanySessions(companyId);
      setActionMessage(`${result.revokedCount} sesión(es) revocada(s) en toda la empresa.`);
      invalidateActivity();
    } catch {
      setActionError('No se pudieron revocar las sesiones de la empresa.');
    } finally {
      setRevokingId(null);
    }
  }

  if (!isPlatformSuperAdmin) {
    return (
      <div>
        <h2 className="text-xl font-semibold text-stone-900">Actividad de la empresa</h2>
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
      <button
        onClick={() => router.push('/dashboard/platform/companies')}
        className="mb-3 flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800"
      >
        <ArrowLeft size={15} />
        Volver a empresas
      </button>

      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-stone-900">
            {company?.name ?? 'Actividad de la empresa'}
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            Actividad, sesiones y dispositivos reconocidos.
          </p>
        </div>
        {activity?.hasHistoricalData && (
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${activityStatusColors[activity.activityStatus]}`}
          >
            {activityStatusLabels[activity.activityStatus]}
          </span>
        )}
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-stone-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'border-stone-900 text-stone-900'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {actionMessage && <p className="mb-3 text-sm text-emerald-600">{actionMessage}</p>}
      {actionError && <p className="mb-3 text-sm text-red-600">{actionError}</p>}

      {activityLoading && (
        <div className="rounded-lg border border-stone-200 bg-white p-6 text-center text-sm text-stone-400">
          Cargando...
        </div>
      )}
      {!activityLoading && activityError && (
        <div className="rounded-lg border border-stone-200 bg-white p-6 text-center text-sm text-red-600">
          No se pudo cargar la actividad de esta empresa.
        </div>
      )}

      {!activityLoading && !activityError && activity && !activity.hasHistoricalData && tab !== 'usuarios' && tab !== 'sesiones' && (
        <div className="rounded-lg border border-stone-200 bg-white p-6 text-center text-sm text-stone-500">
          {activity.message}
        </div>
      )}

      {!activityLoading &&
        !activityError &&
        activity &&
        tab === 'resumen' &&
        (activity.hasHistoricalData ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <SummaryTile label="Última actividad" value={formatDateTime(activity.lastActivityAt)} />
            <SummaryTile label="Usuarios totales" value={String(activity.totalUsers)} />
            <SummaryTile label="Activos 7 días" value={String(activity.usersActive7d)} />
            <SummaryTile label="Activos 30 días" value={String(activity.usersActive30d)} />
            <SummaryTile label="Activos 90 días" value={String(activity.usersActive90d)} />
            <SummaryTile label="Nunca ingresaron" value={String(activity.usersNeverLoggedIn.length)} />
            <SummaryTile label="Sesiones activas" value={String(activity.activeSessions)} />
            <SummaryTile label="Dispositivos reconocidos" value={String(activity.recognizedDevices)} />
          </div>
        ) : null)}

      {!activityLoading && !activityError && tab === 'usuarios' && (
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50 text-left text-xs text-stone-500">
                <th className="px-4 py-2.5 font-medium">Usuario</th>
                <th className="px-4 py-2.5 font-medium">Rol</th>
                <th className="px-4 py-2.5 font-medium">Estado</th>
                <th className="px-4 py-2.5 font-medium">Ingresó alguna vez</th>
                <th className="px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {(company?.users.items ?? []).map((u) => {
                const neverLoggedIn = usersNeverLoggedInIds.has(u.id);
                return (
                  <tr key={u.id} className="border-b border-stone-100 last:border-0">
                    <td className="px-4 py-2.5 text-stone-800">
                      {u.name}
                      <div className="text-xs text-stone-400">{u.email}</div>
                    </td>
                    <td className="px-4 py-2.5 text-stone-600">{u.role}</td>
                    <td className="px-4 py-2.5 text-stone-600">
                      {u.isActive ? 'Activo' : 'Inactivo'}
                    </td>
                    <td className="px-4 py-2.5 text-stone-600">
                      {activity?.hasHistoricalData === false
                        ? 'Sin información histórica disponible'
                        : neverLoggedIn
                          ? 'Nunca ha ingresado'
                          : 'Sí'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {!neverLoggedIn && (
                        <button
                          onClick={() => setConfirmTarget({ type: 'user', userId: u.id, userName: u.name })}
                          disabled={revokingId === u.id}
                          className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          Cerrar todas sus sesiones
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {(company?.users.items ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-stone-400">
                    No hay usuarios.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!activityLoading && !activityError && activity && tab === 'actividad' && activity.hasHistoricalData && (
        <div className="space-y-4">
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-medium text-stone-700">
              Accesos exitosos por día (últimos 14 días)
            </h3>
            <DailyLoginsChart data={activity.dailyHistory} />
          </div>

          <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-left text-xs text-stone-500">
                  <th className="px-4 py-2.5 font-medium">Usuario</th>
                  <th className="px-4 py-2.5 font-medium">Fecha</th>
                  <th className="px-4 py-2.5 font-medium">IP</th>
                  <th className="px-4 py-2.5 font-medium">Navegador</th>
                  <th className="px-4 py-2.5 font-medium">Sistema</th>
                  <th className="px-4 py-2.5 font-medium">Dispositivo</th>
                </tr>
              </thead>
              <tbody>
                {activity.recentLogins.map((l) => (
                  <tr key={l.id} className="border-b border-stone-100 last:border-0">
                    <td className="px-4 py-2.5 text-stone-800">{l.user.name}</td>
                    <td className="px-4 py-2.5 text-stone-600">{formatDateTime(l.createdAt)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-stone-600">
                      {l.ipPreview ?? '-'}
                    </td>
                    <td className="px-4 py-2.5 text-stone-600">{l.browser ?? '-'}</td>
                    <td className="px-4 py-2.5 text-stone-600">{l.operatingSystem ?? '-'}</td>
                    <td className="px-4 py-2.5 text-stone-600">
                      {deviceTypeLabels[l.deviceType]}
                    </td>
                  </tr>
                ))}
                {activity.recentLogins.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-stone-400">
                      Sin accesos recientes.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'sesiones' && (
        <div>
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <input
                type="text"
                placeholder="Filtrar por userId"
                value={sessionFilters.userId}
                onChange={(e) =>
                  setSessionFilters((f) => ({ ...f, userId: e.target.value, page: 1 }))
                }
                className="rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
              />
              <select
                value={sessionFilters.status}
                onChange={(e) =>
                  setSessionFilters((f) => ({
                    ...f,
                    status: e.target.value as UserSessionStatus | '',
                    page: 1,
                  }))
                }
                className="rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
              >
                <option value="">Todos los estados</option>
                <option value="ACTIVE">Activa</option>
                <option value="LOGGED_OUT">Cerrada</option>
                <option value="REVOKED">Revocada</option>
                <option value="EXPIRED">Vencida</option>
              </select>
              <select
                value={sessionFilters.deviceType}
                onChange={(e) =>
                  setSessionFilters((f) => ({
                    ...f,
                    deviceType: e.target.value as DeviceType | '',
                    page: 1,
                  }))
                }
                className="rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
              >
                <option value="">Todos los dispositivos</option>
                <option value="DESKTOP">Escritorio</option>
                <option value="MOBILE">Móvil</option>
                <option value="TABLET">Tablet</option>
                <option value="UNKNOWN">Desconocido</option>
              </select>
            </div>

            <button
              onClick={() => setConfirmTarget({ type: 'company' })}
              disabled={revokingId === 'company'}
              className="rounded-md px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Cerrar todas las sesiones de la empresa
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-left text-xs text-stone-500">
                  <th className="px-4 py-2.5 font-medium">Usuario</th>
                  <th className="px-4 py-2.5 font-medium">Dispositivo</th>
                  <th className="px-4 py-2.5 font-medium">Navegador</th>
                  <th className="px-4 py-2.5 font-medium">Sistema</th>
                  <th className="px-4 py-2.5 font-medium">IP</th>
                  <th className="px-4 py-2.5 font-medium">Primera vez</th>
                  <th className="px-4 py-2.5 font-medium">Último acceso</th>
                  <th className="px-4 py-2.5 font-medium">Última actividad</th>
                  <th className="px-4 py-2.5 font-medium">Estado</th>
                  <th className="px-4 py-2.5 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {sessionsLoading && (
                  <tr>
                    <td colSpan={10} className="px-4 py-6 text-center text-stone-400">
                      Cargando...
                    </td>
                  </tr>
                )}
                {!sessionsLoading && sessionsError && (
                  <tr>
                    <td colSpan={10} className="px-4 py-6 text-center text-red-600">
                      No se pudo cargar el listado de sesiones.
                    </td>
                  </tr>
                )}
                {!sessionsLoading && !sessionsError && (sessionsPage?.items.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-6 text-center text-stone-400">
                      No hay sesiones para estos filtros.
                    </td>
                  </tr>
                )}
                {sessionsPage?.items.map((s) => (
                  <tr key={s.id} className="border-b border-stone-100 last:border-0">
                    <td className="px-4 py-2.5 text-stone-800">
                      {s.user.name}
                      <div className="text-xs text-stone-400">{s.user.email}</div>
                    </td>
                    <td className="px-4 py-2.5 text-stone-600">{deviceTypeLabels[s.deviceType]}</td>
                    <td className="px-4 py-2.5 text-stone-600">{s.browser ?? '-'}</td>
                    <td className="px-4 py-2.5 text-stone-600">{s.operatingSystem ?? '-'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-stone-600">
                      {s.ipPreview ?? '-'}
                    </td>
                    <td className="px-4 py-2.5 text-stone-600">{formatDateTime(s.firstSeenAt)}</td>
                    <td className="px-4 py-2.5 text-stone-600">{formatDateTime(s.lastLoginAt)}</td>
                    <td className="px-4 py-2.5 text-stone-600">
                      {formatDateTime(s.lastActivityAt)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${sessionStatusColors[s.status]}`}
                      >
                        {sessionStatusLabels[s.status]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {s.status === 'ACTIVE' && (
                        <button
                          onClick={() => setConfirmTarget({ type: 'session', sessionId: s.id })}
                          disabled={revokingId === s.id}
                          className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          Revocar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {sessionsPage && sessionsPage.totalPages > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm text-stone-500">
              <span>
                Página {sessionsPage.page} de {sessionsPage.totalPages} ({sessionsPage.total}{' '}
                sesiones)
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setSessionFilters((f) => ({ ...f, page: f.page - 1 }))}
                  disabled={sessionsPage.page <= 1}
                  className="rounded-md border border-stone-300 px-2.5 py-1 text-xs disabled:opacity-40"
                >
                  Anterior
                </button>
                <button
                  onClick={() => setSessionFilters((f) => ({ ...f, page: f.page + 1 }))}
                  disabled={sessionsPage.page >= sessionsPage.totalPages}
                  className="rounded-md border border-stone-300 px-2.5 py-1 text-xs disabled:opacity-40"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {confirmTarget?.type === 'session' && (
        <ConfirmDialog
          title="Revocar sesión"
          message="¿Revocar esta sesión? El usuario deberá iniciar sesión de nuevo en ese dispositivo."
          confirmLabel="Revocar"
          onClose={() => setConfirmTarget(null)}
          onConfirm={async () => {
            await handleRevokeSession(confirmTarget.sessionId);
            setConfirmTarget(null);
          }}
        />
      )}

      {confirmTarget?.type === 'user' && (
        <ConfirmDialog
          title="Cerrar todas las sesiones del usuario"
          message={
            <>
              ¿Cerrar todas las sesiones activas de{' '}
              <span className="font-medium text-stone-900">{confirmTarget.userName}</span>? Deberá
              iniciar sesión de nuevo en todos sus dispositivos.
            </>
          }
          confirmLabel="Cerrar sesiones"
          onClose={() => setConfirmTarget(null)}
          onConfirm={async () => {
            await handleRevokeAllForUser(confirmTarget.userId);
            setConfirmTarget(null);
          }}
        />
      )}

      {confirmTarget?.type === 'company' && (
        <ConfirmDialog
          title="Cerrar todas las sesiones de la empresa"
          message={
            <>
              ¿Cerrar <span className="font-medium text-stone-900">todas</span> las sesiones
              activas de{' '}
              <span className="font-medium text-stone-900">{company?.name ?? 'esta empresa'}</span>
              ? Todos los usuarios deberán iniciar sesión de nuevo.
            </>
          }
          confirmLabel="Cerrar todas"
          onClose={() => setConfirmTarget(null)}
          onConfirm={async () => {
            await handleRevokeAllForCompany();
            setConfirmTarget(null);
          }}
        />
      )}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="text-xs text-stone-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-stone-900">{value}</div>
    </div>
  );
}
