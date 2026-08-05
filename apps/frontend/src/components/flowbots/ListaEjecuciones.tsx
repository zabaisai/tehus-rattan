'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ListOrdered, Search } from 'lucide-react';
import { flowbots, ESTADO_EJECUCION } from '@/lib/flowbots';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ListState } from '@/components/ui/ListState';

const ESTADOS = [
  { id: '', etiqueta: 'Todas' },
  { id: 'RUNNING', etiqueta: 'En curso' },
  { id: 'WAITING_INPUT', etiqueta: 'Esperando respuesta' },
  { id: 'COMPLETED', etiqueta: 'Terminadas' },
  { id: 'FAILED', etiqueta: 'Con error' },
  { id: 'HANDED_OFF', etiqueta: 'Con una persona' },
  { id: 'NEEDS_ATTENTION', etiqueta: 'Necesitan revisión' },
];

/**
 * El listado de ejecuciones.
 *
 * PAGINADO POR CURSOR, no por número de página. Mientras se lee la página 1
 * entran ejecuciones nuevas: con desplazamiento numérico, la página 2 repite
 * filas que ya se vieron y se salta otras sin que nadie lo note.
 */
export function ListaEjecuciones({
  botId,
  estadoInicial = '',
}: {
  botId?: string;
  estadoInicial?: string;
}) {
  const [estado, setEstado] = useState(estadoInicial);
  const [busqueda, setBusqueda] = useState('');

  const consulta = useInfiniteQuery({
    queryKey: ['flowbots', 'executions', botId ?? 'todas', estado, busqueda],
    queryFn: ({ pageParam }) =>
      flowbots.ejecuciones(
        {
          ...(botId ? { botId } : {}),
          ...(estado ? { estado } : {}),
          ...(busqueda.trim() ? { q: busqueda.trim() } : {}),
        },
        { cursor: pageParam as string | undefined, limite: 25 },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (ultima) => ultima.siguienteCursor ?? undefined,
    // Las ejecuciones en curso cambian solas; sin esto hay que recargar para
    // ver si la espera terminó.
    refetchInterval: 20_000,
  });

  const items = (consulta.data?.pages ?? []).flatMap((p) => p.items);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400"
          />
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por contacto o identificador"
            aria-label="Buscar ejecuciones"
            className="w-full rounded-md border border-neutral-300 py-2 pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
          />
        </div>

        <label className="flex items-center gap-1.5 text-xs text-neutral-500">
          Estado
          <select
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
            className="rounded-md border border-neutral-300 px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
          >
            {ESTADOS.map((e) => (
              <option key={e.id} value={e.id}>
                {e.etiqueta}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ListState
        isLoading={consulta.isLoading}
        isError={consulta.isError}
        isEmpty={items.length === 0}
        error={consulta.error}
        onRetry={() => void consulta.refetch()}
        icon={ListOrdered}
        emptyMessage={
          estado || busqueda
            ? 'Ninguna ejecución coincide con lo que buscas.'
            : 'Todavía no hay ejecuciones.'
        }
        loadingMessage="Cargando ejecuciones…"
      />

      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-xs">
            <thead>
              <tr className="border-b border-neutral-200 text-[10px] uppercase tracking-wide text-neutral-400">
                <th className="px-2 py-1.5 font-medium">Contacto</th>
                {!botId && <th className="px-2 py-1.5 font-medium">Bot</th>}
                <th className="px-2 py-1.5 font-medium">Estado</th>
                <th className="px-2 py-1.5 font-medium">Pasos</th>
                <th className="px-2 py-1.5 font-medium">Empezó</th>
                <th className="px-2 py-1.5 font-medium">Duración</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => {
                const estilo = ESTADO_EJECUCION[e.estado] ?? {
                  etiqueta: e.estado,
                  tono: 'neutral' as const,
                };
                return (
                  <tr
                    key={e.id}
                    className="border-b border-neutral-100 hover:bg-neutral-50"
                  >
                    <td className="px-2 py-1.5">
                      <Link
                        href={`/dashboard/flowbots/executions/${e.id}`}
                        className="text-neutral-800 outline-none hover:text-brand-primary hover:underline focus-visible:ring-2 focus-visible:ring-line-focus"
                      >
                        {e.contacto ?? 'Sin contacto'}
                      </Link>
                    </td>
                    {!botId && (
                      <td className="px-2 py-1.5 text-neutral-600">
                        {e.botNombre}
                      </td>
                    )}
                    <td className="px-2 py-1.5">
                      <Badge tone={estilo.tono}>{estilo.etiqueta}</Badge>
                    </td>
                    <td className="px-2 py-1.5 text-neutral-600">{e.pasos}</td>
                    <td className="px-2 py-1.5 text-neutral-500">
                      {new Date(e.iniciadaEn).toLocaleString('es', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-2 py-1.5 text-neutral-500">
                      {e.duracionMs === null ? '—' : formatearDuracion(e.duracionMs)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {consulta.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void consulta.fetchNextPage()}
            disabled={consulta.isFetchingNextPage}
          >
            {consulta.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
          </Button>
        </div>
      )}
    </div>
  );
}

export function formatearDuracion(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const segundos = Math.round(ms / 1000);
  if (segundos < 60) return `${segundos} s`;
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return horas < 24 ? `${horas} h` : `${Math.floor(horas / 24)} días`;
}
