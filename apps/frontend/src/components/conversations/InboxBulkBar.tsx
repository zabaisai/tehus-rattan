'use client';

import { useState } from 'react';
import { Check, UserPlus, UserMinus, MailOpen, Archive, X } from 'lucide-react';
import type { AccionMasiva } from '@/lib/conversations';
import type { User } from '@/types';

/**
 * Barra de acciones sobre varias conversaciones.
 *
 * Solo aparece cuando hay algo seleccionado: una barra siempre visible con
 * botones inertes enseña a ignorarla.
 *
 * Las acciones destructivas no están aquí. Cerrar y archivar son reversibles
 * —se cambia el estado de vuelta— y por eso pueden ser masivas; borrar no lo
 * es, y hacerlo sobre cincuenta conversaciones de golpe es justo el tipo de
 * error que no se puede deshacer.
 */
export function InboxBulkBar({
  seleccionadas,
  asesores,
  onAccion,
  onLimpiar,
}: {
  seleccionadas: string[];
  asesores: Pick<User, 'id' | 'name'>[];
  onAccion: (accion: AccionMasiva) => Promise<void> | void;
  onLimpiar: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);

  if (!seleccionadas.length) return null;

  async function ejecutar(accion: AccionMasiva) {
    if (ocupado) return;
    setOcupado(true);
    try {
      await onAccion(accion);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div
      role="toolbar"
      aria-label="Acciones sobre las conversaciones seleccionadas"
      className="flex flex-wrap items-center gap-2 border-b border-stone-200 bg-stone-100 px-3 py-2"
    >
      <span className="text-xs font-medium text-stone-700">
        {seleccionadas.length} seleccionada
        {seleccionadas.length === 1 ? '' : 's'}
      </span>

      <select
        aria-label="Asignar a"
        defaultValue=""
        disabled={ocupado}
        onChange={(e) => {
          const assignedTo = e.target.value;
          e.currentTarget.value = '';
          if (assignedTo) void ejecutar({ type: 'assign', assignedTo });
        }}
        className="rounded-md border border-stone-300 bg-white px-2 py-1 text-xs text-stone-900 outline-none focus:border-stone-500 disabled:opacity-50"
      >
        <option value="">Asignar a…</option>
        {asesores.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>

      <Boton
        icono={<UserMinus size={13} />}
        etiqueta="Quitar asignación"
        disabled={ocupado}
        onClick={() => ejecutar({ type: 'unassign' })}
      />
      <Boton
        icono={<MailOpen size={13} />}
        etiqueta="Marcar leídas"
        disabled={ocupado}
        onClick={() => ejecutar({ type: 'read' })}
      />
      <Boton
        icono={<Check size={13} />}
        etiqueta="Resolver"
        disabled={ocupado}
        onClick={() => ejecutar({ type: 'status', status: 'RESOLVED' })}
      />
      <Boton
        icono={<Archive size={13} />}
        etiqueta="Archivar"
        disabled={ocupado}
        onClick={() => ejecutar({ type: 'status', status: 'ARCHIVED' })}
      />

      <button
        onClick={onLimpiar}
        disabled={ocupado}
        className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-stone-500 hover:bg-stone-200 disabled:opacity-50"
      >
        <X size={12} />
        Cancelar
      </button>
    </div>
  );
}

function Boton({
  icono,
  etiqueta,
  onClick,
  disabled,
}: {
  icono: React.ReactNode;
  etiqueta: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 rounded-md border border-stone-300 bg-white px-2 py-1 text-xs text-stone-700 hover:bg-stone-50 disabled:opacity-50"
    >
      {icono}
      {etiqueta}
    </button>
  );
}

export { UserPlus };
