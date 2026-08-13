'use client';

import Link from 'next/link';
import { AgentPerformance } from '@/types';
import { Avatar } from '@/components/ui/Avatar';

/**
 * El equipo, con los datos que `analytics/agent-performance` sí devuelve.
 *
 * EL CASO «TODO SIN ASIGNAR» ES UN ESTADO, NO UNA LISTA VACÍA. Si ningún lead
 * tiene responsable, la tabla sale entera a ceros y parece que el equipo no
 * trabaja. No es lo que pasa: es que nadie ha asignado. Se dice con esas
 * palabras y se ofrece el sitio donde se arregla, en vez de sembrar
 * asignaciones para que el panel se vea bonito.
 *
 * Conversión por asesor: se calcula con lo que hay —ganadas sobre cerradas—
 * y solo cuando hay algo cerrado. Con cero cerradas no es «0 %», es «sin
 * datos»: son cosas distintas y la primera acusa a alguien de no cerrar nada.
 *
 * INICIALES, NUNCA UNA FOTOGRAFÍA.
 */
export function RendimientoPorAsesor({
  asesores,
  formatoDinero,
}: {
  asesores: AgentPerformance[];
  formatoDinero: (v: number) => string;
}) {
  const sinAsignar = asesores.every(
    (a) => a.openLeads === 0 && a.wonCount === 0 && a.lostCount === 0,
  );

  if (sinAsignar) {
    return (
      <div className="flex flex-col items-start gap-2 py-4">
        <p className="text-sm text-content-primary">
          Ninguna oportunidad tiene responsable asignado.
        </p>
        <p className="text-xs text-content-secondary">
          El equipo aparece aquí en cuanto una oportunidad tenga a alguien
          detrás. Hasta entonces no hay rendimiento que comparar, solo{' '}
          {asesores.length} {asesores.length === 1 ? 'persona' : 'personas'} en la
          empresa.
        </p>
        <Link
          href="/dashboard/pipeline"
          className="mt-1 rounded text-xs font-medium text-content-link outline-none transition-colors duration-rapida ease-standard hover:underline focus-visible:ring-2 focus-visible:ring-line-focus focus-visible:ring-offset-1"
        >
          Asignar desde el embudo
        </Link>
      </div>
    );
  }

  const maximo = Math.max(1, ...asesores.map((a) => a.wonValue));

  return (
    <table className="w-full text-sm">
      <caption className="sr-only">
        Oportunidades abiertas, conversión y valor ganado por asesor
      </caption>
      <thead>
        <tr className="text-[11px] uppercase tracking-wide text-content-secondary">
          <th scope="col" className="pb-2 text-left font-medium">
            Asesor
          </th>
          <th scope="col" className="pb-2 text-right font-medium">
            Abiertas
          </th>
          <th scope="col" className="hidden pb-2 text-right font-medium sm:table-cell">
            Conversión
          </th>
          <th scope="col" className="pb-2 text-right font-medium">
            Ganado
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line-default">
        {asesores.map((a) => {
          const cerradas = a.wonCount + a.lostCount;
          const conversion =
            cerradas > 0 ? Math.round((a.wonCount / cerradas) * 1000) / 10 : null;

          return (
            <tr key={a.agentId}>
              <th scope="row" className="py-2.5 text-left font-normal">
                <span className="flex min-w-0 items-center gap-2.5">
                  <Avatar nombre={a.agentName} size="sm" />
                  <span className="truncate text-content-primary">{a.agentName}</span>
                </span>
              </th>
              <td className="py-2.5 text-right font-mono text-xs tabular-nums text-content-secondary">
                {a.openLeads}
              </td>
              <td className="hidden py-2.5 text-right font-mono text-xs tabular-nums text-content-secondary sm:table-cell">
                {conversion === null ? (
                  <span className="text-content-disabled">sin datos</span>
                ) : (
                  `${conversion.toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`
                )}
              </td>
              <td className="py-2.5 text-right">
                <span className="flex flex-col items-end gap-1">
                  <span className="font-mono text-xs font-medium tabular-nums text-content-primary">
                    {formatoDinero(a.wonValue)}
                  </span>
                  <span
                    aria-hidden="true"
                    className="block h-1 w-16 overflow-hidden rounded-full bg-neutral-100"
                  >
                    <span
                      className="block h-full rounded-full bg-status-success transition-[width] duration-lenta ease-standard"
                      style={{
                        width: `${a.wonValue > 0 ? Math.max(4, (a.wonValue / maximo) * 100) : 0}%`,
                      }}
                    />
                  </span>
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
