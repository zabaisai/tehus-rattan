'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  CalendarDays,
  CalendarRange,
  MonitorSmartphone,
  ShieldAlert,
  ShieldOff,
  Wifi,
} from 'lucide-react';
import { getActivitySummary } from '@/lib/activity';
import { useAuthStore } from '@/store/auth.store';

function StatCard({
  label,
  value,
  icon: Icon,
  hint,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-stone-500">{label}</span>
        <Icon size={16} className="text-stone-400" />
      </div>
      <div className="text-2xl font-semibold text-stone-900">{value}</div>
      {hint && <p className="mt-1 text-xs text-stone-400">{hint}</p>}
    </div>
  );
}

export default function PlatformActivityPage() {
  const user = useAuthStore((s) => s.user);
  const isPlatformSuperAdmin =
    user?.role === 'SUPER_ADMIN' && user?.companyId === null;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['platform-activity-summary'],
    queryFn: getActivitySummary,
    enabled: isPlatformSuperAdmin,
    // Keeps the dashboard reasonably fresh without hammering the endpoint —
    // this is a summary view, not a live feed.
    refetchInterval: 60_000,
  });

  if (!isPlatformSuperAdmin) {
    return (
      <div>
        <h2 className="text-xl font-semibold text-stone-900">Actividad y seguridad</h2>
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
        <h2 className="text-xl font-semibold text-stone-900">Actividad y seguridad</h2>
        <p className="mt-1 text-sm text-stone-500">
          Uso del CRM, sesiones y dispositivos reconocidos en todas las empresas. Para el
          detalle de una empresa, ábrela desde{' '}
          <span className="font-medium text-stone-700">Plataforma &gt; Empresas</span>{' '}
          y usa &quot;Ver actividad&quot;.
        </p>
      </div>

      {isLoading && (
        <div className="rounded-lg border border-stone-200 bg-white p-6 text-center text-sm text-stone-400">
          Cargando...
        </div>
      )}

      {!isLoading && isError && (
        <div className="rounded-lg border border-stone-200 bg-white p-6 text-center text-sm text-red-600">
          No se pudo cargar el resumen de actividad.
        </div>
      )}

      {!isLoading && !isError && data && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Empresas activas hoy"
            value={data.companiesActiveToday}
            icon={CalendarDays}
          />
          <StatCard
            label="Activas últimos 7 días"
            value={data.companiesActive7d}
            icon={CalendarRange}
          />
          <StatCard
            label="Activas últimos 30 días"
            value={data.companiesActive30d}
            icon={CalendarRange}
          />
          <StatCard
            label="Sin actividad (30+ días)"
            value={data.companiesInactive30d}
            icon={ShieldOff}
            hint={`de ${data.totalCompanies} empresas en total`}
          />
          <StatCard label="Sesiones activas" value={data.activeSessions} icon={Wifi} />
          <StatCard
            label="Dispositivos reconocidos"
            value={data.recognizedDevices}
            icon={MonitorSmartphone}
            hint="Navegadores/dispositivos, no direcciones IP"
          />
          <StatCard
            label="Intentos fallidos (24h)"
            value={data.recentFailedLogins}
            icon={ShieldAlert}
          />
          <StatCard label="Empresas totales" value={data.totalCompanies} icon={Building2} />
        </div>
      )}
    </div>
  );
}
