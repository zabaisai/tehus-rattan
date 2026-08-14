import type { ConversacionBandeja } from '@/lib/conversations';
import { canalLegible } from '@/lib/conversations';
import { timeAgo } from '@/lib/tiempo';
import { Avatar } from '@/components/ui/Avatar';

const ETIQUETA_ESTADO: Record<string, string> = {
  OPEN: 'Abierta',
  PENDING: 'Pendiente',
  RESOLVED: 'Resuelta',
  CLOSED: 'Cerrada',
  ARCHIVED: 'Archivada',
};

/** El texto del último mensaje, si lo hay. La bandeja lo incluye ya. */
function extracto(conv: ConversacionBandeja): string | null {
  const ultimo = conv.messages?.[0];
  const cuerpo = (ultimo?.body ?? '').trim();
  return cuerpo || null;
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  seleccionadas,
  onToggleSeleccion,
}: {
  conversations: ConversacionBandeja[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Ids marcados para una acción masiva. */
  seleccionadas?: string[];
  onToggleSeleccion?: (id: string) => void;
}) {
  if (conversations.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-neutral-400">
        No hay conversaciones que coincidan.
      </div>
    );
  }

  const marcadas = new Set(seleccionadas ?? []);
  const permiteSeleccion = Boolean(onToggleSeleccion);

  return (
    <ul className="divide-y divide-neutral-100">
      {conversations.map((conv) => {
        const sinLeer = (conv.unreadCount ?? 0) > 0;
        const nombre = conv.contact.name || conv.contact.phone;
        const texto = extracto(conv);
        const seleccionada = selectedId === conv.id;

        return (
          <li
            key={conv.id}
            className={`flex items-start gap-2 px-2 transition-colors duration-150 ${
              seleccionada
                ? // Borde de acento a la izquierda además del fondo: el color
                  // solo no distingue la fila abierta para quien no lo percibe.
                  'border-l-2 border-l-brand-secondary bg-primary-50'
                : 'border-l-2 border-l-transparent hover:bg-neutral-50'
            }`}
          >
            {permiteSeleccion && (
              <input
                type="checkbox"
                checked={marcadas.has(conv.id)}
                onChange={() => onToggleSeleccion?.(conv.id)}
                aria-label={`Seleccionar la conversación de ${nombre}`}
                className="mt-4 shrink-0 accent-neutral-800"
              />
            )}

            <button
              type="button"
              onClick={() => onSelect(conv.id)}
              aria-current={seleccionada ? 'true' : undefined}
              className="flex min-w-0 flex-1 items-start gap-2.5 py-2.5 pr-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
            >
              <Avatar nombre={nombre} size="sm" className="mt-0.5" />

              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex w-full items-center justify-between gap-2">
                  <span
                    className={`truncate text-sm text-neutral-900 ${
                      // El peso extra es la señal que se capta sin mirar; el
                      // contador de color es la confirmación, no el aviso.
                      sinLeer ? 'font-semibold' : 'font-medium'
                    }`}
                  >
                    {nombre}
                  </span>
                  <span className="shrink-0 text-[11px] text-neutral-400">
                    {timeAgo(conv.lastMessageAt)}
                  </span>
                </span>

                {/* Extracto a una línea: es una pista para reconocer el hilo,
                    no el mensaje. Dejarlo crecer descuadraría la lista entera
                    con un solo mensaje largo. */}
                <span
                  className={`mt-0.5 line-clamp-1 break-words text-xs ${
                    texto ? 'text-neutral-500' : 'italic text-neutral-400'
                  }`}
                >
                  {texto ?? 'Sin mensajes todavía'}
                </span>

                <span className="mt-1 flex w-full flex-wrap items-center gap-1.5">
                  {sinLeer && (
                    <span
                      aria-label={`${conv.unreadCount} sin leer`}
                      className="rounded-full bg-secondary-500 px-1.5 py-0.5 text-[10px] font-semibold text-brand-primary"
                    >
                      {conv.unreadCount}
                    </span>
                  )}
                  <span className="text-[10px] text-neutral-500">
                    {canalLegible(conv.channel)}
                  </span>
                  {conv.isPaused && (
                    <span className="rounded bg-status-warning-surface px-1.5 py-0.5 text-[10px] font-medium text-status-warning-strong">
                      Pausada
                    </span>
                  )}
                  <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-600">
                    {ETIQUETA_ESTADO[conv.status] ?? conv.status}
                  </span>
                  {/* La etapa solo si HAY oportunidad: inventar una columna de
                      embudo para una consulta de soporte es contar una venta
                      que nadie abrió. */}
                  {conv.lead?.stage && (
                    <span className="max-w-[9rem] truncate rounded bg-secondary-50 px-1.5 py-0.5 text-[10px] font-medium text-secondary-700">
                      {conv.lead.stage.name}
                    </span>
                  )}
                  {/* "Sin asignar" se dice explícitamente: es lo que hay que
                      resolver, y en una bandeja compartida no verlo significa
                      que nadie la está atendiendo. */}
                  {conv.agent ? (
                    <span className="truncate text-[10px] text-neutral-500">
                      {conv.agent.name}
                    </span>
                  ) : (
                    <span className="text-[10px] font-medium text-secondary-700">
                      Sin asignar
                    </span>
                  )}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
