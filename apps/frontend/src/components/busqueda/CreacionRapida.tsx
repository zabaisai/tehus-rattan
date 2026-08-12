'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, FileText, Package, Plus, Target, User } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { createContact } from '@/lib/contacts';
import { createTask } from '@/lib/tasks';
import { createProduct } from '@/lib/products';
import { getPipelines } from '@/lib/pipeline';
import {
  AccionRapida,
  accionesPara,
  DefinicionDeAccion,
  leerRecientes,
} from '@/lib/creacion-rapida';
import { rutaDelResultado, ETIQUETA_DE_TIPO, ResultadoDeBusqueda } from '@/lib/busqueda';
import { ContactModal } from '@/components/contacts/ContactModal';
import { TaskModal } from '@/components/tasks/TaskModal';
import { ProductModal } from '@/components/products/ProductModal';
import { LeadFormModal } from '@/components/leads/LeadFormModal';

const ICONO: Record<AccionRapida, typeof User> = {
  contacto: User,
  oportunidad: Target,
  tarea: Plus,
  cotizacion: FileText,
  producto: Package,
  bot: Bot,
};

/**
 * El panel «Crear rápidamente» del mockup 16, más los recientes.
 *
 * NO reimplementa ningún formulario: abre los modales que ya usan Contactos,
 * Pipeline, Tareas y Productos. Duplicarlos habría significado dos sitios donde
 * arreglar cada validación.
 */
export function CreacionRapida({ onCerrar }: { onCerrar: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [abierto, setAbierto] = useState<AccionRapida | null>(null);

  const acciones = accionesPara(user?.role);
  const recientes = leerRecientes({ companyId: user?.companyId, userId: user?.id });

  // El modal de oportunidad necesita el embudo y sus etapas. Solo se pide
  // cuando hace falta: abrir la paleta para buscar no debe disparar consultas
  // de datos que quizá no se usen.
  const { data: embudos } = useQuery({
    queryKey: ['pipelines'],
    queryFn: getPipelines,
    enabled: abierto === 'oportunidad',
  });
  const embudo = embudos?.[0];

  function activar(a: DefinicionDeAccion) {
    if (a.ruta) {
      router.push(a.ruta);
      onCerrar();
      return;
    }
    setAbierto(a.accion);
  }

  async function trasCrear(claves: string[]) {
    await Promise.all(
      claves.map((k) => queryClient.invalidateQueries({ queryKey: [k] })),
    );
    setAbierto(null);
    onCerrar();
  }

  function abrirReciente(r: { tipo: ResultadoDeBusqueda['tipo']; id: string }) {
    router.push(rutaDelResultado(r as ResultadoDeBusqueda));
    onCerrar();
  }

  return (
    <>
      <div className="hidden w-64 shrink-0 flex-col border-l border-line-default lg:flex">
        <div className="border-b border-line-default px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-content-secondary">
            Crear rápidamente
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {acciones.length === 0 && (
            <p className="px-2 py-3 text-xs text-content-secondary">
              Tu rol no permite crear desde aquí.
            </p>
          )}

          <div className="grid grid-cols-2 gap-1.5">
            {acciones.map((a) => {
              const Icono = ICONO[a.accion];
              return (
                <button
                  key={a.accion}
                  type="button"
                  onClick={() => activar(a)}
                  className="flex flex-col items-center gap-1.5 rounded-md border border-line-default px-2 py-3 text-center outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-line-focus"
                >
                  <Icono size={17} aria-hidden="true" className="text-content-secondary" />
                  <span className="text-[11px] leading-tight text-content-primary">
                    {a.etiqueta}
                  </span>
                  {/* La nota evita la sorpresa: estas dos navegan en vez de
                      abrir un formulario, y conviene saberlo antes de pulsar. */}
                  {a.nota && (
                    <span className="text-[10px] leading-tight text-content-secondary">
                      {a.nota}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {recientes.length > 0 && (
            <div className="mt-4">
              <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-content-secondary">
                Recientes
              </p>
              <ul>
                {recientes.map((r) => (
                  <li key={`${r.tipo}-${r.id}`}>
                    <button
                      type="button"
                      onClick={() => abrirReciente(r)}
                      className="w-full rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-line-focus"
                    >
                      <span className="block truncate text-xs text-content-primary">
                        {r.titulo}
                      </span>
                      <span className="block truncate text-[10px] text-content-secondary">
                        {ETIQUETA_DE_TIPO[r.tipo]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Los modales se montan FUERA del panel para que el diálogo de creación
          quede por encima de la paleta y `useDialogoModal` lo apile bien. */}
      {abierto === 'contacto' && (
        <ContactModal
          contact={null}
          onClose={() => setAbierto(null)}
          onSubmit={async (d) => {
            await createContact(d);
            await trasCrear(['contacts']);
          }}
        />
      )}

      {abierto === 'tarea' && (
        <TaskModal
          task={null}
          onClose={() => setAbierto(null)}
          onSubmit={async (d) => {
            await createTask(d);
            await trasCrear(['tasks']);
          }}
        />
      )}

      {abierto === 'producto' && (
        <ProductModal
          product={null}
          onClose={() => setAbierto(null)}
          onSubmit={async (d) => {
            await createProduct({
              name: d.name,
              description: d.description || undefined,
              price: Number(d.price),
              category: d.category || undefined,
              imageUrl: d.imageUrl || undefined,
            });
            await trasCrear(['products']);
          }}
        />
      )}

      {abierto === 'oportunidad' && embudo && (
        <LeadFormModal
          pipelineId={embudo.id}
          stages={embudo.stages}
          onClose={() => setAbierto(null)}
          onCreated={() => void trasCrear(['leads', 'kanban'])}
        />
      )}
    </>
  );
}
