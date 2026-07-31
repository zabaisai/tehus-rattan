'use client';

import { Search, X } from 'lucide-react';
import type { ContadoresBandeja, FiltrosBandeja } from '@/lib/conversations';

const ESTADOS = [
  { valor: '', etiqueta: 'Todos los estados' },
  { valor: 'OPEN', etiqueta: 'Abiertas' },
  { valor: 'PENDING', etiqueta: 'Pendientes' },
  { valor: 'RESOLVED', etiqueta: 'Resueltas' },
  { valor: 'CLOSED', etiqueta: 'Cerradas' },
  { valor: 'ARCHIVED', etiqueta: 'Archivadas' },
];

/**
 * Filtros de la bandeja.
 *
 * Las pestañas de arriba son las tres preguntas que un asesor se hace nada
 * más entrar —¿qué me toca a mí?, ¿qué está sin dueño?, ¿qué no he visto?— y
 * por eso van como atajos con su contador, no escondidas en un desplegable.
 * El resto de filtros sí va en controles secundarios porque se usan de
 * cuando en cuando.
 */
export function InboxFilters({
  filtros,
  contadores,
  onChange,
}: {
  filtros: FiltrosBandeja;
  contadores?: ContadoresBandeja;
  onChange: (siguiente: FiltrosBandeja) => void;
}) {
  const pestanas = [
    { clave: 'todas', etiqueta: 'Todas', total: contadores?.total },
    { clave: 'mias', etiqueta: 'Mías', total: contadores?.mine },
    { clave: 'libres', etiqueta: 'Sin asignar', total: contadores?.unassigned },
    { clave: 'sinleer', etiqueta: 'Sin leer', total: contadores?.unread },
  ] as const;

  const activa = filtros.unread
    ? 'sinleer'
    : filtros.assigned === 'me'
      ? 'mias'
      : filtros.assigned === 'unassigned'
        ? 'libres'
        : 'todas';

  function elegirPestana(clave: (typeof pestanas)[number]['clave']) {
    // Cada pestaña reemplaza asignación y no-leídos a la vez: dejar restos de
    // la anterior produce combinaciones que el usuario no pidió y que luego
    // no sabe deshacer.
    const base = { ...filtros, assigned: undefined, unread: false };
    if (clave === 'mias') onChange({ ...base, assigned: 'me' });
    else if (clave === 'libres') onChange({ ...base, assigned: 'unassigned' });
    else if (clave === 'sinleer') onChange({ ...base, unread: true });
    else onChange(base);
  }

  const hayFiltrosExtra = Boolean(filtros.search || filtros.status);

  return (
    <div className="border-b border-stone-200 bg-white">
      <div className="flex gap-1 overflow-x-auto px-2 pt-2">
        {pestanas.map((p) => (
          <button
            key={p.clave}
            onClick={() => elegirPestana(p.clave)}
            aria-current={activa === p.clave ? 'true' : undefined}
            className={`flex shrink-0 items-center gap-1.5 rounded-t-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
              activa === p.clave
                ? 'bg-stone-100 text-stone-900'
                : 'text-stone-500 hover:bg-stone-50'
            }`}
          >
            {p.etiqueta}
            {p.total !== undefined && p.total > 0 && (
              <span
                className={`rounded-full px-1.5 text-[10px] ${
                  p.clave === 'sinleer'
                    ? 'bg-secondary-500 text-brand-primary'
                    : 'bg-stone-200 text-stone-600'
                }`}
              >
                {p.total}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-2 py-2">
        <div className="relative min-w-0 flex-1">
          <Search
            size={13}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-stone-400"
          />
          <input
            value={filtros.search ?? ''}
            onChange={(e) => onChange({ ...filtros, search: e.target.value })}
            placeholder="Buscar por nombre o teléfono"
            aria-label="Buscar conversaciones"
            className="w-full rounded-md border border-stone-300 py-1.5 pl-7 pr-2 text-xs text-stone-900 outline-none focus:border-stone-500"
          />
        </div>

        <select
          value={filtros.status ?? ''}
          onChange={(e) =>
            onChange({ ...filtros, status: e.target.value || undefined })
          }
          aria-label="Estado"
          className="rounded-md border border-stone-300 px-2 py-1.5 text-xs text-stone-900 outline-none focus:border-stone-500"
        >
          {ESTADOS.map((e) => (
            <option key={e.valor} value={e.valor}>
              {e.etiqueta}
            </option>
          ))}
        </select>

        {hayFiltrosExtra && (
          <button
            onClick={() =>
              onChange({ ...filtros, search: undefined, status: undefined })
            }
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-stone-500 hover:bg-stone-100"
          >
            <X size={12} />
            Limpiar
          </button>
        )}
      </div>
    </div>
  );
}
