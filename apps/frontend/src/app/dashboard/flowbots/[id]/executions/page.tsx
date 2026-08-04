'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { flowbots } from '@/lib/flowbots';
import { ListaEjecuciones } from '@/components/flowbots/ListaEjecuciones';

export default function EjecucionesDeBotPage() {
  const { id } = useParams<{ id: string }>();
  const parametros = useSearchParams();

  const bot = useQuery({
    queryKey: ['flowbots', id],
    queryFn: () => flowbots.detalle(id),
  });

  return (
    <div className="space-y-5">
      <div>
        <Link
          href={`/dashboard/flowbots/${id}`}
          className="inline-flex items-center gap-1 text-xs text-neutral-500 outline-none hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-line-focus"
        >
          <ArrowLeft size={14} />
          Volver al bot
        </Link>
        <h2 className="mt-1 text-xl font-semibold text-neutral-900">
          Ejecuciones {bot.data ? `de ${bot.data.nombre}` : ''}
        </h2>
        <p className="text-sm text-neutral-500">
          Cada conversación que este bot ha atendido.
        </p>
      </div>

      <ListaEjecuciones
        botId={id}
        estadoInicial={parametros.get('estado') ?? ''}
      />
    </div>
  );
}
