'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  Bot,
  Clock,
  MoreVertical,
  Pencil,
  PlayCircle,
  Target,
  UserRound,
  X,
} from 'lucide-react';
import api from '@/lib/axios';
import { flowbots, ESTADO_EJECUCION } from '@/lib/flowbots';
import { getCompanyUsers } from '@/lib/users';
import { resumeConversation } from '@/lib/conversations';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { mensajeDeError } from '@/components/ui/ListState';
import type { Conversation } from '@/types';
import { NOMBRE_PULSO } from '@/lib/producto';

interface ContactoCompleto {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  tags: string[];
  isBlocked: boolean;
  archivedAt: string | null;
  archivedReason: string | null;
}

/**
 * Quién es esta persona, sin salir de la conversación.
 *
 * El asesor decide el siguiente paso MIENTRAS lee el mensaje. Obligarle a
 * abrir la ficha en otra pantalla, buscarla y volver es exactamente el momento
 * en el que el seguimiento se pierde.
 */
export function PanelContacto({
  conversation,
  onCerrar,
}: {
  conversation: Conversation;
  onCerrar: () => void;
}) {
  const queryClient = useQueryClient();

  const [menuAbierto, setMenuAbierto] = useState(false);
  const [archivando, setArchivando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const contactoId = conversation.contact?.id;

  const contacto = useQuery({
    queryKey: ['contacts', contactoId],
    queryFn: async () => {
      const { data } = await api.get<ContactoCompleto>(
        `/contacts/${contactoId}`,
      );
      return data;
    },
    enabled: !!contactoId,
  });

  const campos = useQuery({
    queryKey: ['custom-fields', 'values', contactoId],
    queryFn: async () => {
      const { data } = await api.get<
        Array<{ key: string; label: string; value: unknown }>
      >('/custom-fields/values', {
        params: { entity: 'CONTACT', entityId: contactoId },
      });
      return data;
    },
    enabled: !!contactoId,
  });

  const { data: asesores } = useQuery({
    queryKey: ['users'],
    queryFn: getCompanyUsers,
    staleTime: 5 * 60_000,
  });

  // Qué está haciendo el bot en ESTA conversación. Es lo primero que hay que
  // saber antes de escribir: contestar encima de un bot que está esperando una
  // respuesta deja al cliente con dos interlocutores a la vez.
  const ejecucion = useQuery({
    queryKey: ['flowbots', 'execution', 'conversacion', conversation.id],
    queryFn: async () => {
      const pagina = await flowbots.ejecuciones(
        { conversationId: conversation.id },
        { limite: 1 },
      );
      return pagina.items[0] ?? null;
    },
    refetchInterval: 20_000,
  });

  async function conAviso(accion: () => Promise<unknown>, respaldo: string) {
    setError(null);
    setOcupado(true);
    try {
      await accion();
      await queryClient.invalidateQueries({ queryKey: ['contacts'] });
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
      return true;
    } catch (e) {
      setError(mensajeDeError(e) || respaldo);
      return false;
    } finally {
      setOcupado(false);
    }
  }

  const c = contacto.data;
  const archivado = !!c?.archivedAt;
  const ej = ejecucion.data;

  return (
    <aside
      aria-label="Ficha del contacto"
      className="flex h-full w-full flex-col overflow-y-auto border-l border-neutral-200 bg-white"
    >
      <div className="flex items-start justify-between gap-2 border-b border-neutral-200 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-neutral-900">
            {c?.name || conversation.contact?.name || conversation.contact?.phone}
          </p>
          <p className="text-xs text-neutral-500">
            {c?.phone ?? conversation.contact?.phone}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <div className="relative">
            <button
              type="button"
              aria-label="Acciones del contacto"
              aria-expanded={menuAbierto}
              aria-haspopup="menu"
              onClick={() => setMenuAbierto((v) => !v)}
              className="rounded p-1 text-neutral-400 outline-none hover:bg-neutral-100 hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-line-focus"
            >
              <MoreVertical size={16} />
            </button>

            {menuAbierto && (
              <>
                <button
                  type="button"
                  aria-hidden="true"
                  tabIndex={-1}
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setMenuAbierto(false)}
                />
                <div
                  role="menu"
                  className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-neutral-200 bg-white py-1 shadow-lg"
                >
                  <Link
                    href={`/dashboard/contacts?id=${contactoId ?? ''}`}
                    role="menuitem"
                    onClick={() => setMenuAbierto(false)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-700 outline-none hover:bg-neutral-50 focus-visible:bg-neutral-50"
                  >
                    <Pencil size={13} className="text-neutral-400" />
                    Editar el contacto
                  </Link>

                  {conversation.isPaused && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuAbierto(false);
                        void conAviso(
                          () => resumeConversation(conversation.id),
                          'No se pudo devolver la conversación al bot.',
                        );
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-700 outline-none hover:bg-neutral-50 focus-visible:bg-neutral-50"
                    >
                      <PlayCircle size={13} className="text-neutral-400" />
                      Devolver al bot
                    </button>
                  )}

                  {ej && (
                    <Link
                      href={`/dashboard/flowbots/executions/${ej.id}`}
                      role="menuitem"
                      onClick={() => setMenuAbierto(false)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-700 outline-none hover:bg-neutral-50 focus-visible:bg-neutral-50"
                    >
                      <Bot size={13} className="text-neutral-400" />
                      Ver qué hizo el bot
                    </Link>
                  )}

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuAbierto(false);
                      if (archivado) {
                        void conAviso(
                          () => api.post(`/contacts/${contactoId}/restore`),
                          'No se pudo restaurar el contacto.',
                        );
                      } else {
                        setArchivando(true);
                      }
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-700 outline-none hover:bg-neutral-50 focus-visible:bg-neutral-50"
                  >
                    {archivado ? (
                      <>
                        <ArchiveRestore size={13} className="text-neutral-400" />
                        Restaurar el contacto
                      </>
                    ) : (
                      <>
                        <Archive size={13} className="text-neutral-400" />
                        Archivar el contacto
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar la ficha"
            className="rounded p-1 text-neutral-400 outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-line-focus"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
        >
          {error}
        </p>
      )}

      {archivado && (
        <p className="border-b border-status-warning bg-status-warning-surface px-3 py-2 text-[11px] text-status-warning">
          Contacto archivado
          {c?.archivedReason ? `: ${c.archivedReason}` : ''}. Sigue apareciendo
          aquí y conserva su historial.
        </p>
      )}

      <div className="space-y-3 p-3">
        {ej && (
          <Seccion titulo={NOMBRE_PULSO} icono={Bot}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={ESTADO_EJECUCION[ej.estado]?.tono ?? 'neutral'}>
                {ESTADO_EJECUCION[ej.estado]?.etiqueta ?? ej.estado}
              </Badge>
              <span className="text-[11px] text-neutral-600">
                {ej.botNombre}
              </span>
            </div>
            {(ej.estado === 'WAITING_INPUT' || ej.estado === 'WAITING_TIME') && (
              <p className="flex items-center gap-1 text-[11px] text-neutral-500">
                <Clock size={11} />
                El bot está esperando. Si escribes tú, atiende la conversación
                una persona.
              </p>
            )}
            {ej.hayHandoff && (
              <p className="flex items-center gap-1 text-[11px] text-status-info">
                <UserRound size={11} />
                El bot ya la pasó a una persona.
              </p>
            )}
            <Link
              href={`/dashboard/flowbots/executions/${ej.id}`}
              className="text-[11px] text-brand-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-line-focus"
            >
              Ver el recorrido completo
            </Link>
          </Seccion>
        )}

        <Seccion titulo="Contacto" icono={UserRound}>
          <Campo etiqueta="Teléfono" valor={c?.phone ?? conversation.contact?.phone} />
          <Campo etiqueta="Correo" valor={c?.email} />
          <Campo
            etiqueta="Responsable"
            valor={
              conversation.agent?.name ??
              asesores?.find((a) => a.id === conversation.agent?.id)?.name ??
              'Sin asignar'
            }
          />
          {(c?.tags?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {c!.tags.map((t) => (
                <Badge key={t} tone="info">
                  {t}
                </Badge>
              ))}
            </div>
          )}
        </Seccion>

        {(campos.data?.length ?? 0) > 0 && (
          <Seccion titulo="Campos personalizados" icono={Pencil}>
            {campos.data!.map((campo) => (
              <Campo
                key={campo.key}
                etiqueta={campo.label}
                valor={campo.value === null ? null : String(campo.value)}
              />
            ))}
          </Seccion>
        )}

        {conversation.lead && (
          <Seccion titulo="Oportunidad" icono={Target}>
            <Campo etiqueta="Título" valor={conversation.lead.title} />
            <Campo
              etiqueta="Etapa"
              valor={conversation.lead.stage?.name ?? 'Sin etapa'}
            />
            <Link
              href="/dashboard/pipeline"
              className="text-[11px] text-brand-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-line-focus"
            >
              Ver en el tablero
            </Link>
          </Seccion>
        )}
      </div>

      {archivando && (
        <Modal
          title="Archivar este contacto"
          onClose={() => setArchivando(false)}
          maxWidth="sm"
        >
          <div className="space-y-3 text-sm">
            {/* Se dice EXACTAMENTE qué pasa. La palabra «eliminar» hace pensar
                que se borra todo, y aquí no se borra nada: por eso el producto
                lo llama archivar y lo explica. */}
            <p className="text-neutral-600">
              No se borra nada. Sus conversaciones, sus mensajes y sus
              oportunidades se conservan; lo que cambia es que deja de aparecer
              en las listas de trabajo y los bots no arrancan solos con él.
            </p>
            <p className="text-neutral-600">
              Si vuelve a escribir, se reactiva o se registra sin reabrir, según
              lo que tengas configurado. Puedes restaurarlo cuando quieras.
            </p>
            <p className="rounded-md bg-neutral-50 px-2.5 py-1.5 text-[11px] text-neutral-600">
              Para borrar de verdad los datos de una persona existe la solicitud
              de eliminación, que es un camino aparte y deja constancia.
            </p>

            <label className="block">
              <span className="text-xs font-medium text-neutral-700">
                Por qué <span className="text-neutral-400">(opcional)</span>
              </span>
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                maxLength={300}
                className="mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
              />
              <span className="text-[10px] text-neutral-400">
                Queda registrado junto a la acción.
              </span>
            </label>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setArchivando(false)}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                disabled={ocupado}
                onClick={async () => {
                  const ok = await conAviso(
                    () =>
                      api.delete(`/contacts/${contactoId}`, {
                        data: { motivo: motivo.trim() || undefined },
                      }),
                    'No se pudo archivar el contacto.',
                  );
                  if (ok) {
                    setArchivando(false);
                    setMotivo('');
                  }
                }}
              >
                {ocupado ? 'Archivando…' : 'Archivar'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </aside>
  );
}

function Seccion({
  titulo,
  icono: Icono,
  children,
}: {
  titulo: string;
  icono: typeof UserRound;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 p-2.5">
      <h3 className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        <Icono size={11} />
        {titulo}
      </h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function Campo({
  etiqueta,
  valor,
}: {
  etiqueta: string;
  valor: string | null | undefined;
}) {
  return (
    <div className="flex justify-between gap-2 text-[11px]">
      <span className="shrink-0 text-neutral-500">{etiqueta}</span>
      <span className="min-w-0 truncate text-right text-neutral-800">
        {valor || '—'}
      </span>
    </div>
  );
}
