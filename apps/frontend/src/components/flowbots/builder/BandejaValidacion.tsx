'use client';

import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import type { Problema, ResultadoValidacion } from '@/lib/flowbots';

/**
 * La bandeja de problemas.
 *
 * PULSAR UN PROBLEMA TIENE QUE LLEVAR AL SITIO. Un mensaje que dice «falta el
 * texto del mensaje» en un flujo de treinta pasos obliga a abrirlos uno a uno;
 * por eso al pulsar se selecciona el paso, se centra en el lienzo, se abre su
 * panel y se enfoca el campo. Lo demás es una lista de reproches.
 *
 * ERRORES Y AVISOS SE SEPARAN. Un error impide publicar; un aviso no. Ponerlos
 * en el mismo montón hace que se ignoren los dos por igual.
 */
export function BandejaValidacion({
  resultado,
  validando,
  onIrA,
}: {
  resultado: ResultadoValidacion | null;
  validando: boolean;
  onIrA: (problema: Problema) => void;
}) {
  if (validando && !resultado) {
    return (
      <p className="flex items-center gap-2 px-3 py-2 text-[11px] text-neutral-500">
        <Loader2 size={12} className="animate-spin" />
        Revisando el flujo…
      </p>
    );
  }

  if (!resultado) {
    return (
      <p className="px-3 py-2 text-[11px] text-neutral-400">
        Todavía no se ha revisado el flujo.
      </p>
    );
  }

  const errores = resultado.problemas.filter((p) => p.severidad === 'error');
  const avisos = resultado.problemas.filter((p) => p.severidad === 'aviso');

  if (errores.length === 0 && avisos.length === 0) {
    return (
      <p className="flex items-center gap-2 px-3 py-2 text-[11px] text-status-success">
        <CheckCircle2 size={13} />
        Todo en orden. Se puede publicar.
      </p>
    );
  }

  return (
    <div className="max-h-52 overflow-y-auto">
      {errores.length > 0 && (
        <Seccion
          titulo={`${errores.length} ${errores.length === 1 ? 'error' : 'errores'} · impiden publicar`}
          tono="error"
          problemas={errores}
          onIrA={onIrA}
        />
      )}
      {avisos.length > 0 && (
        <Seccion
          titulo={`${avisos.length} ${avisos.length === 1 ? 'aviso' : 'avisos'} · se puede publicar igual`}
          tono="aviso"
          problemas={avisos}
          onIrA={onIrA}
        />
      )}
    </div>
  );
}

function Seccion({
  titulo,
  tono,
  problemas,
  onIrA,
}: {
  titulo: string;
  tono: 'error' | 'aviso';
  problemas: Problema[];
  onIrA: (p: Problema) => void;
}) {
  const Icono = tono === 'error' ? XCircle : AlertTriangle;
  const color = tono === 'error' ? 'text-status-error' : 'text-status-warning';

  return (
    <section>
      <h3
        className={`sticky top-0 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-wide ${color}`}
      >
        {titulo}
      </h3>
      <ul>
        {problemas.map((p, i) => (
          <li key={`${p.codigo}-${p.nodeId ?? p.edgeId ?? ''}-${i}`}>
            <button
              type="button"
              onClick={() => onIrA(p)}
              className="flex w-full items-start gap-2 px-3 py-1.5 text-left outline-none hover:bg-neutral-50 focus-visible:bg-neutral-50"
            >
              <Icono size={12} className={`mt-0.5 shrink-0 ${color}`} />
              <span className="min-w-0">
                <span className="block text-[11px] text-neutral-800">
                  {p.mensaje}
                </span>
                {p.solucion && (
                  <span className="block text-[10px] text-neutral-500">
                    {p.solucion}
                  </span>
                )}
                <span className="block font-mono text-[9px] text-neutral-400">
                  {p.codigo}
                  {p.campo ? ` · ${p.campo}` : ''}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
