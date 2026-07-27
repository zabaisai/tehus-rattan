"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PauseCircle, PlayCircle, ArrowLeft } from 'lucide-react';
import {
  getConversations,
  getMessages,
  sendMessage,
  pauseConversation,
  resumeConversation,
} from "@/lib/conversations";
import { ConversationList } from "@/components/conversations/ConversationList";
import { MessageThread } from "@/components/conversations/MessageThread";
import { MessageInput } from "@/components/conversations/MessageInput";

export default function ConversationsPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sendNotice, setSendNotice] = useState<string | null>(null);

  const { data: conversations } = useQuery({
    queryKey: ["conversations"],
    queryFn: getConversations,
    refetchInterval: 5000,
  });

  const { data: messages } = useQuery({
    queryKey: ["messages", selectedId],
    queryFn: () => getMessages(selectedId as string),
    enabled: !!selectedId,
    refetchInterval: 5000,
  });

  const selectedConversation =
    conversations?.find((c) => c.id === selectedId) ?? null;

  async function handleSend(message: string) {
    if (!selectedId) return;
    const created = await sendMessage(selectedId, message);
    await queryClient.invalidateQueries({ queryKey: ["messages", selectedId] });
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });

    setSendNotice(
      created.status === "FAILED"
        ? "El mensaje no se pudo enviar por WhatsApp. Quedó marcado como fallido en la conversación."
        : null,
    );
  }

  async function handleTogglePause() {
    if (!selectedConversation) return;
    if (selectedConversation.isPaused) {
      await resumeConversation(selectedConversation.id);
    } else {
      await pauseConversation(selectedConversation.id);
    }
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
  }

  return (
    <div className="flex h-full overflow-hidden rounded-lg border border-stone-200 bg-white">
      {/* Móvil: solo se muestra el listado O el chat, nunca ambos a la vez. */}
      <div
        className={`w-full shrink-0 overflow-y-auto border-stone-200 sm:block sm:w-72 sm:border-r ${
          selectedId ? 'hidden sm:block' : 'block'
        }`}
      >
        <ConversationList
          conversations={conversations ?? []}
          selectedId={selectedId}
          onSelect={(id) => {
            setSendNotice(null);
            setSelectedId(id);
          }}
        />
      </div>

      <div
        className={`flex-1 flex-col sm:flex ${selectedId ? 'flex' : 'hidden'}`}
      >
        {!selectedConversation && (
          <div className="flex flex-1 items-center justify-center text-sm text-stone-400">
            Selecciona una conversación
          </div>
        )}

        {selectedConversation && (
          <>
            <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  onClick={() => setSelectedId(null)}
                  aria-label="Volver al listado de conversaciones"
                  className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100 sm:hidden"
                >
                  <ArrowLeft size={18} />
                </button>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-stone-900">
                    {selectedConversation.contact.name ||
                      selectedConversation.contact.phone}
                  </p>
                  <p className="text-xs text-stone-400">
                    {selectedConversation.contact.phone}
                  </p>
                </div>
              </div>
              <button
                onClick={handleTogglePause}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${
                  selectedConversation.isPaused
                    ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                    : "bg-amber-50 text-amber-700 hover:bg-amber-100"
                }`}
              >
            {selectedConversation.isPaused ? (
                  <>
                    <PlayCircle size={14} />
                    Reanudar chatbot
                  </>
                ) : (
                  <>
                    <PauseCircle size={14} />
                    Pausar chatbot
                  </>
                )}
              </button>
            </div>

            {sendNotice && (
              <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs font-medium text-red-700">
                {sendNotice}
              </p>
            )}

            <MessageThread messages={messages ?? []} />
            <MessageInput onSend={handleSend} />
          </>
        )}
      </div>
    </div>
  );
}
