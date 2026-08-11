'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Check,
  LogIn,
  Plus,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import {
  createPipeline,
  createStage,
  deleteStage,
  getPipelines,
  reorderStages,
  updatePipeline,
  updateStage,
} from '@/lib/pipeline';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { mensajeDeError } from '@/components/ui/ListState';
import { RetirarEmbudoDialog } from '@/components/pipeline/RetirarEmbudoDialog';
import type { Pipeline, PipelineStage } from '@/types';

const COLORES = [
  '#131C4A',
  '#FF6A00',
  '#0F766E',
  '#B45309',
  '#7C3AED',
  '#B91C1C',
  '#64748B',
];

/**
 * Administrar los embudos.
 *
 * VARIOS EMBUDOS, no uno. Una empresa vende y además da soporte, o vende dos
 * cosas con procesos distintos; meterlo todo en un tablero obliga a inventar
 * etapas que no significan nada en la mitad de los casos.
 *
 * LA ETAPA DE ENTRADA SE MARCA A MANO. Es donde cae quien acaba de escribir
 * por primera vez, y no se adivina por el nombre: llamarla «Nuevo lead» es una
 * costumbre. El servidor garantiza que hay exactamente una.
 */
export function AdminPipelines({ onCerrar }: { onCerrar: () => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);

  const { data: pipelines } = useQuery({
    queryKey: ['pipelines'],
    queryFn: getPipelines,
  });

  async function conAviso(accion: () => Promise<unknown>, respaldo: string) {
    setError(null);
    try {
      await accion();
      await queryClient.invalidateQueries({ queryKey: ['pipelines'] });
      await queryClient.invalidateQueries({ queryKey: ['kanban'] });
      return true;
    } catch (e) {
      // El servidor devuelve el motivo con nombre y apellidos —«esa etapa
      // tiene oportunidades», «es la etapa de entrada»—; sustituirlo por un
      // «no se pudo» genérico esconde justo lo que hay que hacer.
      setError(mensajeDeError(e) || respaldo);
      return false;
    }
  }

  return (
    <Modal title="Embudos" onClose={onCerrar} maxWidth="lg">
      <div className="space-y-3">
        {error && (
          <p
            role="alert"
            className="rounded-md border border-status-error/20 bg-status-error-surface px-3 py-2 text-xs text-status-error"
          >
            {error}
          </p>
        )}

        <ul className="space-y-2">
          {(pipelines ?? []).map((p, i) => (
            <FilaPipeline
              key={p.id}
              pipeline={p}
              esPrimero={i === 0}
              esUltimo={i === (pipelines?.length ?? 1) - 1}
              abierto={abierto === p.id}
              onAbrir={() => setAbierto(abierto === p.id ? null : p.id)}
              onAccion={conAviso}
              vecino={(dir) => (pipelines ?? [])[i + dir]}
            />
          ))}
        </ul>

        {creando ? (
          <div className="flex items-center gap-2 rounded-lg border border-neutral-200 p-2.5">
            <input
              autoFocus
              value={nombreNuevo}
              onChange={(e) => setNombreNuevo(e.target.value)}
              placeholder="Nombre del embudo"
              aria-label="Nombre del embudo"
              className="flex-1 rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
            />
            <Button
              variant="accent"
              size="sm"
              disabled={!nombreNuevo.trim()}
              onClick={async () => {
                const ok = await conAviso(
                  () => createPipeline({ name: nombreNuevo.trim() }),
                  'No se pudo crear el embudo.',
                );
                if (ok) {
                  setNombreNuevo('');
                  setCreando(false);
                }
              }}
            >
              Crear
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setCreando(false)}>
              Cancelar
            </Button>
          </div>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setCreando(true)}>
            <Plus size={14} />
            Nuevo embudo
          </Button>
        )}
      </div>
    </Modal>
  );
}

