'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Flag, Plus, Trash2 } from 'lucide-react';
import {
  TIPOS_NODO,
  nuevoIdNodo,
  validarFlujo,
  type FlujoChatbot,
  type NodoChatbot,
  type TipoNodo,
} from '@/lib/chatbot';

/**
 * Constructor de flujos de chatbot.
 *
 * Cada paso dice explícitamente a cuál va después, con un desplegable de los
 * pasos que existen. No es un lienzo con flechas: sobre un flujo de WhatsApp
 * —que es lineal con bifurcaciones en los menús— un lienzo añade la carga de
 * colocar cajas sin añadir ninguna capacidad, y encima invita a dibujar
 * ramificaciones que el motor no ejecuta.
 *
 * Elegir el destino de una lista y no escribirlo a mano es lo que hace
 * imposible el error más común: un enlace a un paso que no existe.
 */
export function ChatbotFlowEditor({
  flujo,
  onChange,
}: {
  flujo: FlujoChatbot;
  onChange: (siguiente: FlujoChatbot) => void;
}) {
  const [expandido, setExpandido] = useState<string | null>(
    flujo.nodes[0]?.id ?? null,
  );

  const problemas = useMemo(() => validarFlujo(flujo), [flujo]);
  const problemasPorNodo = useMemo(() => {
    const mapa = new Map<string, string[]>();
    for (const p of problemas) {
      if (!p.nodeId) continue;
      mapa.set(p.nodeId, [...(mapa.get(p.nodeId) ?? []), p.mensaje]);
    }
    return mapa;
  }, [problemas]);

  const ids = flujo.nodes.map((n) => n.id);

  function actualizarNodo(id: string, cambio: Partial<NodoChatbot>) {
    onChange({
      ...flujo,
      nodes: flujo.nodes.map((n) => (n.id === id ? { ...n, ...cambio } : n)),
    });
  }

  function anadirPaso() {
    const id = nuevoIdNodo(ids);
    const nuevo: NodoChatbot = { id, type: 'message', text: '' };
    onChange({
      ...flujo,
      start: flujo.nodes.length ? flujo.start : id,
      nodes: [...flujo.nodes, nuevo],
    });
    setExpandido(id);
  }

  function eliminarPaso(id: string) {
    const restantes = flujo.nodes.filter((n) => n.id !== id);
    onChange({
      ...flujo,
      // Al borrar el paso inicial hay que elegir otro, o el flujo queda sin
      // punto de entrada y deja de poder publicarse sin decir por qué.
      start: flujo.start === id ? (restantes[0]?.id ?? '') : flujo.start,
      // Los enlaces que apuntaban aquí se limpian: dejarlos colgando produce
      // un "lleva a un paso que no existe" que el usuario no provocó.
      nodes: restantes.map((n) => ({
        ...n,
        next: n.next === id ? undefined : n.next,
        options: n.options?.filter((o) => o.next !== id),
      })),
    });
  }

  return (
    <div className="space-y-3">
      {problemas.some((p) => !p.nodeId) && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-700"
        >
          {problemas
            .filter((p) => !p.nodeId)
            .map((p) => (
              <p key={p.mensaje}>{p.mensaje}</p>
            ))}
        </div>
      )}

      <ol className="space-y-2">
        {flujo.nodes.map((nodo) => {
          const suyos = problemasPorNodo.get(nodo.id) ?? [];
          const abierto = expandido === nodo.id;
          const esInicio = flujo.start === nodo.id;

          return (
            <li
              key={nodo.id}
              className={`rounded-md border bg-white ${
                suyos.length ? 'border-red-300' : 'border-neutral-200'
              }`}
            >
              <div className="flex items-center gap-2 p-2">
                <button
                  type="button"
                  onClick={() => setExpandido(abierto ? null : nodo.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  {esInicio && (
                    <span
                      title="Paso inicial"
                      className="flex items-center gap-0.5 rounded bg-primary-100 px-1.5 py-0.5 text-[10px] font-medium text-primary-800"
                    >
                      <Flag size={9} />
                      Inicio
                    </span>
                  )}
                  <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-600">
                    {nodo.id}
                  </span>
                  <span className="truncate text-xs text-neutral-700">
                    {nodo.text?.trim() ||
                      TIPOS_NODO.find((t) => t.valor === nodo.type)?.etiqueta}
                  </span>
                  {suyos.length > 0 && (
                    <AlertTriangle size={12} className="shrink-0 text-red-600" />
                  )}
                </button>

                {!esInicio && (
                  <button
                    type="button"
                    onClick={() => onChange({ ...flujo, start: nodo.id })}
                    className="shrink-0 rounded px-1.5 py-1 text-[10px] text-neutral-500 hover:bg-neutral-100"
                  >
                    Marcar inicio
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => eliminarPaso(nodo.id)}
                  aria-label={`Eliminar el paso ${nodo.id}`}
                  className="shrink-0 rounded p-1 text-neutral-500 hover:bg-neutral-100"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              {abierto && (
                <div className="space-y-2 border-t border-neutral-100 p-2">
                  <select
                    value={nodo.type}
                    onChange={(e) =>
                      // Cambiar de tipo descarta lo que sobra: unas opciones
                      // colgando de un paso que ya no es menú se guardarían y
                      // no se usarían nunca.
                      actualizarNodo(nodo.id, {
                        type: e.target.value as TipoNodo,
                        options:
                          e.target.value === 'menu' ? (nodo.options ?? []) : undefined,
                        next:
                          e.target.value === 'message' ||
                          e.target.value === 'question'
                            ? nodo.next
                            : undefined,
                        saveAs:
                          e.target.value === 'question' ? nodo.saveAs : undefined,
                      })
                    }
                    aria-label={`Tipo del paso ${nodo.id}`}
                    className="w-full rounded-md border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-neutral-500"
                  >
                    {TIPOS_NODO.map((t) => (
                      <option key={t.valor} value={t.valor}>
                        {t.etiqueta}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-neutral-500">
                    {TIPOS_NODO.find((t) => t.valor === nodo.type)?.ayuda}
                  </p>

                  <textarea
                    value={nodo.text ?? ''}
                    onChange={(e) =>
                      actualizarNodo(nodo.id, { text: e.target.value })
                    }
                    rows={2}
                    placeholder="Lo que recibe el cliente. Puedes usar {{variable}}."
                    aria-label={`Texto del paso ${nodo.id}`}
                    className="w-full rounded-md border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-neutral-500"
                  />

                  {nodo.type === 'question' && (
                    <input
                      value={nodo.saveAs ?? ''}
                      onChange={(e) =>
                        actualizarNodo(nodo.id, { saveAs: e.target.value })
                      }
                      placeholder="Guardar la respuesta como… (ej: nombre)"
                      aria-label={`Variable del paso ${nodo.id}`}
                      className="w-full rounded-md border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-neutral-500"
                    />
                  )}

                  {(nodo.type === 'message' || nodo.type === 'question') && (
                    <label className="block text-[11px] text-neutral-600">
                      Después va a
                      <select
                        value={nodo.next ?? ''}
                        onChange={(e) =>
                          actualizarNodo(nodo.id, {
                            next: e.target.value || undefined,
                          })
                        }
                        aria-label={`Paso siguiente de ${nodo.id}`}
                        className="mt-0.5 w-full rounded-md border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-neutral-500"
                      >
                        <option value="">Elige un paso…</option>
                        {ids
                          .filter((id) => id !== nodo.id)
                          .map((id) => (
                            <option key={id} value={id}>
                              {id}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}

                  {nodo.type === 'menu' && (
                    <div className="space-y-1.5">
                      {(nodo.options ?? []).map((opcion, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-1.5">
                          <input
                            value={opcion.label}
                            onChange={(e) =>
                              actualizarNodo(nodo.id, {
                                options: (nodo.options ?? []).map((o, j) =>
                                  j === i ? { ...o, label: e.target.value } : o,
                                ),
                              })
                            }
                            placeholder="Lo que ve el cliente"
                            aria-label={`Opción ${i + 1} del paso ${nodo.id}`}
                            className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-neutral-500"
                          />
                          <select
                            value={opcion.next}
                            onChange={(e) =>
                              actualizarNodo(nodo.id, {
                                options: (nodo.options ?? []).map((o, j) =>
                                  j === i ? { ...o, next: e.target.value } : o,
                                ),
                              })
                            }
                            aria-label={`Destino de la opción ${i + 1} del paso ${nodo.id}`}
                            className="rounded-md border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-neutral-500"
                          >
                            <option value="">Lleva a…</option>
                            {ids.map((id) => (
                              <option key={id} value={id}>
                                {id}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              actualizarNodo(nodo.id, {
                                options: (nodo.options ?? []).filter(
                                  (_, j) => j !== i,
                                ),
                              })
                            }
                            aria-label={`Quitar la opción ${i + 1} del paso ${nodo.id}`}
                            className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          actualizarNodo(nodo.id, {
                            options: [
                              ...(nodo.options ?? []),
                              { label: '', next: '' },
                            ],
                          })
                        }
                        className="flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-[11px] text-neutral-700 hover:bg-neutral-50"
                      >
                        <Plus size={11} />
                        Añadir opción
                      </button>
                    </div>
                  )}

                  {suyos.length > 0 && (
                    <ul className="list-inside list-disc space-y-0.5 text-[11px] text-red-700">
                      {suyos.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        onClick={anadirPaso}
        className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
      >
        <Plus size={13} />
        Añadir paso
      </button>
    </div>
  );
}
