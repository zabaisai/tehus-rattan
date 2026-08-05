'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LayoutTemplate, AlertTriangle, Check } from 'lucide-react';
import { flowbots, type PlantillaResumen } from '@/lib/flowbots';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ListState } from '@/components/ui/ListState';

const CATEGORIAS: Record<string, string> = {
  ventas: 'Ventas',
  soporte: 'Soporte',
  agenda: 'Agenda',
  calificacion: 'Calificación',
  seguimiento: 'Seguimiento',
};

/**
 * Las plantillas oficiales.
 *
 * UNA PLANTILLA CON CAMPOS SIN COMPLETAR NO SE PRESENTA COMO LISTA. Poner una
 * referencia de ejemplo —un id de etapa, el nombre de una plantilla de
 * WhatsApp— sería peor que dejarla vacía: alguien publicaría sin cambiarla y
 * le mandaría a su cliente algo de otra empresa. Así que la plantilla dice
 * exactamente qué le falta y el editor abre apuntando ahí.
 */
export function GaleriaPlantillas({
  onUsar,
  usando,
}: {
  onUsar: (plantilla: PlantillaResumen) => void;
  usando?: string | null;
}) {
  const [abierta, setAbierta] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['flowbots', 'templates'],
    queryFn: flowbots.plantillas,
    // Las plantillas son parte del producto, no datos de la empresa: no
    // cambian entre una pantalla y la siguiente.
    staleTime: 30 * 60_000,
  });

  return (
    <div className="space-y-4">
      <ListState
        isLoading={isLoading}
        isError={isError}
        isEmpty={(data?.length ?? 0) === 0}
        error={error}
        onRetry={() => void refetch()}
        icon={LayoutTemplate}
        emptyMessage="No hay plantillas disponibles."
        loadingMessage="Cargando plantillas…"
      />

      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(data ?? []).map((p) => {
          const faltan = p.camposPorCompletar.length;
          const detalle = abierta === p.clave;

          return (
            <li
              key={p.clave}
              className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-neutral-900">
                    {p.nombre}
                  </h3>
                  <p className="text-xs text-neutral-500">{p.objetivo}</p>
                </div>
                <Badge tone="info">
                  {CATEGORIAS[p.categoria] ?? p.categoria}
                </Badge>
              </div>

              <p className="text-xs leading-relaxed text-neutral-600">
                {p.descripcion}
              </p>

              <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
                <span>{p.nodos} pasos</span>
                {p.requiere.map((r) => (
                  <span
                    key={r}
                    className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-600"
                  >
                    {r}
                  </span>
                ))}
              </div>

              {faltan > 0 ? (
                <p className="flex items-start gap-1.5 rounded-md bg-status-warning-surface px-2 py-1.5 text-[11px] text-status-warning">
                  <AlertTriangle size={13} className="mt-px shrink-0" />
                  <span>
                    Te faltará elegir {faltan}{' '}
                    {faltan === 1 ? 'dato tuyo' : 'datos tuyos'} antes de
                    publicarla. Nadie puede elegirlos por ti.
                  </span>
                </p>
              ) : (
                <p className="flex items-center gap-1.5 text-[11px] text-status-success">
                  <Check size={13} />
                  Lista para publicar tal cual
                </p>
              )}

              <div className="mt-auto flex items-center gap-2">
                <Button
                  variant="accent"
                  size="sm"
                  onClick={() => onUsar(p)}
                  disabled={usando === p.clave}
                >
                  {usando === p.clave ? 'Creando…' : 'Usar plantilla'}
                </Button>
                <Button
                  variant="quiet"
                  size="sm"
                  aria-expanded={detalle}
                  onClick={() => setAbierta(detalle ? null : p.clave)}
                >
                  {detalle ? 'Ocultar' : 'Ver qué incluye'}
                </Button>
              </div>

              {detalle && (
                <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2.5 text-[11px]">
                  {faltan > 0 && (
                    <>
                      <p className="font-medium text-neutral-700">
                        Campos por completar
                      </p>
                      <ul className="mt-1 space-y-0.5 font-mono text-neutral-600">
                        {p.camposPorCompletar.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {faltan === 0 && (
                    <p className="text-neutral-600">
                      No hace falta configurar nada para publicarla, pero
                      revisa los textos antes: se los va a mandar a tus
                      clientes.
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
