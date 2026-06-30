import { Conversation } from '@/types';

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

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
}: {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (conversations.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-stone-400">
        No hay conversaciones.
      </div>
    );
  }

  return (
    <div className="overflow-y-auto">
      {conversations.map((conv) => (
        <button
          key={conv.id}
          onClick={() => onSelect(conv.id)}
          className={`flex w-full flex-col items-start border-b border-stone-100 px-3 py-2.5 text-left transition-colors ${
            selectedId === conv.id ? 'bg-stone-100' : 'hover:bg-stone-50'
          }`}
        >
          <div className="flex w-full items-center justify-between">
            <span className="text-sm font-medium text-stone-900">
              {conv.contact.name || conv.contact.phone}
            </span>
            <span className="text-[11px] text-stone-400">
              {timeAgo(conv.lastMessageAt)}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            {conv.isPaused && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                Pausada
              </span>
            )}
            <span className="rounded bg-stone-200 px-1.5 py-0.5 text-[10px] text-stone-600">
              {conv.status}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}