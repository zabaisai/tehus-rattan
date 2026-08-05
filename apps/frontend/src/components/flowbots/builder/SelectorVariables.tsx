'use client';

import { useMemo, useRef, useState } from 'react';
import { Braces, Search } from 'lucide-react';
import type { VariableDto } from '@/lib/flowbots';

/**
 * Insertar un dato del cliente dentro de un texto.
 *
 * SE ELIGE DE UNA LISTA, NO SE ESCRIBE. Escribir `{{contact.nombre}}` cuando
 * la variable se llama `contact.name` produce un mensaje que le llega al
 * cliente con el hueco vacío o con las llaves a la vista. La lista viene del
 * servidor —la misma que valida el motor—, así que lo que se puede insertar es
 * exactamente lo que existe.
 *
 * Cada una enseña un ejemplo FALSO de lo que saldría ahí. Sin eso,
 * `lead.value` puede ser el número, el texto con moneda o el nombre de la
 * etapa, y la única manera de saberlo es publicar y mirar.
 */
export function SelectorVariables({
  variables,
  onInsertar,
  disponiblesEn,
}: {
  variables: VariableDto[];
  onInsertar: (texto: string) => void;
  /** Tipos de paso que hay ANTES en el flujo, para avisar de lo que no habrá. */
  disponiblesEn?: Set<string>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const boton = useRef<HTMLButtonElement>(null);

  const grupos = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    const filtradas = texto
      ? variables.filter(
          (v) =>
            v.etiqueta.toLowerCase().includes(texto) ||
            v.ruta.toLowerCase().includes(texto),
        )
      : variables;

    const mapa = new Map<string, VariableDto[]>();
    for (const v of filtradas) {
      mapa.set(v.grupo, [...(mapa.get(v.grupo) ?? []), v]);
    }
    return [...mapa.entries()];
  }, [variables, busqueda]);

  return (
    <div className="relative">
      <button
        ref={boton}
        type="button"
        aria-expanded={abierto}
        aria-haspopup="listbox"
        onClick={() => setAbierto((v) => !v)}
        className="inline-flex items-center gap-1 rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-[10px] text-neutral-600 outline-none hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-line-focus"
      >
        <Braces size={11} />
        Insertar dato
      </button>

      {abierto && (
        <>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => setAbierto(false)}
          />
          <div
            role="listbox"
            aria-label="Datos que puedes insertar"
            className="absolute right-0 z-30 mt-1 max-h-80 w-72 overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-lg"
          >
            <div className="sticky top-0 border-b border-neutral-200 bg-white p-1.5">
              <div className="relative">
                <Search
                  size={12}
                  className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400"
                />
                <input
                  autoFocus
                  type="search"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar un dato"
                  aria-label="Buscar un dato"
                  className="w-full rounded border border-neutral-300 py-1 pl-6 pr-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
                />
              </div>
            </div>

            {grupos.length === 0 && (
              <p className="px-3 py-4 text-center text-[11px] text-neutral-400">
                Ningún dato coincide.
              </p>
            )}

            {grupos.map(([grupo, lista]) => (
              <div key={grupo}>
                <p className="bg-neutral-50 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-neutral-500">
                  {grupo}
                </p>
                {lista.map((v) => {
                  // «Puede no haber valor» no bloquea: hay flujos donde el
                  // paso que la produce está en otra rama y aun así se quiere
                  // usar. Se avisa y se deja decidir.
                  const quizaVacia =
                    !v.siempre &&
                    disponiblesEn !== undefined &&
                    !(v.producidaPor ?? []).some((t) => disponiblesEn.has(t));

                  return (
                    <button
                      key={v.ruta}
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => {
                        onInsertar(`{{${v.ruta}}}`);
                        setAbierto(false);
                        setBusqueda('');
                        boton.current?.focus();
                      }}
                      className="flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left outline-none hover:bg-primary-50 focus-visible:bg-primary-50"
                    >
                      <span className="text-[11px] font-medium text-neutral-800">
                        {v.etiqueta}
                      </span>
                      <span className="font-mono text-[10px] text-neutral-500">
                        {`{{${v.ruta}}}`}
                      </span>
                      <span className="text-[10px] text-neutral-400">
                        Ejemplo: {v.ejemplo}
                      </span>
                      {quizaVacia && (
                        <span className="text-[10px] text-status-warning">
                          Puede llegar vacío: ningún paso anterior lo genera
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
