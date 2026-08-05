'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { CatalogoDto, NodoCatalogoDto } from '@/lib/flowbots';
import { agrupar } from './agrupacion';
import { IconoNodo } from './NodoFlowBot';

/**
 * La paleta de pasos.
 *
 * SE PINTA LO QUE MANDE EL SERVIDOR, sin excepciones. `disponible` lo decide
 * él mirando si existe el ejecutor, y aquí se lee esa bandera y no el mensaje:
 * el mensaje es para la persona, la bandera es el contrato. Un paso no
 * disponible se enseña apagado y no se puede arrastrar, en vez de esconderlo,
 * porque saber que existe y todavía no funciona es información útil; que
 * desaparezca solo genera la duda de si se ha ido para siempre.
 */
export function Paleta({
  catalogo,
  onAgregar,
  deshabilitada,
}: {
  catalogo: CatalogoDto;
  onAgregar: (nodo: NodoCatalogoDto) => void;
  deshabilitada?: boolean;
}) {
  const [busqueda, setBusqueda] = useState('');
  const [cerrados, setCerrados] = useState<Set<string>>(new Set());

  const grupos = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    const filtrados = texto
      ? catalogo.nodos.filter(
          (n) =>
            n.etiqueta.toLowerCase().includes(texto) ||
            n.ayuda.toLowerCase().includes(texto) ||
            n.tipo.toLowerCase().includes(texto),
        )
      : catalogo.nodos;
    return agrupar(filtrados, catalogo.categorias);
  }, [catalogo, busqueda]);

  return (
    <div className="flex h-full flex-col">
      <div className="relative border-b border-neutral-200 p-2">
        <Search
          size={14}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400"
        />
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar un paso"
          aria-label="Buscar un paso"
          className="w-full rounded-md border border-neutral-300 py-1.5 pl-7 pr-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {grupos.length === 0 && (
          <p className="px-1 py-6 text-center text-xs text-neutral-400">
            Ningún paso coincide.
          </p>
        )}

        {grupos.map((g) => {
          const cerrado = cerrados.has(g.id) && !busqueda;
          return (
            <section key={g.id} className="mb-2">
              <button
                type="button"
                aria-expanded={!cerrado}
                onClick={() =>
                  setCerrados((prev) => {
                    const s = new Set(prev);
                    if (s.has(g.id)) s.delete(g.id);
                    else s.add(g.id);
                    return s;
                  })
                }
                className="mb-1 flex w-full items-center justify-between rounded px-1 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-neutral-500 outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-line-focus"
              >
                {g.etiqueta}
                <span className="text-neutral-400">{g.nodos.length}</span>
              </button>

              {!cerrado && (
                <ul className="space-y-1">
                  {g.nodos.map((n) => (
                    <ItemPaleta
                      key={n.tipo}
                      nodo={n}
                      deshabilitada={deshabilitada}
                      onAgregar={onAgregar}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ItemPaleta({
  nodo,
  onAgregar,
  deshabilitada,
}: {
  nodo: NodoCatalogoDto;
  onAgregar: (n: NodoCatalogoDto) => void;
  deshabilitada?: boolean;
}) {
  const bloqueado = !nodo.disponible || deshabilitada;

  return (
    <li>
      <button
        type="button"
        draggable={!bloqueado}
        disabled={bloqueado}
        title={nodo.disponible ? nodo.ayuda : nodo.motivoNoDisponible}
        onDragStart={(e) => {
          // Se arrastra el TIPO, no el nodo entero: la configuración inicial
          // la decide quien recibe la soltada, que es quien sabe dónde cae.
          e.dataTransfer.setData('application/takto-flowbot-nodo', nodo.tipo);
          e.dataTransfer.effectAllowed = 'move';
        }}
        // Doble camino a propósito: arrastrar es cómodo con ratón e imposible
        // con teclado. Pulsar añade el paso al centro del lienzo.
        onClick={() => !bloqueado && onAgregar(nodo)}
        className={`flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-line-focus ${
          bloqueado
            ? 'cursor-not-allowed border-neutral-200 bg-neutral-50 opacity-60'
            : 'cursor-grab border-neutral-200 bg-white hover:border-brand-primary hover:bg-primary-50'
        }`}
      >
        <span className="mt-0.5 shrink-0 text-brand-primary">
          <IconoNodo tipo={nodo.tipo} size={13} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[11px] font-medium text-neutral-800">
            {nodo.etiqueta}
          </span>
          <span className="block truncate text-[10px] text-neutral-500">
            {nodo.disponible
              ? nodo.ayuda
              : 'Todavía no se puede ejecutar'}
          </span>
          {nodo.config.some((c) => c.obligatorio) && nodo.disponible && (
            <span className="mt-0.5 block text-[9px] text-status-warning">
              Requiere configuración
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
