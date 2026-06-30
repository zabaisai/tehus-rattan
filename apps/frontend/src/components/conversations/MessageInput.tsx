'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';

export function MessageInput({
  onSend,
}: {
  onSend: (message: string) => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || sending) return;

    setSending(true);
    try {
      await onSend(trimmed);
      setValue('');
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2 border-t border-stone-200 bg-white p-3"
    >
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Escribe un mensaje..."
        className="flex-1 rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
      />
      <button
        type="submit"
        disabled={sending || !value.trim()}
        className="flex items-center justify-center rounded-md bg-stone-900 p-2 text-white hover:bg-stone-800 disabled:opacity-50"
      >
        <Send size={16} />
      </button>
    </form>
  );
}