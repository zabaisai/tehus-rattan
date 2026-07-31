import type { ConversacionBandeja } from '@/lib/conversations';

function timeAgo(dateStr: string | null) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const ETIQUETA_ESTADO: Record<string, string> = {
  OPEN: 'Abierta',
  PENDING: 'Pendiente',
  RESOLVED: 'Resuelta',
  CLOSED: 'Cerrada',
  ARCHIVED: 'Archivada',
};

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
      <div className="p-4 text-center text-sm text-stone-400">
        No hay conversaciones que coincidan.
      </div>
    );
  }

  const marcadas = new Set(seleccionadas ?? []);
  const permiteSeleccion = Boolean(onToggleSeleccion);

  return (
    <div className="overflow-y-auto">
      {conversations.map((conv) => {
        const sinLeer = (conv.unreadCount ?? 0) > 0;

        return (
          <div
            key={conv.id}
            className={`flex items-start gap-2 border-b border-stone-100 px-2 transition-colors ${
              selectedId === conv.id ? 'bg-stone-100' : 'hover:bg-stone-50'
            }`}
          >
            {permiteSeleccion && (
              <input
                type="checkbox"
                checked={marcadas.has(conv.id)}
                onChange={() => onToggleSeleccion?.(conv.id)}
                aria-label={`Seleccionar la conversación de ${
                  conv.contact.name || conv.contact.phone
                }`}
                className="mt-3.5 shrink-0 accent-stone-800"
              />
            )}

            <button
              onClick={() => onSelect(conv.id)}
              className="flex min-w-0 flex-1 flex-col items-start py-2.5 pr-1 text-left"
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span
                  className={`truncate text-sm text-stone-900 ${
                    // El peso extra es la señal que se capta sin mirar; el
                    // contador de color es la confirmación, no el aviso.
                    sinLeer ? 'font-semibold' : 'font-medium'
                  }`}
                >
                  {conv.contact.name || conv.contact.phone}
                </span>
                <span className="shrink-0 text-[11px] text-stone-400">
                  {timeAgo(conv.lastMessageAt)}
                </span>
              </div>

              <div className="mt-1 flex w-full flex-wrap items-center gap-1.5">
                {sinLeer && (
                  <span
                    aria-label={`${conv.unreadCount} sin leer`}
                    className="rounded-full bg-secondary-500 px-1.5 py-0.5 text-[10px] font-semibold text-brand-primary"
                  >
                    {conv.unreadCount}
                  </span>
                )}
                {conv.isPaused && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                    Pausada
                  </span>
                )}
                <span className="rounded bg-stone-200 px-1.5 py-0.5 text-[10px] text-stone-600">
                  {ETIQUETA_ESTADO[conv.status] ?? conv.status}
                </span>
                {/* "Sin asignar" se dice explícitamente: es lo que hay que
                    resolver, y en una bandeja compartida no verlo significa
                    que nadie la está atendiendo. */}
                {conv.agent ? (
                  <span className="truncate text-[10px] text-stone-500">
                    {conv.agent.name}
                  </span>
                ) : (
                  <span className="text-[10px] font-medium text-secondary-700">
                    Sin asignar
                  </span>
                )}
              </div>
            </button>
          </div>
        );
      })}
    </div>
  );
}
