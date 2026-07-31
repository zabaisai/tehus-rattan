'use client';

import type { Pipeline } from '@/types';

/**
 * Selector de pipeline.
 *
 * El backend soporta varios desde hace tiempo, pero el tablero mostraba
 * siempre el predeterminado: quien tuviera un segundo embudo —posventa,
 * mayoristas, un canal distinto— sencillamente no podía verlo.
 *
 * Con uno solo no se dibuja nada: un desplegable de una sola opción es ruido
 * que además sugiere que falta algo por elegir.
 */
export function PipelineSelector({
  pipelines,
  value,
  onChange,
}: {
  pipelines: Pipeline[];
  value: string;
  onChange: (pipelineId: string) => void;
}) {
  if (pipelines.length < 2) return null;

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">Pipeline</span>
      <select
        aria-label="Pipeline"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-900 outline-none focus:border-stone-500"
      >
        {pipelines.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.isDefault ? ' (predeterminado)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
