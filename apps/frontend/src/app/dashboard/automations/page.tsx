'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Zap } from 'lucide-react';
import {
  getAutomations,
  getAutomationRuns,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  DISPARADORES,
  type Automatizacion,
} from '@/lib/automations';
import { getCompanyUsers } from '@/lib/users';
import {
  AutomationEditor,
  type BorradorAutomatizacion,
} from '@/components/automations/AutomationEditor';
import { AutomationRuns } from '@/components/automations/AutomationRuns';

export default function AutomationsPage() {
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState<Automatizacion | null>(null);
  const [creando, setCreando] = useState(false);

  const { data: automatizaciones, isLoading } = useQuery({
    queryKey: ['automations'],
    queryFn: getAutomations,
  });

  const { data: ejecuciones } = useQuery({
    queryKey: ['automations', 'runs'],
    queryFn: () => getAutomationRuns({ limit: 30 }),
    // El historial sí se refresca solo: es donde se mira cuando algo va mal.
    refetchInterval: 30_000,
  });

  const { data: asesores } = useQuery({
    queryKey: ['users'],
    queryFn: getCompanyUsers,
    staleTime: 5 * 60_000,
  });

  async function refrescar() {
    await queryClient.invalidateQueries({ queryKey: ['automations'] });
  }

  async function guardar(borrador: BorradorAutomatizacion) {
    if (editando) {
      await updateAutomation(editando.id, borrador);
    } else {
      await createAutomation(borrador);
    }
    setEditando(null);
    setCreando(false);
    await refrescar();
  }

  async function alternarActiva(a: Automatizacion) {
    await updateAutomation(a.id, { isActive: !a.isActive });
    await refrescar();
  }

  async function eliminar(a: Automatizacion) {
    await deleteAutomation(a.id);
    await refrescar();
  }

  const enEdicion = creando || editando !== null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900">
            Automatizaciones
          </h2>
          <p className="text-sm text-neutral-500">
            Reglas que se ejecutan solas cuando entra un mensaje.
          </p>
        </div>
        {!enEdicion && (
          <button
            onClick={() => setCreando(true)}
            className="flex items-center gap-1.5 rounded-md bg-brand-primary px-3 py-2 text-sm text-white hover:bg-primary-900"
          >
            <Plus size={16} />
            Nueva automatización
          </button>
        )}
      </div>

      {enEdicion && (
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-neutral-900">
            {editando ? `Editar: ${editando.name}` : 'Nueva automatización'}
          </h3>
          <AutomationEditor
            inicial={editando ?? undefined}
            asesores={asesores ?? []}
            onGuardar={guardar}
            onCancelar={() => {
              setEditando(null);
              setCreando(false);
            }}
          />
        </div>
      )}

      {isLoading && <p className="text-sm text-neutral-500">Cargando…</p>}

      {!isLoading && !automatizaciones?.length && !enEdicion && (
        <div className="rounded-lg border border-dashed border-neutral-300 px-4 py-10 text-center">
          <Zap size={20} className="mx-auto mb-2 text-neutral-400" />
          <p className="text-sm font-medium text-neutral-700">
            Todavía no hay automatizaciones
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            Una regla típica: saludar automáticamente a quien escribe por
            primera vez.
          </p>
        </div>
      )}

      {!!automatizaciones?.length && (
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
          {automatizaciones.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-neutral-900">
                    {a.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-neutral-400">
                    v{a.version}
                  </span>
                  {!a.isActive && (
                    <span className="shrink-0 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-600">
                      Pausada
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-neutral-500">
                  {DISPARADORES.find((d) => d.valor === a.trigger)?.etiqueta ??
                    a.trigger}
                  {' · '}
                  {a.actions?.length ?? 0} acción
                  {(a.actions?.length ?? 0) === 1 ? '' : 'es'}
                </p>
              </div>

              <button
                onClick={() => void alternarActiva(a)}
                className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
              >
                {a.isActive ? 'Pausar' : 'Activar'}
              </button>
              <button
                onClick={() => {
                  setCreando(false);
                  setEditando(a);
                }}
                aria-label={`Editar ${a.name}`}
                className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={() => void eliminar(a)}
                aria-label={`Eliminar ${a.name}`}
                className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-lg border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-3 py-2">
          <h3 className="text-sm font-semibold text-neutral-900">
            Últimas ejecuciones
          </h3>
          <p className="text-xs text-neutral-500">
            Qué hizo cada regla y dónde falló, si falló.
          </p>
        </div>
        <AutomationRuns ejecuciones={ejecuciones ?? []} />
      </div>
    </div>
  );
}
