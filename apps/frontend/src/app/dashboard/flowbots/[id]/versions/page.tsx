'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, GitCompare, History, RotateCcw } from 'lucide-react';
import { flowbots } from '@/lib/flowbots';
import { permisosDe } from '@/lib/flowbot-permisos';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ListState, mensajeDeError } from '@/components/ui/ListState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export default function VersionesPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const rol = useAuthStore((s) => s.user?.role);
  const permisos = permisosDe(rol);

  const [comparando, setComparando] = useState<string[]>([]);
  const [restaurando, setRestaurando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const versiones = useQuery({
    queryKey: ['flowbots', id, 'versions'],
    queryFn: () => flowbots.versiones(id),
  });

  const diferencias = useQuery({
    queryKey: ['flowbots', id, 'diff', comparando[0], comparando[1]],
    queryFn: () => flowbots.comparar(id, comparando[0], comparando[1]),
    enabled: comparando.length === 2,
  });

  function alternarComparacion(versionId: string) {
    setComparando((previo) => {
      if (previo.includes(versionId)) {
        return previo.filter((v) => v !== versionId);
      }
      // Comparar más de dos no significa nada: se sustituye la más antigua.
      return previo.length >= 2
        ? [previo[1], versionId]
        : [...previo, versionId];
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <Link
          href={`/dashboard/flowbots/${id}`}
          className="inline-flex items-center gap-1 text-xs text-neutral-500 outline-none hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-line-focus"
        >
          <ArrowLeft size={14} />
          Volver al bot
        </Link>
        <h2 className="mt-1 text-xl font-semibold text-neutral-900">
          Historial de versiones
        </h2>
        <p className="text-sm text-neutral-500">
          Cada publicación congela el flujo tal y como estaba. Ninguna se puede
          editar después.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      <ListState
        isLoading={versiones.isLoading}
        isError={versiones.isError}
        isEmpty={(versiones.data?.length ?? 0) === 0}
        error={versiones.error}
        onRetry={() => void versiones.refetch()}
        icon={History}
        emptyMessage="Todavía no has publicado ninguna versión de este bot."
        loadingMessage="Cargando el historial…"
      />

      {comparando.length === 2 && (
        <section className="rounded-lg border border-neutral-200 bg-white p-3">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
            <GitCompare size={14} />
            Qué cambió entre las dos
          </h3>
          {diferencias.isLoading && (
            <p className="mt-1 text-xs text-neutral-500">Comparando…</p>
          )}
          {diferencias.data && (
            <div className="mt-2 space-y-1 text-xs">
              {diferencias.data.identicos ? (
                <p className="text-neutral-600">
                  Son idénticas salvo por dónde está dibujado cada paso, que no
                  cambia lo que hace el bot.
                </p>
              ) : (
                <>
                  <Cambio
                    etiqueta="Pasos añadidos"
                    valores={diferencias.data.nodos.agregados}
                    tono="success"
                  />
                  <Cambio
                    etiqueta="Pasos quitados"
                    valores={diferencias.data.nodos.eliminados}
                    tono="error"
                  />
                  <Cambio
                    etiqueta="Pasos cambiados"
                    valores={diferencias.data.nodos.modificados.map(
                      (m) => `${m.id} (${m.campos.join(', ')})`,
                    )}
                    tono="warning"
                  />
                  <Cambio
                    etiqueta="Conexiones añadidas"
                    valores={diferencias.data.conexiones.agregadas}
                    tono="success"
                  />
                  <Cambio
                    etiqueta="Conexiones quitadas"
                    valores={diferencias.data.conexiones.eliminadas}
                    tono="error"
                  />
                </>
              )}
            </div>
          )}
        </section>
      )}

      <ul className="space-y-2">
        {(versiones.data ?? []).map((v) => (
          <li
            key={v.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-3"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-neutral-900">
                  Versión {v.version}
                </span>
                {v.esActual && <Badge tone="success">En uso</Badge>}
              </div>
              <p className="text-xs text-neutral-500">
                {new Date(v.publishedAt).toLocaleString('es')}
                {v.publishedBy ? ` · ${v.publishedBy}` : ''} · {v.ejecuciones}{' '}
                {v.ejecuciones === 1 ? 'ejecución' : 'ejecuciones'}
              </p>
              {v.publishNote && (
                <p className="mt-0.5 text-xs text-neutral-600">
                  {v.publishNote}
                </p>
              )}
              <p className="mt-0.5 font-mono text-[10px] text-neutral-400">
                {v.compiledHash.slice(0, 12)}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant={comparando.includes(v.id) ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => alternarComparacion(v.id)}
              >
                {comparando.includes(v.id) ? 'Quitar' : 'Comparar'}
              </Button>
              {permisos.puedeEditar && !v.esActual && (
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => setRestaurando(v.id)}
                >
                  <RotateCcw size={13} />
                  Restaurar
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {restaurando && (
        <ConfirmDialog
          title="Restaurar esta versión"
          // Restaurar NO republica: crea un borrador. Si lo hiciera, volver
          // atrás pondría a hablar con clientes una versión vieja sin que
          // nadie la hubiera revisado antes.
          message="Se copiará al borrador para que puedas revisarla y cambiarla. El bot sigue atendiendo con la versión que está en uso hasta que publiques otra vez."
          confirmLabel="Restaurar como borrador"
          onClose={() => setRestaurando(null)}
          onConfirm={async () => {
            setError(null);
            try {
              await flowbots.restaurarVersion(id, restaurando);
              await queryClient.invalidateQueries({ queryKey: ['flowbots'] });
              setRestaurando(null);
              router.push(`/dashboard/flowbots/${id}/edit`);
            } catch (e) {
              setError(mensajeDeError(e) || 'No se pudo restaurar la versión.');
              setRestaurando(null);
            }
          }}
        />
      )}
    </div>
  );
}

function Cambio({
  etiqueta,
  valores,
  tono,
}: {
  etiqueta: string;
  valores: string[];
  tono: 'success' | 'error' | 'warning';
}) {
  if (valores.length === 0) return null;
  const color =
    tono === 'success'
      ? 'text-status-success'
      : tono === 'error'
        ? 'text-status-error'
        : 'text-status-warning';

  return (
    <p className={color}>
      <span className="font-medium">{etiqueta}:</span>{' '}
      <span className="font-mono">{valores.join(', ')}</span>
    </p>
  );
}
