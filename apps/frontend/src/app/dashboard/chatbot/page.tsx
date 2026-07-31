'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Plus, Rocket, Trash2 } from 'lucide-react';
import {
  createFlow,
  deleteFlow,
  getChatbotSessions,
  getFlows,
  publishFlow,
  updateFlow,
  validarFlujo,
  type FlujoChatbot,
  type FlujoResumen,
} from '@/lib/chatbot';
import { ChatbotFlowEditor } from '@/components/chatbot/ChatbotFlowEditor';

const ESTADO_SESION: Record<string, string> = {
  ACTIVE: 'En curso',
  HANDED_OVER: 'Pasada a una persona',
  COMPLETED: 'Terminada',
  ABANDONED: 'Abandonada',
};

export default function ChatbotPage() {
  const queryClient = useQueryClient();
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [errorLista, setErrorLista] = useState<string | null>(null);

  const { data: flujos } = useQuery({
    queryKey: ['chatbot', 'flows'],
    queryFn: getFlows,
  });

  const { data: sesiones } = useQuery({
    queryKey: ['chatbot', 'sessions'],
    queryFn: () => getChatbotSessions({ limit: 20 }),
    refetchInterval: 30_000,
  });

  const flujo = flujos?.find((f) => f.id === seleccionado) ?? null;

  async function refrescar() {
    await queryClient.invalidateQueries({ queryKey: ['chatbot'] });
  }

  async function crear() {
    const creado = await createFlow({ name: 'Flujo sin nombre' });
    await refrescar();
    setSeleccionado(creado.id);
  }

  async function alternarActivo(f: FlujoResumen) {
    await updateFlow(f.id, { isActive: !f.isActive });
    await refrescar();
  }

  async function eliminar(f: FlujoResumen) {
    try {
      await deleteFlow(f.id);
      if (seleccionado === f.id) setSeleccionado(null);
      await refrescar();
    } catch {
      // El backend rechaza borrar un flujo con conversaciones en curso; su
      // motivo es más útil que un genérico, pero aquí basta con no mentir.
      setErrorLista(
        'No se puede eliminar: hay conversaciones usándolo. Desactívalo y espera a que terminen.',
      );
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900">Chatbot</h2>
          <p className="text-sm text-neutral-500">
            Responde solo por WhatsApp y pasa a una persona cuando hace falta.
          </p>
        </div>
        <button
          onClick={() => void crear()}
          className="flex items-center gap-1.5 rounded-md bg-brand-primary px-3 py-2 text-sm text-white hover:bg-primary-900"
        >
          <Plus size={16} />
          Nuevo flujo
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="space-y-2">
        {errorLista && (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700"
          >
            {errorLista}
          </p>
        )}
        <ul className="h-fit divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
          {!flujos?.length && (
            <li className="px-3 py-8 text-center">
              <Bot size={20} className="mx-auto mb-2 text-neutral-400" />
              <p className="text-xs text-neutral-500">
                Todavía no hay flujos. Crea uno para que el bot conteste solo.
              </p>
            </li>
          )}
          {flujos?.map((f) => (
            <li
              key={f.id}
              className={`flex items-center gap-2 p-2.5 ${
                seleccionado === f.id ? 'bg-neutral-100' : ''
              }`}
            >
              <button
                onClick={() => setSeleccionado(f.id)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-sm font-medium text-neutral-900">
                  {f.name}
                </span>
                <span className="text-[11px] text-neutral-500">
                  {f.publishedVersion
                    ? `v${f.publishedVersion} publicada`
                    : 'Sin publicar'}
                  {f.isActive ? ' · Atendiendo' : ' · Inactivo'}
                </span>
              </button>
              <button
                onClick={() => void alternarActivo(f)}
                disabled={!f.publishedVersion}
                title={
                  f.publishedVersion
                    ? undefined
                    : 'Publica una versión antes de activarlo'
                }
                className="shrink-0 rounded-md border border-neutral-300 px-2 py-1 text-[11px] text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
              >
                {f.isActive ? 'Desactivar' : 'Activar'}
              </button>
              <button
                onClick={() => void eliminar(f)}
                aria-label={`Eliminar ${f.name}`}
                className="shrink-0 rounded p-1 text-neutral-500 hover:bg-neutral-200"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
        </div>

        <div className="space-y-3">
          {!flujo && (
            <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-10 text-center text-sm text-neutral-500">
              Elige un flujo para editarlo.
            </p>
          )}

          {flujo && (
            // `key` remonta el editor al cambiar de flujo, y con ello reinicia
            // su borrador. Sin esto haria falta un efecto que sincronizara el
            // estado local con el flujo elegido, y sincronizar estado con
            // efectos provoca renderizados en cascada.
            <PanelDeFlujo
              key={flujo.id}
              flujo={flujo}
              onGuardado={refrescar}
            />
          )}
        </div>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-3 py-2">
          <h3 className="text-sm font-semibold text-neutral-900">
            Conversaciones del bot
          </h3>
          <p className="text-xs text-neutral-500">
            En qué paso va cada una y cuáles pasaron a una persona.
          </p>
        </div>
        {!sesiones?.length ? (
          <p className="px-3 py-6 text-center text-xs text-neutral-500">
            El bot todavía no ha atendido ninguna conversación.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {sesiones.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="text-xs font-medium text-neutral-800">
                  {s.flow.name}
                </span>
                <span className="text-[10px] text-neutral-400">
                  v{s.flowVersion.version}
                </span>
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600">
                  {ESTADO_SESION[s.status] ?? s.status}
                </span>
                <span className="text-[11px] text-neutral-500">
                  paso {s.currentNode} · {s.steps} mensajes
                </span>
                <span className="ml-auto text-[10px] text-neutral-400">
                  {new Date(s.lastInteractionAt).toLocaleString('es-CO')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Edición de UN flujo. Vive aparte para que su borrador se reinicie al
 * cambiar de flujo por remontaje (`key`) en vez de por un efecto que
 * sincronice estado, que es lo que provoca renderizados en cascada.
 */
function PanelDeFlujo({
  flujo,
  onGuardado,
}: {
  flujo: FlujoResumen;
  onGuardado: () => Promise<void> | void;
}) {
  // El borrador NO se escribe en cada tecla: guardar en cada pulsación
  // mandaría decenas de escrituras por minuto contra la base.
  const [borrador, setBorrador] = useState<FlujoChatbot>(flujo.draftNodes);
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardarBorrador() {
    setGuardando(true);
    try {
      await updateFlow(flujo.id, { draftNodes: borrador });
      setAviso('Borrador guardado. Todavía no atiende a nadie.');
      await onGuardado();
    } finally {
      setGuardando(false);
    }
  }

  async function publicar() {
    // Se comprueba antes de llamar para dar el aviso al instante; el servidor
    // vuelve a validar y es quien manda.
    if (validarFlujo(borrador).length) {
      setAviso('Corrige los problemas marcados antes de publicar.');
      return;
    }

    setGuardando(true);
    try {
      await updateFlow(flujo.id, { draftNodes: borrador });
      await publishFlow(flujo.id);
      setAviso(
        flujo.isActive
          ? 'Publicado. Ya atiende con la versión nueva.'
          : 'Publicado. Actívalo para que empiece a atender.',
      );
      await onGuardado();
    } catch {
      setAviso('No se pudo publicar. Revisa los problemas marcados.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white p-3">
        <input
          defaultValue={flujo.name}
          onBlur={(e) => {
            // Al salir del campo y no en cada tecla, por el mismo motivo que
            // el borrador.
            if (e.target.value !== flujo.name) {
              void updateFlow(flujo.id, { name: e.target.value }).then(
                onGuardado,
              );
            }
          }}
          aria-label="Nombre del flujo"
          className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-500"
        />
        <button
          onClick={() => void guardarBorrador()}
          disabled={guardando}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          Guardar borrador
        </button>
        <button
          onClick={() => void publicar()}
          disabled={guardando}
          className="flex items-center gap-1.5 rounded-md bg-brand-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-900 disabled:opacity-50"
        >
          <Rocket size={13} />
          Publicar
        </button>
      </div>

      {aviso && (
        <p
          role="status"
          className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-700"
        >
          {aviso}
        </p>
      )}

      <ChatbotFlowEditor flujo={borrador} onChange={setBorrador} />
    </>
  );
}
