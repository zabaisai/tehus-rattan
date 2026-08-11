'use client';

import { CheckCircle2, XCircle, Clock, Skull } from 'lucide-react';
import type { EjecucionAutomatizacion } from '@/lib/automations';

const ESTADOS: Record<
  EjecucionAutomatizacion['status'],
  { etiqueta: string; clase: string; icono: React.ReactNode }
> = {
  COMPLETED: {
    etiqueta: 'Completada',
    clase: 'text-status-success-strong bg-status-success-surface',
    icono: <CheckCircle2 size={13} />,
  },
  FAILED: {
    etiqueta: 'Con fallos',
    clase: 'text-status-error bg-status-error-surface',
    icono: <XCircle size={13} />,
  },
  DEAD: {
    etiqueta: 'Agotada',
    clase: 'text-status-error bg-status-error-surface',
    icono: <Skull size={13} />,
  },
  RUNNING: {
    etiqueta: 'En curso',
    clase: 'text-neutral-700 bg-neutral-100',
    icono: <Clock size={13} />,
  },
  PENDING: {
    etiqueta: 'Pendiente',
    clase: 'text-neutral-600 bg-neutral-100',
    icono: <Clock size={13} />,
  },
};

/**
 * Historial de ejecuciones.
 *
 * Responde a la pregunta que antes no tenía respuesta: "¿por qué no se mandó
 * ese mensaje?". Por eso muestra el resultado de CADA acción y no solo el de
 * la ejecución: una automatización puede haber enviado el mensaje y fallado al
 * mover la etapa, y un único semáforo en verde o rojo esconde exactamente eso.
 */
export function AutomationRuns({
  ejecuciones,
}: {
  ejecuciones: EjecucionAutomatizacion[];
}) {
  if (!ejecuciones.length) {
    return (
      <p className="px-3 py-6 text-center text-xs text-neutral-500">
        Todavía no se ha ejecutado ninguna automatización.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-neutral-100">
      {ejecuciones.map((run) => {
        const estado = ESTADOS[run.status];
        const pasos = run.steps ?? [];

        return (
          <li key={run.id} className="px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${estado.clase}`}
              >
                {estado.icono}
                {estado.etiqueta}
              </span>
              <span className="truncate text-xs font-medium text-neutral-800">
                {run.automation.name}
              </span>
              {/* La versión importa: la automatización pudo cambiar después,
                  y sin esto el historial no explicaría el resultado. */}
              <span className="text-[10px] text-neutral-400">
                v{run.automationVersion}
              </span>
              {run.attempts > 1 && (
                <span className="text-[10px] text-neutral-500">
                  {run.attempts} intentos
                </span>
              )}
              <span className="ml-auto text-[10px] text-neutral-400">
                {new Date(run.createdAt).toLocaleString('es-CO')}
              </span>
            </div>

            {pasos.length > 0 && (
              <ol className="mt-1.5 space-y-0.5">
                {pasos.map((paso, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-1.5 text-[11px] text-neutral-600"
                  >
                    {paso.ok ? (
                      <CheckCircle2 size={11} className="text-status-success-strong" />
                    ) : (
                      <XCircle size={11} className="text-status-error" />
                    )}
                    <span>{paso.type}</span>
                    {/* Clasificador, no el mensaje del proveedor: ese arrastra
                        el teléfono del cliente. */}
                    {paso.error && (
                      <span className="text-status-error">({paso.error})</span>
                    )}
                    {paso.durationMs !== undefined && (
                      <span className="text-neutral-400">{paso.durationMs} ms</span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </li>
        );
      })}
    </ul>
  );
}
