'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarClock,
  FileText,
  MessageSquare,
  Percent,
  Target,
  TrendingUp,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import {
  getOverview,
  getLeadsByStage,
  getAgentPerformance,
  getOverdueTasksCount,
} from '@/lib/analytics';
import { getMyCompany } from '@/lib/companies';
import { getTasks } from '@/lib/tasks';
import { getNotifications } from '@/lib/notifications';
import { Avatar } from '@/components/ui/Avatar';
import { ForbiddenState } from '@/components/ui/ForbiddenState';
import { MetricCard } from '@/components/ui/MetricCard';
import { Panel, esSinPermiso } from '@/components/ui/Panel';
import { Skeleton } from '@/components/ui/Skeleton';

const dinero = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

/** Cifras grandes en las tarjetas: «$ 48,2 M» se lee de un vistazo. */
function dineroCorto(v: number): string {
  if (Math.abs(v) >= 1_000_000) {
    return `$ ${(v / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;
  }
  return dinero.format(v);
}

function saludo(hora: number): string {
  if (hora < 12) return 'Buenos días';
  if (hora < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

const HORA = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit' });

export default function DashboardHomePage() {
  const user = useAuthStore((s) => s.user);

  // El subtítulo nombra a la empresa conectada, nunca un inquilino fijo. Un
  // SUPER_ADMIN de plataforma (sin empresa) se redirige antes de montar esto,
  // así que aquí no se consulta.
  const { data: company } = useQuery({
    queryKey: ['company-me'],
    queryFn: getMyCompany,
    enabled: !!user?.companyId,
  });
  const subtitle = company
    ? `Resumen general de ${company.name}.`
    : 'Resumen general.';

  // `analytics` es ADMIN/SUPER_ADMIN entero. Para los demás roles no se
  // consulta siquiera: pedirlo para recibir un 403 llena la consola de errores
  // y hace parpadear la pantalla antes de enseñar el estado correcto.
  const puedeVerMetricas =
    user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  const overview = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: getOverview,
    enabled: puedeVerMetricas,
  });
  const porEtapa = useQuery({
    queryKey: ['analytics-stages'],
    queryFn: getLeadsByStage,
    enabled: puedeVerMetricas,
  });
  const asesores = useQuery({
    queryKey: ['analytics-agents'],
    queryFn: getAgentPerformance,
    enabled: puedeVerMetricas,
  });
  const vencidas = useQuery({
    queryKey: ['analytics-overdue'],
    queryFn: getOverdueTasksCount,
    enabled: puedeVerMetricas,
  });

  // Tareas y notificaciones las ve cualquier usuario de la empresa: son los
  // dos bloques que sostienen el Inicio de un asesor.
  const tareas = useQuery({ queryKey: ['tasks'], queryFn: getTasks });
  const actividad = useQuery({
    queryKey: ['notifications', 'inicio'],
    queryFn: () => getNotifications({ limit: 6 }),
  });

  const abiertas = porEtapa.data?.reduce((s, e) => s + e.count, 0) ?? 0;
  const valorEtapaMaximo = Math.max(
    1,
    ...(porEtapa.data?.map((e) => e.totalValue) ?? [1]),
  );

  const proximas = (tareas.data ?? [])
    .filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS')
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
    .slice(0, 5);

  return (
    <div className="mx-auto max-w-[1600px]">
      {/* Franja de bienvenida: es lo primero que se ve y lleva las dos acciones
          que más se repiten en un día. Navy de marca, con el naranja reservado
          para el acento de la acción secundaria. */}
      <section className="flex flex-col gap-4 rounded-xl bg-surface-inverse px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold text-white">
            {saludo(new Date().getHours())}
            {user?.name ? `, ${user.name}` : ''}
          </h2>
          <p className="mt-0.5 truncate text-sm text-white/70">{subtitle}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            href="/dashboard/conversations"
            className="inline-flex items-center gap-2 rounded-md border border-white/25 px-3.5 py-2 text-sm font-medium text-white outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-primary"
          >
            <MessageSquare size={16} aria-hidden="true" />
            Abrir conversaciones
          </Link>
          <Link
            href="/dashboard/quotes"
            className="inline-flex items-center gap-2 rounded-md bg-brand-secondary px-3.5 py-2 text-sm font-medium text-brand-primary outline-none transition-colors hover:bg-secondary-600 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-primary"
          >
            <FileText size={16} aria-hidden="true" />
            Ver cotizaciones
          </Link>
        </div>
      </section>

      {/* Métricas. Cada una enlaza a donde se actúa sobre ella. */}
      {puedeVerMetricas ? (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            etiqueta="Oportunidades abiertas"
            valor={porEtapa.isLoading ? '' : abiertas}
            cargando={porEtapa.isLoading}
            icono={Target}
            href="/dashboard/pipeline"
            hrefLabel="Abrir el embudo"
          />
          <MetricCard
            etiqueta="Valor abierto"
            valor={overview.data ? dineroCorto(overview.data.openValue) : ''}
            cargando={overview.isLoading}
            icono={TrendingUp}
            href="/dashboard/pipeline"
            hrefLabel="Abrir el embudo"
          />
          <MetricCard
            etiqueta="Conversión"
            valor={
              overview.data
                ? `${overview.data.conversionRate.toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`
                : ''
            }
            cargando={overview.isLoading}
            icono={Percent}
            href="/dashboard/pipeline"
            hrefLabel="Abrir el embudo"
          />
          <MetricCard
            etiqueta="Tareas vencidas"
            valor={vencidas.isLoading ? '' : (vencidas.data ?? 0)}
            cargando={vencidas.isLoading}
            icono={CalendarClock}
            href="/dashboard/tasks"
            hrefLabel="Abrir tareas"
            tono={(vencidas.data ?? 0) > 0 ? 'atencion' : 'neutral'}
          />
        </div>
      ) : (
        <ForbiddenState
          className="mt-4"
          titulo="Las métricas de la empresa son para administradores"
          detalle="Tu agenda y tu actividad siguen abajo. Si necesitas el resumen comercial, pídeselo a un administrador."
        />
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* Embudo comercial */}
        <Panel
          titulo="Embudo comercial"
          accion={{ href: '/dashboard/pipeline', etiqueta: 'Ver embudo' }}
          cargando={porEtapa.isLoading}
          sinPermiso={!puedeVerMetricas || esSinPermiso(porEtapa.error)}
          detalleSinPermiso="Solo un administrador ve el resumen por etapa."
          error={esSinPermiso(porEtapa.error) ? undefined : porEtapa.error}
          vacio={(porEtapa.data?.length ?? 0) === 0}
          mensajeVacio="Todavía no hay oportunidades en el embudo."
          className="xl:col-span-5"
        >
          <ul className="space-y-2.5">
            {porEtapa.data?.map((etapa) => (
              <li key={etapa.stageId}>
                <Link
                  href={`/dashboard/pipeline?etapa=${encodeURIComponent(etapa.stageId)}`}
                  className="block rounded-md px-2 py-1.5 outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-line-focus"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm text-content-primary">
                      {etapa.stageName}
                    </span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-content-secondary">
                      {etapa.count} · {dineroCorto(etapa.totalValue)}
                    </span>
                  </span>
                  {/* La barra es una comparación, no un adorno: la cifra ya
                      está escrita al lado, así que va `aria-hidden`. */}
                  <span
                    aria-hidden="true"
                    className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-neutral-100"
                  >
                    <span
                      className="block h-full rounded-full bg-brand-primary transition-all"
                      style={{
                        width: `${Math.max(3, (etapa.totalValue / valorEtapaMaximo) * 100)}%`,
                      }}
                    />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>

        {/* Agenda de hoy — visible para cualquier rol */}
        <Panel
          titulo="Agenda de hoy"
          accion={{ href: '/dashboard/tasks', etiqueta: 'Ver todas' }}
          cargando={tareas.isLoading}
          error={tareas.error}
          vacio={proximas.length === 0}
          mensajeVacio="No tienes tareas pendientes."
          className="xl:col-span-4"
        >
          <ul className="space-y-1">
            {proximas.map((t) => (
              <li key={t.id}>
                <Link
                  href="/dashboard/tasks"
                  className="flex items-start gap-2.5 rounded-md px-2 py-2 outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-line-focus"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-content-primary">
                      {t.title}
                    </span>
                    <span className="block truncate text-xs text-content-secondary">
                      {t.contact?.name ?? t.lead?.title ?? 'Sin vincular'}
                    </span>
                  </span>
                  {t.dueDate && (
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-content-secondary">
                      {HORA.format(new Date(t.dueDate))}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>

        {/* Actividad reciente — se apoya en notificaciones, que ya traen
            `actionUrl`. Construir un feed nuevo habría duplicado un contrato
            que existe, está acotado por empresa y ya lleva enlaces profundos. */}
        <Panel
          titulo="Actividad reciente"
          accion={{ href: '/dashboard/notifications', etiqueta: 'Ver toda' }}
          cargando={actividad.isLoading}
          error={actividad.error}
          vacio={(actividad.data?.items.length ?? 0) === 0}
          mensajeVacio="Sin actividad todavía."
          className="xl:col-span-3"
        >
          <ul className="space-y-1">
            {actividad.data?.items.map((n) => (
              <li key={n.id}>
                <Link
                  href={n.actionUrl ?? '/dashboard/notifications'}
                  className="block rounded-md px-2 py-2 outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-line-focus"
                >
                  <span className="block truncate text-sm text-content-primary">
                    {n.title}
                  </span>
                  {n.bodyPreview && (
                    <span className="block truncate text-xs text-content-secondary">
                      {n.bodyPreview}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>

        {/* Rendimiento por asesor */}
        <Panel
          titulo="Rendimiento por asesor"
          cargando={asesores.isLoading}
          sinPermiso={!puedeVerMetricas || esSinPermiso(asesores.error)}
          detalleSinPermiso="Solo un administrador ve el rendimiento del equipo."
          error={esSinPermiso(asesores.error) ? undefined : asesores.error}
          vacio={(asesores.data?.length ?? 0) === 0}
          mensajeVacio="Todavía no hay actividad de asesores."
          className="xl:col-span-12"
        >
          <ul className="divide-y divide-line-default">
            {asesores.data?.map((a) => (
              <li
                key={a.agentId}
                className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                {/* Iniciales, nunca una fotografía: es una regla del plan. */}
                <Avatar nombre={a.agentName} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm text-content-primary">
                  {a.agentName}
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-content-secondary">
                  {a.openLeads} abiertos
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-status-success-strong">
                  {a.wonCount} ganados
                </span>
                <span className="hidden shrink-0 font-mono text-xs tabular-nums text-content-primary sm:inline">
                  {dineroCorto(a.wonValue)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {/* Reserva el alto del pie para que el scroll no salte al cargar. */}
      {tareas.isLoading && <Skeleton className="mt-4 h-1 w-full opacity-0" />}
    </div>
  );
}
