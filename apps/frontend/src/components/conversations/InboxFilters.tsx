'use client';

import { Search, X } from 'lucide-react';
import type { ContadoresBandeja, FiltrosBandeja } from '@/lib/conversations';
import { PESTANAS, pestanaActiva, type CambiosDeBandeja } from '@/lib/inbox-url';

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
  textoBusqueda,
  onBuscar,
  onChange,
}: {
  filtros: FiltrosBandeja;
  contadores?: ContadoresBandeja;
  /**
   * Lo que hay escrito AHORA en el campo. Se separa de `filtros.search` —que
   * es lo ya aplicado— porque la búsqueda viaja a la URL con retardo: leer el
   * valor aplicado haría que el campo pareciera trabado al teclear.
   */
  textoBusqueda?: string;
  onBuscar?: (texto: string) => void;
  /** Cambios sobre el estado de la URL. La pantalla decide cómo navegar. */
  onChange: (cambios: CambiosDeBandeja) => void;
}) {
  const pestanas = PESTANAS.map((p) => ({
    ...p,
    total: contadores?.[p.contador],
  }));

  const activa = pestanaActiva(filtros);
  const valorBusqueda = textoBusqueda ?? filtros.search ?? '';
  const hayFiltrosExtra = Boolean(valorBusqueda || filtros.status);

  return (
    <div className="border-b border-neutral-200 bg-white">
      {/* Las pestanas SE ENVUELVEN, no se desplazan.
          La columna de la bandeja mide 288 px y las cuatro no caben en una
          linea: con `overflow-x-auto` quedaban recortadas y con flechas, es
          decir, dos de los cuatro filtros principales invisibles hasta que
          alguien descubriera que la barra se desplaza. Dos filas de pestanas
          en una columna estrecha no molestan; un filtro que no se ve, si. */}
      <div className="flex flex-wrap gap-1 px-2 pt-2">
        {pestanas.map((p) => (
          <button
            key={p.clave}
            type="button"
            onClick={() => onChange({ pestana: p.clave })}
            aria-current={activa === p.clave ? 'true' : undefined}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
              activa === p.clave
                ? 'bg-neutral-100 text-neutral-900'
                : 'text-neutral-500 hover:bg-neutral-50'
            }`}
          >
            {p.etiqueta}
            {p.total !== undefined && p.total > 0 && (
              <span
                className={`rounded-full px-1.5 text-[10px] ${
                  p.clave === 'sinleer'
                    ? 'bg-secondary-500 text-brand-primary'
                    : 'bg-neutral-200 text-neutral-600'
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
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400"
          />
          <input
            value={valorBusqueda}
            onChange={(e) =>
              onBuscar
                ? onBuscar(e.target.value)
                : onChange({ search: e.target.value })
            }
            placeholder="Buscar por nombre o teléfono"
            aria-label="Buscar conversaciones"
            className="w-full rounded-md border border-neutral-300 py-1.5 pl-7 pr-2 text-xs text-neutral-900 outline-none focus:border-neutral-500"
          />
        </div>

        <select
          value={filtros.status ?? ''}
          onChange={(e) => onChange({ status: e.target.value })}
          aria-label="Estado"
          className="rounded-md border border-neutral-300 px-2 py-1.5 text-xs text-neutral-900 outline-none focus:border-neutral-500"
        >
          {ESTADOS.map((e) => (
            <option key={e.valor} value={e.valor}>
              {e.etiqueta}
            </option>
          ))}
        </select>

        {hayFiltrosExtra && (
          <button
            type="button"
            onClick={() => {
              onBuscar?.('');
              onChange({ search: '', status: '' });
            }}
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-neutral-500 hover:bg-neutral-100"
          >
            <X size={12} />
            Limpiar
          </button>
        )}
      </div>
    </div>
  );
}
