'use client';

import Link from 'next/link';
import { ConversacionBandeja } from '@/lib/conversations';
import { antiguedadEnPalabras, timeAgo } from '@/lib/tiempo';
import { Avatar } from '@/components/ui/Avatar';

/**
 * Lo que hay que responder AHORA.
 *
 * LA PRIORIDAD SE MIDE, NO SE GUARDA. No existe un campo «urgencia» en una
 * conversación, así que inventarse uno sería un dato falso. Lo que sí es un
 * hecho es cuánto lleva esperando el cliente, y eso es exactamente lo que
 * ordena la lista y lo que colorea la insignia de tiempo.
 *
 * NADA DE ESTADOS EN INGLÉS. `status` llega como `OPEN`/`PENDING`/`CLOSED`
 * porque es un enum de base de datos; en pantalla se traduce. «OPEN» en una
 * lista de clientes no es un estado, es el nombre de una constante.
 *
 * INICIALES, NUNCA UNA FOTOGRAFÍA: regla del plan maestro (§3.1).
 */
const ESTADOS: Record<string, string> = {
  OPEN: 'Abierta',
  PENDING: 'Pendiente',
  CLOSED: 'Cerrada',
  ARCHIVED: 'Archivada',
};

/** Minutos a partir de los cuales la espera deja de ser normal. */
const UMBRAL_ATENCION = 60;
const UMBRAL_URGENTE = 180;

export function minutosEsperando(desde: string | null | undefined): number {
  if (!desde) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(desde).getTime()) / 60000));
}

export function nivelDeEspera(minutos: number): 'normal' | 'atencion' | 'urgente' {
  if (minutos >= UMBRAL_URGENTE) return 'urgente';
  if (minutos >= UMBRAL_ATENCION) return 'atencion';
  return 'normal';
}

const CLASES_ESPERA: Record<ReturnType<typeof nivelDeEspera>, string> = {
  // El color acompaña al texto, nunca lo sustituye: la insignia lleva dentro
  // el tiempo, así que en escala de grises no se pierde nada.
  normal: 'bg-neutral-100 text-content-secondary',
  atencion: 'bg-status-warning-surface text-status-warning-strong',
  urgente: 'bg-status-error-surface text-status-error',
};

export function ConversacionesPendientes({
  conversaciones,
}: {
  conversaciones: ConversacionBandeja[];
}) {
  // Primero quien lleva más tiempo esperando. El backend ordena por actividad
  // reciente, que para «sin responder» es justo al revés de lo que hace falta.
  const ordenadas = [...conversaciones].sort(
    (a, b) => minutosEsperando(b.lastMessageAt) - minutosEsperando(a.lastMessageAt),
  );

  return (
    <ul className="flex flex-col divide-y divide-line-default">
      {ordenadas.map((c) => {
        const ultimo = c.messages?.[0];
        const minutos = minutosEsperando(c.lastMessageAt);
        const nivel = nivelDeEspera(minutos);
        const estado = ESTADOS[c.status] ?? 'En curso';

        return (
          <li key={c.id} className="first:-mt-1 last:-mb-1">
            <Link
              href={`/dashboard/conversations?c=${encodeURIComponent(c.id)}`}
              // El nombre accesible dice quién, cuánto lleva esperando y
              // cuántos mensajes hay: lo que en la tarjeta va repartido en
              // tres esquinas.
              aria-label={`${c.contact.name}, ${c.unreadCount} sin leer, esperando ${antiguedadEnPalabras(c.lastMessageAt)}. Responder`}
              className="group flex items-start gap-3 rounded-md px-2 py-3 outline-none transition-colors duration-rapida ease-standard hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-line-focus"
            >
              <Avatar nombre={c.contact.name} size="md" />

              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-content-primary">
                    {c.contact.name}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums ${CLASES_ESPERA[nivel]}`}
                  >
                    {timeAgo(c.lastMessageAt)}
                  </span>
                </span>

                <span className="mt-0.5 block truncate text-xs text-content-secondary">
                  {/* `body` es nulo en los mensajes que solo llevan adjunto:
                      ahí se dice qué llegó, no un hueco. */}
                  {ultimo?.body?.trim() ||
                    (ultimo ? 'Adjunto sin texto.' : 'Sin mensajes todavía.')}
                </span>

                <span className="mt-1.5 flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="inline-flex items-center gap-1 text-[11px] text-content-secondary"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-neutral-300" />
                    {estado}
                    {c.channel ? ` · ${canal(c.channel)}` : ''}
                  </span>
                  {c.unreadCount > 0 && (
                    <span
                      aria-hidden="true"
                      className="rounded-full bg-brand-secondary px-1.5 py-px font-mono text-[11px] font-semibold tabular-nums text-brand-primary"
                    >
                      {c.unreadCount}
                    </span>
                  )}
                  <span
                    aria-hidden="true"
                    className="ml-auto shrink-0 rounded-md border border-line-default px-2.5 py-1 text-[11px] font-medium text-content-primary transition-colors duration-rapida ease-standard group-hover:border-brand-primary group-hover:bg-brand-primary group-hover:text-white"
                  >
                    Responder
                  </span>
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** `whatsapp` es el nombre del canal en base; en pantalla lleva mayúscula. */
function canal(valor: string): string {
  const conocidos: Record<string, string> = {
    whatsapp: 'WhatsApp',
    instagram: 'Instagram',
    web: 'Chat web',
  };
  return conocidos[valor.toLowerCase()] ?? valor;
}
