'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  Pause,
  Play,
  RotateCcw,
  UserRound,
  XCircle,
} from 'lucide-react';
import { flowbots, ESTADO_EJECUCION } from '@/lib/flowbots';
import { permisosDe } from '@/lib/flowbot-permisos';
import { useAuthStore } from '@/store/auth.store';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ListState, mensajeDeError } from '@/components/ui/ListState';
import { formatearDuracion } from '@/components/flowbots/ListaEjecuciones';

type Operacion = 'cancelar' | 'pausar' | 'reanudar' | 'reintentar' | 'handoff';

const OPERACIONES: Record<
  Operacion,
  { titulo: string; explicacion: string; pideMotivo: boolean; etiqueta: string }
> = {
  cancelar: {
    titulo: 'Cancelar esta ejecución',
    explicacion:
      'El bot deja de atender esta conversación ahora mismo. Lo que ya se envió no se puede deshacer, y si el cliente escribe otra vez el bot no le contestará hasta que empiece una conversación nueva.',
    pideMotivo: true,
    etiqueta: 'Cancelar la ejecución',
  },
  pausar: {
    titulo: 'Pausar esta ejecución',
    explicacion:
      'Se queda donde está sin avanzar. Las esperas siguen contando, así que un tiempo de espera puede vencer mientras está pausada.',
    pideMotivo: false,
    etiqueta: 'Pausar',
  },
  reanudar: {
    titulo: 'Reanudar esta ejecución',
    explicacion: 'El bot sigue desde el paso en el que se quedó.',
    pideMotivo: false,
    etiqueta: 'Reanudar',
  },
  reintentar: {
    titulo: 'Reintentar el paso que falló',
    explicacion:
      'Si el último paso llegó a completarse, el efecto ya ocurrió y no se repite: la ejecución pasa a revisión en vez de mandar el mismo mensaje dos veces.',
    pideMotivo: false,
    etiqueta: 'Reintentar',
  },
  handoff: {
    titulo: 'Pasar a una persona',
    explicacion:
      'El bot deja de contestar y la conversación queda para que la atienda alguien del equipo.',
    pideMotivo: true,
    etiqueta: 'Pasar a una persona',
  },
};

