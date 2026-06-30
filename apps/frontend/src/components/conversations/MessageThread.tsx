import { useEffect, useRef } from 'react';
import { Message } from '@/types';

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function MessageThread({ messages }: { messages: Message[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {messages.length === 0 && (
        <p className="text-center text-sm text-stone-400">No hay mensajes todavía.</p>
      )}

      <div className="flex flex-col gap-2">
        {messages.map((msg) => {
          const isOutbound = msg.direction === 'OUTBOUND';
          return (
            <div
              key={msg.id}
              className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                  isOutbound
                    ? 'bg-stone-900 text-white'
                    : 'bg-white text-stone-800 border border-stone-200'
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.body}</p>
                <p
                  className={`mt-1 text-[10px] ${
                    isOutbound ? 'text-stone-300' : 'text-stone-400'
                  }`}
                >
                  {formatTime(msg.createdAt)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <div ref={bottomRef} />
    </div>
  );
}