'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  History,
  ListOrdered,
  Pause,
  Pencil,
  Play,
} from 'lucide-react';
import { flowbots } from '@/lib/flowbots';
import { permisosDe } from '@/lib/flowbot-permisos';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ListState, mensajeDeError } from '@/components/ui/ListState';
import { EstadoBot } from '@/components/flowbots/EstadoBot';

export default function FichaBotPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const rol = useAuthStore((s) => s.user?.role);
  const permisos = permisosDe(rol);
  const [error, setError] = useState<string | null>(null);

  const bot = useQuery({
    queryKey: ['flowbots', id],
    queryFn: () => flowbots.detalle(id),
  });

  const ejecuciones = useQuery({
    queryKey: ['flowbots', id, 'executions', 'recientes'],
    queryFn: () => flowbots.ejecuciones({ botId: id }, { limite: 5 }),
    // Es donde se mira cuando algo va mal: se refresca solo.
    refetchInterval: 30_000,
  });

  async function cambiar(estado: string) {
    setError(null);
    try {
      await flowbots.cambiarEstado(id, estado);
      await queryClient.invalidateQueries({ queryKey: ['flowbots'] });
    } catch (e) {
      setError(mensajeDeError(e) || 'No se pudo cambiar el estado del bot.');
    }
  }

  if (bot.isLoading || bot.isError || !bot.data) {
    return (
      <ListState
        isLoading={bot.isLoading}
        isError={bot.isError}
        isEmpty={false}
        error={bot.error}
        onRetry={() => void bot.refetch()}
        emptyMessage=""
        loadingMessage="Cargando el bot…"
      />
    );
  }

  const b = bot.data;

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/dashboard/flowbots"
          className="inline-flex items-center gap-1 text-xs text-neutral-500 outline-none hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-line-focus"
        >
          <ArrowLeft size={14} />
          Volver a los bots
        </Link>

        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold text-neutral-900">
                {b.nombre}
              </h2>
              <EstadoBot bot={b} />
            </div>
            {b.descripcion && (
              <p className="text-sm text-neutral-500">{b.descripcion}</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {permisos.puedeActivar &&
              b.estado !== 'ARCHIVED' &&
              (b.estado === 'ACTIVE' ? (
                <Button variant="secondary" onClick={() => void cambiar('PAUSED')}>
                  <Pause size={15} />
                  Pausar
                </Button>
              ) : (
                <Button
                  variant="accent"
                  onClick={() => void cambiar('ACTIVE')}
                  disabled={!b.versionPublicada}
                  title={
                    b.versionPublicada
                      ? undefined
                      : 'Publica una versión antes de activarlo'
                  }
                >
                  <Play size={15} />
                  Activar
                </Button>
              ))}
            {permisos.puedeEditar && (
              <Link href={`/dashboard/flowbots/${id}/edit`}>
                <Button variant="primary">
                  <Pencil size={15} />
                  Editar el flujo
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Dato
          etiqueta="Versión publicada"
          valor={b.versionPublicada ?? 'Ninguna'}
        />
        <Dato etiqueta="Ejecuciones" valor={b.metricas.ejecucionesTotales} />
        <Dato
          etiqueta="Completadas"
          valor={
            b.metricas.tasaFinalizacion === null
              ? '—'
              : `${Math.round(b.metricas.tasaFinalizacion * 100)}%`
          }
        />
        <Dato etiqueta="Pasaron a una persona" valor={b.metricas.handoffs} />
      </dl>

      {b.metricas.necesitanAtencion > 0 && (
        <p className="flex items-center gap-2 rounded-md border border-status-error bg-status-error-surface px-3 py-2 text-sm text-status-error">
          <AlertTriangle size={15} />
          {b.metricas.necesitanAtencion}{' '}
          {b.metricas.necesitanAtencion === 1
            ? 'ejecución necesita'
            : 'ejecuciones necesitan'}{' '}
          que alguien las mire.
          <Link
            href={`/dashboard/flowbots/${id}/executions?estado=NEEDS_ATTENTION`}
            className="underline"
          >
            Verlas
          </Link>
        </p>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-900">
            Cuándo se dispara
          </h3>
        </div>
        {b.disparadores.length === 0 ? (
          <p className="rounded-md border border-dashed border-neutral-300 px-3 py-4 text-xs text-neutral-500">
            Sin disparadores: este bot no va a arrancar solo.
          </p>
        ) : (
          <ul className="space-y-1">
            {b.disparadores.map((d) => (
              <li
                key={d.id}
                className="flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs"
              >
                <Badge tone={d.activo ? 'success' : 'neutral'}>
                  {d.activo ? 'Activo' : 'Apagado'}
                </Badge>
                <span className="font-mono text-neutral-700">{d.tipo}</span>
                <span className="text-neutral-500">
                  Prioridad {d.prioridad}
                  {d.exclusivo ? ' · exclusivo' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-900">
            Últimas ejecuciones
          </h3>
          <Link
            href={`/dashboard/flowbots/${id}/executions`}
            className="inline-flex items-center gap-1 text-xs text-brand-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-line-focus"
          >
            <ListOrdered size={13} />
            Ver todas
          </Link>
        </div>

        <ListState
          isLoading={ejecuciones.isLoading}
          isError={ejecuciones.isError}
          isEmpty={(ejecuciones.data?.items.length ?? 0) === 0}
          error={ejecuciones.error}
          onRetry={() => void ejecuciones.refetch()}
          emptyMessage="Este bot todavía no ha atendido a nadie."
          loadingMessage="Cargando ejecuciones…"
        />

        <ul className="space-y-1">
          {(ejecuciones.data?.items ?? []).map((e) => (
            <li key={e.id}>
              <Link
                href={`/dashboard/flowbots/executions/${e.id}`}
                className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs outline-none hover:border-neutral-300 focus-visible:ring-2 focus-visible:ring-line-focus"
              >
                <span className="min-w-0 truncate text-neutral-700">
                  {e.contacto ?? 'Sin contacto'}
                </span>
                <span className="shrink-0 text-neutral-400">
                  {new Date(e.iniciadaEn).toLocaleString('es', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex gap-2">
        <Link href={`/dashboard/flowbots/${id}/versions`}>
          <Button variant="secondary" size="sm">
            <History size={14} />
            Historial de versiones
          </Button>
        </Link>
      </div>
    </div>
  );
}

function Dato({
  etiqueta,
  valor,
}: {
  etiqueta: string;
  valor: number | string;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <dt className="text-[10px] uppercase tracking-wide text-neutral-400">
        {etiqueta}
      </dt>
      <dd className="text-lg font-semibold text-neutral-900">{valor}</dd>
    </div>
  );
}