export default function DetalleEjecucionPage() {
  const { executionId } = useParams<{ executionId: string }>();
  const queryClient = useQueryClient();
  const rol = useAuthStore((s) => s.user?.role);
  const permisos = permisosDe(rol);

  const [operacion, setOperacion] = useState<Operacion | null>(null);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ejecutando, setEjecutando] = useState(false);

  const consulta = useQuery({
    queryKey: ['flowbots', 'execution', executionId],
    queryFn: () => flowbots.ejecucion(executionId),
    refetchInterval: (q) =>
      // Una ejecución terminada no cambia nunca más: seguir preguntando es
      // gastar batería y cuota para leer siempre lo mismo.
      ['COMPLETED', 'CANCELLED', 'FAILED'].includes(
        q.state.data?.estado ?? '',
      )
        ? false
        : 15_000,
  });

  async function ejecutar() {
    if (!operacion) return;
    setError(null);
    setEjecutando(true);
    try {
      if (operacion === 'cancelar') {
        await flowbots.cancelarEjecucion(executionId, motivo.trim());
      } else if (operacion === 'pausar') {
        await flowbots.pausarEjecucion(executionId);
      } else if (operacion === 'reanudar') {
        await flowbots.reanudarEjecucion(executionId);
      } else if (operacion === 'reintentar') {
        await flowbots.reintentarEjecucion(executionId);
      } else {
        await flowbots.forzarHandoff(executionId, { motivo: motivo.trim() });
      }
      await queryClient.invalidateQueries({
        queryKey: ['flowbots', 'execution', executionId],
      });
      setOperacion(null);
      setMotivo('');
    } catch (e) {
      setError(mensajeDeError(e) || 'No se pudo completar la operación.');
    } finally {
      setEjecutando(false);
    }
  }

  if (consulta.isLoading || consulta.isError || !consulta.data) {
    return (
      <ListState
        isLoading={consulta.isLoading}
        isError={consulta.isError}
        isEmpty={false}
        error={consulta.error}
        onRetry={() => void consulta.refetch()}
        emptyMessage=""
        loadingMessage="Cargando la ejecución…"
      />
    );
  }

  const e = consulta.data;
  const estilo = ESTADO_EJECUCION[e.estado] ?? {
    etiqueta: e.estado,
    tono: 'neutral' as const,
  };
  const viva = !['COMPLETED', 'CANCELLED', 'FAILED'].includes(e.estado);

  return (
    <div className="space-y-5">
      <div>
        <Link
          href={`/dashboard/flowbots/${e.botId}/executions`}
          className="inline-flex items-center gap-1 text-xs text-neutral-500 outline-none hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-line-focus"
        >
          <ArrowLeft size={14} />
          Volver a las ejecuciones
        </Link>

        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold text-neutral-900">
                {e.contacto ?? 'Sin contacto'}
              </h2>
              <Badge tone={estilo.tono}>{estilo.etiqueta}</Badge>
            </div>
            <p className="text-sm text-neutral-500">
              {e.botNombre}
              {e.version ? ` · versión ${e.version}` : ''} ·{' '}
              {new Date(e.iniciadaEn).toLocaleString('es')}
            </p>
          </div>

          {permisos.puedeIntervenir && (
            <div className="flex flex-wrap gap-2">
              {viva && (
                <>
                  {e.estado === 'PAUSED' ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setOperacion('reanudar')}
                    >
                      <Play size={13} />
                      Reanudar
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setOperacion('pausar')}
                    >
                      <Pause size={13} />
                      Pausar
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setOperacion('handoff')}
                  >
                    <UserRound size={13} />
                    Pasar a una persona
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setOperacion('cancelar')}
                  >
                    <XCircle size={13} />
                    Cancelar
                  </Button>
                </>
              )}
              {(e.estado === 'FAILED' || e.estado === 'NEEDS_ATTENTION') && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setOperacion('reintentar')}
                >
                  <RotateCcw size={13} />
                  Reintentar
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-status-error/20 bg-status-error-surface px-3 py-2 text-sm text-status-error"
        >
          {error}
        </p>
      )}

      {e.necesitaAtencion && (
        <p className="flex items-start gap-2 rounded-md border border-status-error bg-status-error-surface px-3 py-2 text-sm text-status-error">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          Esta ejecución quedó a medias y no se puede reintentar sola porque no
          se sabe si el último paso llegó a hacerse. Revísala antes de decidir.
        </p>
      )}

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Dato etiqueta="Pasos" valor={e.pasos} />
        <Dato
          etiqueta="Duración"
          valor={e.duracionMs === null ? 'En curso' : formatearDuracion(e.duracionMs)}
        />
        <Dato etiqueta="Error" valor={e.errorCode ?? '—'} />
        <Dato etiqueta="Handoff" valor={e.hayHandoff ? 'Sí' : 'No'} />
      </dl>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-neutral-900">
          Por dónde pasó
        </h3>
        <ol className="space-y-1">
          {e.pasos_detalle.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs"
            >
              <Badge
                tone={
                  p.estado === 'OK'
                    ? 'success'
                    : p.estado === 'FAILED'
                      ? 'error'
                      : 'neutral'
                }
              >
                {p.estado}
              </Badge>
              <span className="font-mono text-neutral-700">{p.nodeId}</span>
              <span className="text-neutral-500">{p.nodeType}</span>
              {p.puertoSalida && (
                <span className="text-neutral-500">→ {p.puertoSalida}</span>
              )}
              {p.intento > 1 && (
                <span className="text-status-warning">
                  intento {p.intento}
                </span>
              )}
              {p.errorCode && (
                <span className="text-status-error">{p.errorCode}</span>
              )}
              <span className="ml-auto text-neutral-400">
                {new Date(p.en).toLocaleTimeString('es')}
                {p.duracionMs !== null ? ` · ${p.duracionMs} ms` : ''}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {e.esperas.length > 0 && (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
            <Clock size={14} />
            Esperas
          </h3>
          <ul className="space-y-1">
            {e.esperas.map((w) => (
              <li
                key={w.id}
                className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-700"
              >
                {w.tipo} en <span className="font-mono">{w.resumeNodeId}</span>
                {w.wakeAt
                  ? ` · vence ${new Date(w.wakeAt).toLocaleString('es')}`
                  : ''}
                {w.consumidaEn ? ' · ya se resolvió' : ' · sigue esperando'}
              </li>
            ))}
          </ul>
        </section>
      )}

      {e.handoff && (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
            <UserRound size={14} />
            Atención de una persona
          </h3>
          <p className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-700">
            {e.handoff.estado}
            {e.handoff.motivo ? ` · ${e.handoff.motivo}` : ''} · desde{' '}
            {new Date(e.handoff.iniciadoEn).toLocaleString('es')}
          </p>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold text-neutral-900">
          Datos de la conversación
        </h3>
        {/* Vienen redactados del servidor: tokens y credenciales no llegan
            hasta aquí, porque esta pantalla la abre soporte y se comparte en
            capturas. */}
        <dl className="space-y-0.5 rounded-md border border-neutral-200 bg-white p-3 font-mono text-[11px]">
          {Object.entries(e.variables).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="text-neutral-500">{k}</dt>
              <dd className="min-w-0 break-all text-neutral-800">
                {String(v)}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-1 font-mono text-[10px] text-neutral-400">
          correlationId: {e.correlationId}
        </p>
      </section>

      {operacion && (
        <Modal
          title={OPERACIONES[operacion].titulo}
          onClose={() => setOperacion(null)}
          maxWidth="sm"
        >
          <div className="space-y-3 text-sm">
            {/* Se dice QUÉ va a pasar antes de hacerlo. «¿Seguro?» no informa
                de nada y la respuesta siempre es que sí. */}
            <p className="text-neutral-600">
              {OPERACIONES[operacion].explicacion}
            </p>

            {OPERACIONES[operacion].pideMotivo && (
              <label className="block">
                <span className="text-xs font-medium text-neutral-700">
                  Por qué
                </span>
                <textarea
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  rows={2}
                  maxLength={300}
                  className="mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
                />
                <span className="text-[10px] text-neutral-400">
                  Queda registrado junto a la acción.
                </span>
              </label>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOperacion(null)}>
                Volver
              </Button>
              <Button
                variant={operacion === 'cancelar' ? 'danger' : 'primary'}
                onClick={() => void ejecutar()}
                disabled={
                  ejecutando ||
                  (OPERACIONES[operacion].pideMotivo && !motivo.trim())
                }
              >
                {ejecutando ? 'Aplicando…' : OPERACIONES[operacion].etiqueta}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: number | string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <dt className="text-[10px] uppercase tracking-wide text-neutral-400">
        {etiqueta}
      </dt>
      <dd className="text-sm font-semibold text-neutral-900">{valor}</dd>
    </div>
  );
}
