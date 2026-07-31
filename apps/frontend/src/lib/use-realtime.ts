"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EVENTS, getRealtimeSocket } from "./realtime";

/**
 * Cada cuánto refresca React Query según haya canal o no.
 *
 * EL POLLING NO SE QUITA NUNCA. Con el canal vivo se relaja a 30 s, que actúa
 * de red de seguridad ante un evento perdido —una reconexión a medias, un
 * worker sin puente de Redis— sin castigar al backend. Sin canal vuelve a 5 s,
 * el comportamiento de siempre. Suprimir el polling del todo convertiría el
 * WebSocket en un punto único de fallo, y su caída se manifestaría como "el
 * CRM no actualiza", que es de los síntomas más difíciles de diagnosticar.
 */
export const POLL_EN_VIVO_MS = 30_000;
export const POLL_SIN_CANAL_MS = 5_000;

export function intervaloDeRefresco(enVivo: boolean): number {
  return enVivo ? POLL_EN_VIVO_MS : POLL_SIN_CANAL_MS;
}

/**
 * Conecta el canal y traduce sus eventos a invalidaciones de React Query.
 *
 * Deliberadamente NO escribe en la caché con los datos del evento: el evento
 * solo avisa de que algo cambió y la recarga va por la API, que aplica los
 * permisos del usuario. Así el canal nunca puede mostrar algo que la API no
 * habría devuelto.
 *
 * @param conversationId hilo abierto, si lo hay: se suscribe a su sala.
 */
export function useRealtime(conversationId?: string | null): {
  enVivo: boolean;
} {
  const queryClient = useQueryClient();
  const [enVivo, setEnVivo] = useState(false);

  useEffect(() => {
    const socket = getRealtimeSocket();
    if (!socket) return;

    const invalidar = (queryKey: unknown[]) => {
      void queryClient.invalidateQueries({ queryKey });
    };

    const alConectar = () => {
      setEnVivo(true);
      // Tras una reconexión pudieron pasar cosas mientras no había canal, así
      // que se recarga todo lo visible en vez de confiar en no haber perdido
      // ningún evento.
      invalidar(["conversations"]);
      invalidar(["notifications"]);
    };
    const alDesconectar = () => setEnVivo(false);

    socket.on("connect", alConectar);
    socket.on("disconnect", alDesconectar);
    socket.on("connect_error", alDesconectar);

    const enMensaje = (p: { conversationId?: string }) => {
      invalidar(["conversations"]);
      if (p?.conversationId) invalidar(["messages", p.conversationId]);
    };

    socket.on(EVENTS.MESSAGE_CREATED, enMensaje);
    socket.on(EVENTS.MESSAGE_STATUS_CHANGED, enMensaje);
    socket.on(EVENTS.CONVERSATION_UPDATED, () => invalidar(["conversations"]));
    socket.on(EVENTS.LEAD_UPDATED, () => {
      invalidar(["leads"]);
      invalidar(["pipeline"]);
    });
    socket.on(EVENTS.TASK_UPDATED, () => invalidar(["tasks"]));
    socket.on(EVENTS.NOTIFICATION_CREATED, () => invalidar(["notifications"]));

    if (socket.connected) alConectar();
    else socket.connect();

    return () => {
      socket.off("connect", alConectar);
      socket.off("disconnect", alDesconectar);
      socket.off("connect_error", alDesconectar);
      socket.off(EVENTS.MESSAGE_CREATED, enMensaje);
      socket.off(EVENTS.MESSAGE_STATUS_CHANGED, enMensaje);
      socket.off(EVENTS.CONVERSATION_UPDATED);
      socket.off(EVENTS.LEAD_UPDATED);
      socket.off(EVENTS.TASK_UPDATED);
      socket.off(EVENTS.NOTIFICATION_CREATED);
    };
  }, [queryClient]);

  // Suscripción al hilo abierto. El servidor comprueba contra la base que la
  // conversación es de la empresa del token antes de aceptar; aquí solo se
  // pide. Un id ajeno se rechaza allí, no aquí.
  useEffect(() => {
    const socket = getRealtimeSocket();
    if (!socket || !conversationId) return;

    const suscribir = () => socket.emit("conversation:subscribe", { conversationId });
    suscribir();
    // Tras reconectar hay que volver a pedirla: las salas viven en el servidor
    // y se pierden con el socket anterior.
    socket.on("connect", suscribir);

    return () => {
      socket.off("connect", suscribir);
      socket.emit("conversation:unsubscribe", { conversationId });
    };
  }, [conversationId]);

  return { enVivo };
}
