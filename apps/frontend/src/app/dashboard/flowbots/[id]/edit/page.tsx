'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Monitor } from 'lucide-react';
import { flowbots, type GrafoFlow, type ResultadoValidacion } from '@/lib/flowbots';
import { permisosDe } from '@/lib/flowbot-permisos';
import { useAuthStore } from '@/store/auth.store';
import { ListState } from '@/components/ui/ListState';
import { Editor } from '@/components/flowbots/builder/Editor';
import { DialogoPublicar } from '@/components/flowbots/DialogoPublicar';
import { PanelSimulador } from '@/components/flowbots/PanelSimulador';
import { SinPermiso } from '@/components/flowbots/SinPermiso';
import { EstadoTransporte } from '@/components/flowbots/EstadoTransporte';

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const rol = useAuthStore((s) => s.user?.role);
  const permisos = permisosDe(rol);

  const [publicando, setPublicando] = useState<GrafoFlow | null>(null);
  const [simulando, setSimulando] = useState<GrafoFlow | null>(null);
  const [validacion, setValidacion] = useState<ResultadoValidacion | null>(null);
  const [estrecho, setEstrecho] = useState(false);

  // El editor necesita sitio de verdad. En una pantalla pequeña no se
  // "adapta": se dice que hace falta una más grande y se deja consultar, que
  // es lo único que se puede hacer bien ahí.
  useEffect(() => {
    const consulta = window.matchMedia('(max-width: 1023px)');
    const alCambiar = () => setEstrecho(consulta.matches);
    alCambiar();
    consulta.addEventListener('change', alCambiar);
    return () => consulta.removeEventListener('change', alCambiar);
  }, []);

  /**
   * Se revalida al abrir el diálogo de publicación.
   *
   * El editor ya valida mientras se edita, pero entre la última revisión y el
   * clic pueden haber entrado cambios, y publicar es justo el momento en el
   * que no se puede ir con información vieja.
   */
  useEffect(() => {
    if (!publicando) return;
    let vigente = true;
    void flowbots.validar(publicando).then((r) => {
      if (vigente) setValidacion(r);
    });
    return () => {
      vigente = false;
    };
  }, [publicando]);

  const bot = useQuery({
    queryKey: ['flowbots', id],
    queryFn: () => flowbots.detalle(id),
  });

  const catalogo = useQuery({
    queryKey: ['flowbots', 'catalog'],
    queryFn: flowbots.catalogo,
    staleTime: 30 * 60_000,
  });

  const borrador = useQuery({
    queryKey: ['flowbots', id, 'draft'],
    queryFn: () => flowbots.borrador(id),
  });

  if (!permisos.puedeEditar) {
    return (
      <SinPermiso mensaje="Para diseñar bots necesitas permisos de administración." />
    );
  }

  const cargando = bot.isLoading || catalogo.isLoading || borrador.isLoading;
  const fallo = bot.isError || catalogo.isError || borrador.isError;

  if (cargando || fallo || !bot.data || !catalogo.data || !borrador.data) {
    return (
      <ListState
        isLoading={cargando}
        isError={fallo}
        isEmpty={false}
        error={bot.error ?? catalogo.error ?? borrador.error}
        onRetry={() => {
          void bot.refetch();
          void catalogo.refetch();
          void borrador.refetch();
        }}
        emptyMessage=""
        loadingMessage="Abriendo el editor…"
      />
    );
  }

  return (
    <div className="-m-4 flex h-[calc(100vh-4rem)] flex-col md:-m-6">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-white px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={`/dashboard/flowbots/${id}`}
            aria-label="Volver a la ficha del bot"
            className="rounded p-1 text-neutral-400 outline-none hover:bg-neutral-100 hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-line-focus"
          >
            <ArrowLeft size={16} />
          </Link>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-neutral-900">
              {bot.data.nombre}
            </p>
            <p className="text-[11px] text-neutral-500">
              {bot.data.versionPublicada
                ? `Editando el borrador · versión ${bot.data.versionPublicada} publicada`
                : 'Editando el borrador · sin publicar'}
            </p>
          </div>
        </div>
      </div>

      <div className="border-b border-neutral-200 bg-white px-3 py-1.5">
        <EstadoTransporte compacto />
      </div>

      {estrecho && (
        <p className="flex items-start gap-2 border-b border-status-info bg-status-info-surface px-3 py-2 text-[11px] text-status-info">
          <Monitor size={13} className="mt-px shrink-0" />
          Puedes mirar el flujo, pero para moverlo y conectarlo hace falta una
          pantalla más grande. Ábrelo en un computador.
        </p>
      )}

      <div className="min-h-0 flex-1">
        <div className="flex h-full min-h-0">
          <div className="min-w-0 flex-1">
            <Editor
              botId={id}
              nombre={bot.data.nombre}
              catalogo={catalogo.data}
              grafoInicial={borrador.data.graph}
              revisionInicial={borrador.data.revision}
              soloLectura={estrecho}
              onPublicar={(g) => setPublicando(g)}
              onSimular={(g) => setSimulando(g)}
            />
          </div>

          {simulando && (
            <div className="hidden w-80 shrink-0 xl:block">
              <PanelSimulador
                grafo={simulando}
                onResaltar={() => undefined}
                onCerrar={() => setSimulando(null)}
              />
            </div>
          )}
        </div>
      </div>

      {publicando && (
        <DialogoPublicar
          botId={id}
          grafo={publicando}
          validacion={validacion}
          versionActual={bot.data.versionPublicada}
          onCerrar={() => {
            setPublicando(null);
            setValidacion(null);
          }}
          onPublicado={async (version) => {
            setPublicando(null);
            setValidacion(null);
            await queryClient.invalidateQueries({ queryKey: ['flowbots'] });
            router.push(`/dashboard/flowbots/${id}?publicada=${version}`);
          }}
        />
      )}
    </div>
  );
}

