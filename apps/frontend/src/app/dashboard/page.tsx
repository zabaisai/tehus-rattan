'use client';

import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp,
  Target,
  Trophy,
  XCircle,
  Clock,
  MessageSquare,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import {
  getOverview,
  getLeadsByStage,
  getAgentPerformance,
  getLostReasons,
  getOverdueTasksCount,
  getPendingConversationsCount,
} from '@/lib/analytics';
import { StatCard } from '@/components/dashboard/StatCard';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(value);
}

export default function DashboardHomePage() {
  const user = useAuthStore((s) => s.user);

  const { data: overview } = useQuery({ queryKey: ['analytics-overview'], queryFn: getOverview });
  const { data: byStage } = useQuery({ queryKey: ['analytics-stages'], queryFn: getLeadsByStage });
  const { data: agents } = useQuery({ queryKey: ['analytics-agents'], queryFn: getAgentPerformance });
  const { data: lostReasons } = useQuery({ queryKey: ['analytics-lost'], queryFn: getLostReasons });
  const { data: overdueTasks } = useQuery({ queryKey: ['analytics-overdue'], queryFn: getOverdueTasksCount });
  const { data: pendingConvs } = useQuery({ queryKey: ['analytics-pending'], queryFn: getPendingConversationsCount });

  const maxStageValue = Math.max(...(byStage?.map((s) => s.totalValue) || [1]), 1);

  return (
    <div>
      <h2 className="text-xl font-semibold text-stone-900">Hola, {user?.name ?? ''}</h2>
      <p className="mt-1 text-sm text-stone-500">Resumen general de Tehus Rattan.</p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Leads este mes"
          value={String(overview?.leadsThisMonth ?? '—')}
          icon={TrendingUp}
        />
        <StatCard
          label="Valor abierto"
          value={overview ? formatCurrency(overview.openValue) : '—'}
          icon={Target}
        />
        <StatCard
          label="Valor ganado"
          value={overview ? formatCurrency(overview.wonValue) : '—'}
          icon={Trophy}
          accent="text-emerald-600"
        />
        <StatCard
          label="Conversión"
          value={overview ? `${overview.conversionRate}%` : '—'}
          icon={XCircle}
        />
        <StatCard
          label="Tareas vencidas"
          value={String(overdueTasks ?? '—')}
          icon={Clock}
          accent={overdueTasks && overdueTasks > 0 ? 'text-red-600' : undefined}
        />
        <StatCard
          label="Conversaciones pendientes"
          value={String(pendingConvs ?? '—')}
          icon={MessageSquare}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-stone-800">Leads por etapa</h3>
          {!byStage || byStage.length === 0 ? (
            <p className="text-sm text-stone-400">Sin datos.</p>
          ) : (
            <div className="space-y-2.5">
              {byStage.map((stage) => (
                <div key={stage.stageId}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-stone-700">{stage.stageName}</span>
                    <span className="text-stone-400">
                      {stage.count} · {formatCurrency(stage.totalValue)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-stone-100">
                    <div
                      className="h-1.5 rounded-full bg-stone-800"
                      style={{
                        width: `${Math.max((stage.totalValue / maxStageValue) * 100, stage.count > 0 ? 4 : 0)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-stone-800">Rendimiento por asesor</h3>
          {!agents || agents.length === 0 ? (
            <p className="text-sm text-stone-400">Sin datos.</p>
          ) : (
            <div className="space-y-2">
              {agents.map((agent) => (
                <div
                  key={agent.agentId}
                  className="flex items-center justify-between border-b border-stone-100 pb-2 text-sm last:border-0"
                >
                  <span className="text-stone-700">{agent.agentName}</span>
                  <div className="flex items-center gap-3 text-xs text-stone-500">
                    <span>{agent.openLeads} abiertos</span>
                    <span className="text-emerald-600">{agent.wonCount} ganados</span>
                    <span className="font-medium text-stone-800">
                      {formatCurrency(agent.wonValue)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {lostReasons && lostReasons.length > 0 && (
          <div className="rounded-lg border border-stone-200 bg-white p-4 lg:col-span-2">
            <h3 className="mb-3 text-sm font-semibold text-stone-800">Motivos de pérdida</h3>
            <div className="flex flex-wrap gap-2">
              {lostReasons.map((item) => (
                <span
                  key={item.reason}
                  className="rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-600"
                >
                  {item.reason} ({item.count})
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}