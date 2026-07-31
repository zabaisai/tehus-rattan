'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, AlertTriangle } from 'lucide-react';
import {
  ACCIONES,
  DISPARADORES,
  validarAutomatizacion,
  type Accion,
  type Automatizacion,
  type TipoAccion,
} from '@/lib/automations';
import type { CompanyUser } from '@/types';

export interface BorradorAutomatizacion {
  name: string;
  trigger: string;
  conditions: { keywords?: string[] } | null;
  actions: Accion[];
  isActive: boolean;
}

const VACIO: BorradorAutomatizacion = {
  name: '',
  trigger: 'first_message',
  conditions: null,
  actions: [],
  isActive: true,
};

/**
 * Editor de automatizaciones.
 *
 * Es un editor de LISTA ORDENADA y no un lienzo de nodos a propósito: las
 * automatizaciones de este producto son "cuando pase X, haz A, luego B, luego
 * C". Un lienzo con flechas sugiere ramificaciones y bucles que el motor no
 * ejecuta, y prometer en la interfaz algo que el motor no hace es peor que no
 * ofrecerlo.
 *
 * El orden importa y se ve: las acciones se ejecutan de arriba abajo, y por
 * eso se pueden mover — no es decoración.
 */
export function AutomationEditor({
  inicial,
  asesores,
  onGuardar,
  onCancelar,
}: {
  inicial?: Automatizacion;
  asesores: Pick<CompanyUser, 'id' | 'name'>[];
  onGuardar: (borrador: BorradorAutomatizacion) => Promise<void> | void;
  onCancelar: () => void;
}) {
  const [borrador, setBorrador] = useState<BorradorAutomatizacion>(
    inicial
      ? {
          name: inicial.name,
          trigger: inicial.trigger,
          conditions: inicial.conditions,
          actions: inicial.actions ?? [],
          isActive: inicial.isActive,
        }
      : VACIO,
  );
  const [errores, setErrores] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);

  // El texto crudo de las palabras vive aparte del array ya parseado.
  //
  // NO es duplicar estado por comodidad: si el campo tomara su valor de
  // `keywords.join(', ')`, cada pulsacion volveria a renderizar el texto
  // reconstruido desde el array, y la coma recien escrita desapareceria antes
  // de poder escribir la siguiente palabra. Escribir "precio, cotizacion"
  // acababa dando "preciocotizacion", es decir: era imposible configurar mas
  // de una palabra.
  const [textoPalabras, setTextoPalabras] = useState(
    (inicial?.conditions?.keywords ?? []).join(', '),
  );

  const disparador = DISPARADORES.find((d) => d.valor === borrador.trigger);

  function actualizar(cambio: Partial<BorradorAutomatizacion>) {
    setBorrador((b) => ({ ...b, ...cambio }));
    // Los errores se limpian al tocar algo: dejarlos en pantalla mientras el
    // usuario corrige hace que parezcan de lo que acaba de escribir.
    setErrores([]);
  }

  function moverAccion(indice: number, direccion: -1 | 1) {
    const destino = indice + direccion;
    if (destino < 0 || destino >= borrador.actions.length) return;
    const siguiente = [...borrador.actions];
    [siguiente[indice], siguiente[destino]] = [
      siguiente[destino],
      siguiente[indice],
    ];
    actualizar({ actions: siguiente });
  }

  function cambiarAccion(indice: number, cambio: Partial<Accion>) {
    const siguiente = borrador.actions.map((a, i) =>
      i === indice ? { ...a, ...cambio } : a,
    );
    actualizar({ actions: siguiente });
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const problemas = validarAutomatizacion(borrador);
    if (problemas.length) {
      setErrores(problemas);
      return;
    }

    setGuardando(true);
    try {
      await onGuardar(borrador);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-4">
      <div>
        <label
          htmlFor="automatizacion-nombre"
          className="mb-1 block text-xs font-medium text-neutral-700"
        >
          Nombre
        </label>
        <input
          id="automatizacion-nombre"
          value={borrador.name}
          onChange={(e) => actualizar({ name: e.target.value })}
          placeholder="Saludo de bienvenida"
          className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm outline-none focus:border-neutral-500"
        />
      </div>

      <div>
        <label
          htmlFor="automatizacion-disparador"
          className="mb-1 block text-xs font-medium text-neutral-700"
        >
          Cuándo se ejecuta
        </label>
        <select
          id="automatizacion-disparador"
          value={borrador.trigger}
          onChange={(e) =>
            actualizar({
              trigger: e.target.value,
              // Cambiar de disparador limpia las condiciones del anterior:
              // arrastrar palabras clave a un disparador que no las usa deja
              // configuración muerta que confunde al siguiente que lo abra.
              conditions:
                e.target.value === 'keyword' ? borrador.conditions : null,
            })
          }
          className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm outline-none focus:border-neutral-500"
        >
          {DISPARADORES.map((d) => (
            <option key={d.valor} value={d.valor}>
              {d.etiqueta}
            </option>
          ))}
        </select>
        {disparador && (
          <p className="mt-1 text-xs text-neutral-500">{disparador.ayuda}</p>
        )}
      </div>

      {borrador.trigger === 'keyword' && (
        <div>
          <label
            htmlFor="automatizacion-palabras"
            className="mb-1 block text-xs font-medium text-neutral-700"
          >
            Palabras que la disparan
          </label>
          <input
            id="automatizacion-palabras"
            value={textoPalabras}
            onChange={(e) => {
              setTextoPalabras(e.target.value);
              actualizar({
                conditions: {
                  keywords: e.target.value
                    .split(',')
                    .map((p) => p.trim())
                    .filter(Boolean),
                },
              });
            }}
            placeholder="precio, cotización, cuánto vale"
            className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm outline-none focus:border-neutral-500"
          />
          <p className="mt-1 text-xs text-neutral-500">
            Separadas por comas. Basta con que aparezca una.
          </p>
        </div>
      )}

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-neutral-700">
            Qué hace, en orden
          </span>
          <button
            type="button"
            onClick={() =>
              actualizar({
                actions: [...borrador.actions, { type: 'send_message' }],
              })
            }
            className="flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
          >
            <Plus size={12} />
            Añadir acción
          </button>
        </div>

        {borrador.actions.length === 0 && (
          <p className="rounded-md border border-dashed border-neutral-300 px-3 py-4 text-center text-xs text-neutral-500">
            Sin acciones no hará nada. Añade al menos una.
          </p>
        )}

        <ol className="space-y-2">
          {borrador.actions.map((accion, i) => (
            <li
              key={i}
              className="rounded-md border border-neutral-200 bg-neutral-50 p-2"
            >
              <div className="flex items-center gap-2">
                <span className="shrink-0 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
                  {i + 1}
                </span>
                <select
                  value={accion.type}
                  onChange={(e) =>
                    // Al cambiar de tipo se descartan los campos del anterior:
                    // un mensaje colgando de una acción que ya no lo usa se
                    // guardaría y no se ejecutaría nunca.
                    cambiarAccion(i, {
                      type: e.target.value as TipoAccion,
                      message: undefined,
                      agentId: undefined,
                      stage: undefined,
                    })
                  }
                  aria-label={`Tipo de la acción ${i + 1}`}
                  className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs outline-none focus:border-neutral-500"
                >
                  {ACCIONES.map((a) => (
                    <option key={a.valor} value={a.valor}>
                      {a.etiqueta}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => moverAccion(i, -1)}
                  disabled={i === 0}
                  aria-label={`Subir la acción ${i + 1}`}
                  className="rounded p-1 text-neutral-500 hover:bg-neutral-200 disabled:opacity-30"
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => moverAccion(i, 1)}
                  disabled={i === borrador.actions.length - 1}
                  aria-label={`Bajar la acción ${i + 1}`}
                  className="rounded p-1 text-neutral-500 hover:bg-neutral-200 disabled:opacity-30"
                >
                  <ArrowDown size={13} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    actualizar({
                      actions: borrador.actions.filter((_, j) => j !== i),
                    })
                  }
                  aria-label={`Quitar la acción ${i + 1}`}
                  className="rounded p-1 text-neutral-500 hover:bg-neutral-200"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              {accion.type === 'send_message' && (
                <textarea
                  value={accion.message ?? ''}
                  onChange={(e) => cambiarAccion(i, { message: e.target.value })}
                  placeholder="Texto que recibirá el cliente"
                  aria-label={`Mensaje de la acción ${i + 1}`}
                  rows={2}
                  className="mt-2 w-full rounded-md border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-neutral-500"
                />
              )}

              {accion.type === 'assign_agent' && (
                <select
                  value={accion.agentId ?? ''}
                  onChange={(e) => cambiarAccion(i, { agentId: e.target.value })}
                  aria-label={`Asesor de la acción ${i + 1}`}
                  className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs outline-none focus:border-neutral-500"
                >
                  <option value="">Elige un asesor…</option>
                  {asesores.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}

              {accion.type === 'change_stage' && (
                <input
                  value={accion.stage ?? ''}
                  onChange={(e) => cambiarAccion(i, { stage: e.target.value })}
                  placeholder="Nombre de la etapa destino"
                  aria-label={`Etapa de la acción ${i + 1}`}
                  className="mt-2 w-full rounded-md border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-neutral-500"
                />
              )}
            </li>
          ))}
        </ol>
      </div>

      {errores.length > 0 && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-2.5"
        >
          <p className="flex items-center gap-1.5 text-xs font-medium text-red-800">
            <AlertTriangle size={13} />
            Revisa esto antes de guardar
          </p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-red-700">
            {errores.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-xs text-neutral-600">
          <input
            type="checkbox"
            checked={borrador.isActive}
            onChange={(e) => actualizar({ isActive: e.target.checked })}
            className="accent-neutral-800"
          />
          Activa
        </label>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancelar}
            className="rounded-md px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="rounded-md bg-brand-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-900 disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </form>
  );
}