function FilaPipeline({
  pipeline,
  esPrimero,
  esUltimo,
  abierto,
  onAbrir,
  onAccion,
  vecino,
}: {
  pipeline: Pipeline;
  esPrimero: boolean;
  esUltimo: boolean;
  abierto: boolean;
  onAbrir: () => void;
  onAccion: (a: () => Promise<unknown>, r: string) => Promise<boolean>;
  vecino: (dir: -1 | 1) => Pipeline | undefined;
}) {
  const [renombrando, setRenombrando] = useState(false);
  const [retirando, setRetirando] = useState(false);
  const [nombre, setNombre] = useState(pipeline.name);

  /** Intercambia el orden con el vecino: mover uno solo dejaría empates. */
  async function mover(dir: -1 | 1) {
    const otro = vecino(dir);
    if (!otro) return;
    const mio = pipeline.order ?? 0;
    const suyo = otro.order ?? 0;
    await onAccion(async () => {
      await updatePipeline(pipeline.id, { order: suyo });
      await updatePipeline(otro.id, { order: mio });
    }, 'No se pudo cambiar el orden.');
  }

  return (
    <li className="rounded-lg border border-neutral-200">
      <div className="flex flex-wrap items-center gap-2 p-2.5">
        {renombrando ? (
          <>
            <input
              autoFocus
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              aria-label={`Nombre de ${pipeline.name}`}
              className="flex-1 rounded-md border border-neutral-300 px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
            />
            <Button
              variant="quiet"
              size="sm"
              aria-label="Guardar el nombre"
              onClick={async () => {
                const ok = await onAccion(
                  () => updatePipeline(pipeline.id, { name: nombre.trim() }),
                  'No se pudo renombrar el embudo.',
                );
                if (ok) setRenombrando(false);
              }}
            >
              <Check size={14} />
            </Button>
            <Button
              variant="quiet"
              size="sm"
              aria-label="Descartar el cambio"
              onClick={() => {
                setNombre(pipeline.name);
                setRenombrando(false);
              }}
            >
              <X size={14} />
            </Button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onAbrir}
              aria-expanded={abierto}
              className="flex-1 text-left text-sm font-medium text-neutral-900 outline-none hover:text-brand-primary focus-visible:ring-2 focus-visible:ring-line-focus"
            >
              {pipeline.name}
              <span className="ml-2 text-xs font-normal text-neutral-400">
                {pipeline.stages.length}{' '}
                {pipeline.stages.length === 1 ? 'etapa' : 'etapas'}
              </span>
            </button>

            {pipeline.isDefault && <Badge tone="accent">Por defecto</Badge>}

            <Button
              variant="quiet"
              size="sm"
              aria-label={`Subir ${pipeline.name}`}
              disabled={esPrimero}
              onClick={() => void mover(-1)}
            >
              <ArrowUp size={13} />
            </Button>
            <Button
              variant="quiet"
              size="sm"
              aria-label={`Bajar ${pipeline.name}`}
              disabled={esUltimo}
              onClick={() => void mover(1)}
            >
              <ArrowDown size={13} />
            </Button>
            {!pipeline.isDefault && (
              <Button
                variant="quiet"
                size="sm"
                aria-label={`Poner ${pipeline.name} por defecto`}
                onClick={() =>
                  void onAccion(
                    () => updatePipeline(pipeline.id, { isDefault: true }),
                    'No se pudo cambiar el embudo por defecto.',
                  )
                }
              >
                <Star size={13} />
              </Button>
            )}
            <Button variant="quiet" size="sm" onClick={() => setRenombrando(true)}>
              Renombrar
            </Button>
            {/*
              Abre el diálogo de retiro en vez de llamar a `deletePipeline`
              directo. Antes, un embudo con oportunidades devolvía un error
              genérico —«no se pudo eliminar»— sin decir que dentro había
              trabajo de todo un equipo ni ofrecer a dónde moverlo.
            */}
            <Button
              variant="quiet"
              size="sm"
              aria-label={`Retirar ${pipeline.name}`}
              title="Retirar embudo"
              onClick={() => setRetirando(true)}
            >
              <Trash2 size={13} />
            </Button>
          </>
        )}
      </div>

      {abierto && <Etapas pipeline={pipeline} onAccion={onAccion} />}

      {retirando && (
        <RetirarEmbudoDialog
          pipeline={pipeline}
          onClose={() => setRetirando(false)}
          onDone={async (mensaje) => {
            setRetirando(false);
            // Se reutiliza `onAccion` para que el listado se refresque por el
            // mismo camino que el resto de operaciones: el traslado pudo
            // cambiar varios embudos a la vez, no solo este.
            await onAccion(async () => mensaje, '');
          }}
        />
      )}
    </li>
  );
}

