'use client';

import { FlaskConical } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';

/**
 * «Modo demo», dicho donde no se pueda pasar por alto.
 *
 * POR QUÉ EXISTE. La empresa de demostración se comporta igual que una real
 * en todo salvo en lo que sale hacia fuera: no manda WhatsApp, no conecta con
 * Meta y no envía correo. Sin este aviso, quien la recorre interpreta ese
 * bloqueo como un producto roto. Con él, lo interpreta como lo que es.
 *
 * No es un banner que tape la pantalla: es una etiqueta en la cabecera, junto
 * al nombre de la empresa, visible en todas las pantallas y siempre en el
 * mismo sitio. Una demo no debería sentirse mutilada, solo acotada.
 */
export function DistintivoDemo() {
  const esDemo = useAuthStore((s) => s.user?.company?.isDemo);
  if (!esDemo) return null;

  return (
    <span
      // `status` y no `alert`: informa de una condición permanente de la
      // sesión, no de algo que acaba de pasar.
      role="status"
      title="Los envíos de WhatsApp, la conexión con Meta y el correo están desactivados en esta empresa."
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-secondary-700/30 bg-secondary-100 px-2.5 py-1 text-xs font-medium text-secondary-700"
    >
      <FlaskConical size={13} aria-hidden="true" />
      Modo demo
    </span>
  );
}
