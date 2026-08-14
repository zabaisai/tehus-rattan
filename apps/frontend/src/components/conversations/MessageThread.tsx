import { useEffect, useRef } from 'react';
import { Message } from '@/types';

/**
 * El hilo exacto de una conversación.
 *
 * Tres decisiones que no son de estilo:
 *
 * 1. **El orden es el del servidor.** No se reordena aquí: el backend ya los
 *    devuelve por fecha, y reordenar en la pantalla crea una segunda verdad que
 *    diverge en cuanto llega un mensaje con la hora del proveedor.
 * 2. **Entrante y saliente se distinguen con palabras**, no solo con el color y
 *    el lado. Quien no percibe la diferencia entre la burbuja azul y la blanca
 *    necesita igualmente saber quién escribió.
 * 3. **No se inventan eventos de sistema.** En el esquema no hay mensajes de
 *    tipo SYSTEM, así que el hilo no dibuja «el bot transfirió la conversación»
 *    aunque el mockup lo enseñe: eso se cuenta en la cabecera, donde sí hay un
 *    contrato (`/conversations/:id/handoff`) que lo respalda.
 */

const NOMBRE_DEL_TIPO: Record<string, string> = {
  IMAGE: 'Imagen',
  AUDIO: 'Audio',
  VIDEO: 'Video',
  DOCUMENT: 'Documento',
  STICKER: 'Sticker',
  LOCATION: 'Ubicación',
  CONTACTS: 'Contacto compartido',
  INTERACTIVE: 'Mensaje interactivo',
  REACTION: 'Reacción',
  TEMPLATE: 'Plantilla',
};

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Clave de día local. Comparar cadenas ISO agruparía mal cerca de medianoche. */
function claveDeDia(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function etiquetaDeDia(iso: string): string {
  const hoy = new Date();
  const ayer = new Date(hoy.getTime() - 24 * 60 * 60 * 1000);
  const clave = claveDeDia(iso);
  if (clave === claveDeDia(hoy.toISOString())) return 'Hoy';
  if (clave === claveDeDia(ayer.toISOString())) return 'Ayer';
  return new Date(iso).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export function MessageThread({ messages }: { messages: Message[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // `scrollIntoView` no existe en jsdom y tampoco en algún navegador viejo:
    // sin la comprobación, el hilo entero deja de renderizarse por no poder
    // desplazarse, que es un precio absurdo.
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <p className="text-center text-sm text-neutral-400">
          No hay mensajes todavía.
        </p>
      </div>
    );
  }

  // Los separadores se calculan ANTES de pintar, no mutando una variable
  // dentro del `map`: reasignar durante el render es justo lo que rompe cuando
  // React reintenta un renderizado interrumpido.
  const filas = messages.map((msg, i) => ({
    msg,
    nuevoDia:
      i === 0 || claveDeDia(msg.createdAt) !== claveDeDia(messages[i - 1].createdAt),
  }));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <ul
        // `log`: el lector de pantalla lo trata como un registro que crece, que
        // es exactamente lo que es.
        role="log"
        aria-label="Mensajes de la conversación"
        className="flex flex-col gap-2"
      >
        {filas.map(({ msg, nuevoDia }) => {
          const isOutbound = msg.direction === 'OUTBOUND';
          const isFailed = msg.status === 'FAILED';
          const nombreDelTipo =
            msg.type && msg.type !== 'TEXT'
              ? (NOMBRE_DEL_TIPO[msg.type] ?? 'Adjunto')
              : null;
          const cuerpo = (msg.body ?? '').trim();

          return (
            <li key={msg.id} className="contents">
              {nuevoDia && (
                <div
                  role="separator"
                  className="my-1 flex items-center gap-2 text-[11px] text-neutral-400"
                >
                  <span className="h-px flex-1 bg-neutral-200" />
                  <span>{etiquetaDeDia(msg.createdAt)}</span>
                  <span className="h-px flex-1 bg-neutral-200" />
                </div>
              )}

              <div
                className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`min-w-0 max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                    isFailed
                      ? 'border border-status-error/30 bg-status-error-surface text-status-error'
                      : isOutbound
                        ? 'bg-brand-primary text-white'
                        : 'border border-neutral-200 bg-white text-neutral-800'
                  }`}
                >
                  <span className="sr-only">
                    {isOutbound ? 'Enviado' : 'Recibido'}
                  </span>

                  {nombreDelTipo && (
                    <p
                      className={`text-[11px] font-medium ${
                        isOutbound && !isFailed
                          ? 'text-secondary-200'
                          : 'text-neutral-500'
                      }`}
                    >
                      {nombreDelTipo}
                    </p>
                  )}

                  {cuerpo && (
                    <p className="whitespace-pre-wrap break-words">{cuerpo}</p>
                  )}

                  <p
                    className={`mt-1 text-[10px] ${
                      isFailed
                        ? 'font-medium text-status-error'
                        : isOutbound
                          ? 'text-neutral-300'
                          : 'text-neutral-400'
                    }`}
                  >
                    {isFailed
                      ? 'No se pudo enviar'
                      : formatTime(msg.createdAt)}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <div ref={bottomRef} />
    </div>
  );
}