function Etapas({
  pipeline,
  onAccion,
}: {
  pipeline: Pipeline;
  onAccion: (a: () => Promise<unknown>, r: string) => Promise<boolean>;
}) {
  const [nueva, setNueva] = useState('');

  async function mover(etapa: PipelineStage, dir: -1 | 1) {
    const ordenadas = [...pipeline.stages].sort((a, b) => a.order - b.order);
    const i = ordenadas.findIndex((e) => e.id === etapa.id);
    const otra = ordenadas[i + dir];
    if (!otra) return;

    await onAccion(
      () =>
        reorderStages(pipeline.id, [
          { id: etapa.id, order: otra.order },
          { id: otra.id, order: etapa.order },
        ]),
      'No se pudo cambiar el orden de las etapas.',
    );
  }

  return (
    <div className="space-y-1.5 border-t border-neutral-200 p-2.5">
      {pipeline.stages.map((etapa, i) => (
        <div
          key={etapa.id}
          className="flex flex-wrap items-center gap-2 rounded-md bg-neutral-50 px-2 py-1.5"
        >
          <span
            aria-hidden="true"
            className="h-3 w-3 shrink-0 rounded-full border border-black/10"
            style={{ backgroundColor: etapa.color ?? '#94a3b8' }}
          />
          <span className="flex-1 text-xs text-neutral-800">{etapa.name}</span>

          {etapa.isInitial && (
            <Badge tone="success">
              <LogIn size={10} />
              Entrada
            </Badge>
          )}
          {typeof etapa.probability === 'number' && (
            <span className="text-[10px] text-neutral-500">
              {etapa.probability}%
            </span>
          )}

          <select
            value={etapa.color ?? ''}
            aria-label={`Color de ${etapa.name}`}
            onChange={(e) =>
              void onAccion(
                () =>
                  updateStage(pipeline.id, etapa.id, { color: e.target.value }),
                'No se pudo cambiar el color.',
              )
            }
            className="rounded border border-neutral-300 px-1 py-0.5 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
          >
            <option value="">Color…</option>
            {COLORES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <input
            type="number"
            min={0}
            max={100}
            defaultValue={etapa.probability ?? undefined}
            aria-label={`Probabilidad de ${etapa.name}`}
            placeholder="%"
            onBlur={(e) => {
              const v = e.target.value;
              if (v === '') return;
              void onAccion(
                () =>
                  updateStage(pipeline.id, etapa.id, {
                    probability: Number(v),
                  }),
                'No se pudo cambiar la probabilidad.',
              );
            }}
            className="w-12 rounded border border-neutral-300 px-1 py-0.5 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
          />

          {!etapa.isInitial && (
            <Button
              variant="quiet"
              size="sm"
              onClick={() =>
                void onAccion(
                  () =>
                    updateStage(pipeline.id, etapa.id, { isInitial: true }),
                  'No se pudo marcar la etapa de entrada.',
                )
              }
            >
              Marcar entrada
            </Button>
          )}

          <Button
            variant="quiet"
            size="sm"
            aria-label={`Subir ${etapa.name}`}
            disabled={i === 0}
            onClick={() => void mover(etapa, -1)}
          >
            <ArrowUp size={12} />
          </Button>
          <Button
            variant="quiet"
            size="sm"
            aria-label={`Bajar ${etapa.name}`}
            disabled={i === pipeline.stages.length - 1}
            onClick={() => void mover(etapa, 1)}
          >
            <ArrowDown size={12} />
          </Button>
          <Button
            variant="quiet"
            size="sm"
            aria-label={`Eliminar ${etapa.name}`}
            onClick={() =>
              void onAccion(
                () => deleteStage(pipeline.id, etapa.id),
                'No se pudo eliminar la etapa.',
              )
            }
          >
            <Trash2 size={12} />
          </Button>
        </div>
      ))}

      <div className="flex items-center gap-2">
        <input
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          placeholder="Nombre de la etapa"
          aria-label={`Nueva etapa en ${pipeline.name}`}
          className="flex-1 rounded-md border border-neutral-300 px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={!nueva.trim()}
          onClick={async () => {
            const ok = await onAccion(
              () =>
                createStage(pipeline.id, {
                  name: nueva.trim(),
                  // La primera etapa de un embudo nuevo es su entrada: sin
                  // ella, el primer cliente caería en «la primera por orden»,
                  // que es una regla de reserva y no una decisión.
                  isInitial: pipeline.stages.length === 0,
                }),
              'No se pudo crear la etapa.',
            );
            if (ok) setNueva('');
          }}
        >
          <Plus size={13} />
          Añadir etapa
        </Button>
      </div>
    </div>
  );
}
