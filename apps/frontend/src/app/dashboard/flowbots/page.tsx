'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bot,
  Copy,
  History,
  ListOrdered,
  Pause,
  Pencil,
  Play,
  Plus,
  Archive,
  ArchiveRestore,
  Search,
  MoreVertical,
} from 'lucide-react';
import { flowbots, type BotResumen } from '@/lib/flowbots';
import { permisosDe } from '@/lib/flowbot-permisos';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/ui/Button';
import { ListState, mensajeDeError } from '@/components/ui/ListState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EstadoBot, estadoVisible } from '@/components/flowbots/EstadoBot';
import { EstadoTransporte } from '@/components/flowbots/EstadoTransporte';
import { PanelEnvios } from '@/components/flowbots/PanelEnvios';

type Orden = 'reciente' | 'nombre' | 'ejecuciones' | 'errores';

const ORDENES: Array<{ id: Orden; etiqueta: string }> = [
  { id: 'reciente', etiqueta: 'Modificados hace poco' },
  { id: 'nombre', etiqueta: 'Nombre' },
  { id: 'ejecuciones', etiqueta: 'Más usados' },
  { id: 'errores', etiqueta: 'Con más errores' },
];

const FILTROS: Array<{ id: string; etiqueta: string }> = [
  { id: 'todos', etiqueta: 'Todos' },
  { id: 'ACTIVE', etiqueta: 'Activos' },
  { id: 'PAUSED', etiqueta: 'Pausados' },
  { id: 'DRAFT', etiqueta: 'Borradores' },
  { id: 'ARCHIVED', etiqueta: 'Archivados' },
];

const POR_PAGINA = 12;

export default function FlowBotsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const rol = useAuthStore((s) => s.user?.role);
  const permisos = permisosDe(rol);

  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState('todos');
  const [orden, setOrden] = useState<Orden>('reciente');
  const [pagina, setPagina] = useState(0);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<{
    bot: BotResumen;
    accion: 'archivar' | 'restaurar';
  } | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['flowbots', filtro],
    queryFn: () =>
      flowbots.listar({
        estado: filtro === 'todos' || filtro === 'ARCHIVED' ? undefined : filtro,
        // Los archivados no aparecen salvo que se pidan: son los que alguien
        // retiró a propósito y verlos mezclados hace dudar de si siguen vivos.
        incluirArchivados: filtro === 'ARCHIVED' || filtro === 'todos',
      }),
  });

  // El filtrado por texto y el orden se hacen aquí porque la lista de bots de
  // una empresa se cuenta con los dedos: pedir al servidor en cada tecla sería
  // más lento y además parpadearía.
  const visibles = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    let lista = data ?? [];

    if (filtro === 'ARCHIVED') {
      lista = lista.filter((b) => b.estado === 'ARCHIVED');
    } else if (filtro === 'todos') {
      lista = lista.filter((b) => b.estado !== 'ARCHIVED');
    }

    if (texto) {
      lista = lista.filter(
        (b) =>
          b.nombre.toLowerCase().includes(texto) ||
          (b.descripcion ?? '').toLowerCase().includes(texto),
      );
    }

    const ordenada = [...lista];
    ordenada.sort((a, b) => {
      if (orden === 'nombre') return a.nombre.localeCompare(b.nombre);
      if (orden === 'ejecuciones')
        return b.metricas.ejecucionesTotales - a.metricas.ejecucionesTotales;
      if (orden === 'errores') return b.metricas.errores - a.metricas.errores;
      return (
        new Date(b.actualizadoEn).getTime() -
        new Date(a.actualizadoEn).getTime()
      );
    });
    return ordenada;
  }, [data, busqueda, filtro, orden]);

  const paginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA));
  const paginaActual = Math.min(pagina, paginas - 1);
  const enPantalla = visibles.slice(
    paginaActual * POR_PAGINA,
    paginaActual * POR_PAGINA + POR_PAGINA,
  );

  async function conAviso(accion: () => Promise<unknown>, respaldo: string) {
    setErrorAccion(null);
    try {
      await accion();
      await queryClient.invalidateQueries({ queryKey: ['flowbots'] });
      return true;
    } catch (e) {
      setErrorAccion(mensajeDeError(e) || respaldo);
      return false;
    }
  }

  async function duplicar(bot: BotResumen) {
    setErrorAccion(null);
    try {
      const nuevo = await flowbots.duplicar(bot.id);
      await queryClient.invalidateQueries({ queryKey: ['flowbots'] });
      router.push(`/dashboard/flowbots/${nuevo.id}/edit`);
    } catch (e) {
      setErrorAccion(mensajeDeError(e) || 'No se pudo duplicar el bot.');
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900">FlowBot</h2>
          <p className="text-sm text-neutral-500">
            Bots que responden y mueven oportunidades solos.
          </p>
        </div>
        {permisos.puedeCrear && (
          <div className="flex gap-2">
            <Link href="/dashboard/flowbots/templates">
              <Button variant="secondary">Ver plantillas</Button>
            </Link>
            <Link href="/dashboard/flowbots/new">
              <Button variant="accent">
                <Plus size={16} />
                Nuevo bot
              </Button>
            </Link>
          </div>
        )}
      </div>

      <EstadoTransporte />
      <PanelEnvios />

      {errorAccion && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {errorAccion}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400"
          />
          <input
            type="search"
            value={busqueda}
            onChange={(e) => {
              setBusqueda(e.target.value);
              setPagina(0);
            }}
            placeholder="Buscar por nombre o descripción"
            aria-label="Buscar bots"
            className="w-full rounded-md border border-neutral-300 py-2 pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
          />
        </div>

        <div
          role="tablist"
          aria-label="Filtrar por estado"
          className="flex flex-wrap gap-1"
        >
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filtro === f.id}
              onClick={() => {
                setFiltro(f.id);
                setPagina(0);
              }}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-line-focus ${
                filtro === f.id
                  ? 'bg-brand-primary text-white'
                  : 'border border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50'
              }`}
            >
              {f.etiqueta}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5 text-xs text-neutral-500">
          Ordenar
          <select
            value={orden}
            onChange={(e) => setOrden(e.target.value as Orden)}
            className="rounded-md border border-neutral-300 px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
          >
            {ORDENES.map((o) => (
              <option key={o.id} value={o.id}>
                {o.etiqueta}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ListState
        isLoading={isLoading}
        isError={isError}
        isEmpty={enPantalla.length === 0}
        error={error}
        onRetry={() => void refetch()}
        icon={Bot}
        emptyMessage={
          busqueda || filtro !== 'todos'
            ? 'Ningún bot coincide con lo que buscas.'
            : 'Todavía no hay bots. Empieza por una plantilla y cámbiala a tu gusto.'
        }
        emptyAction={
          permisos.puedeCrear && !busqueda && filtro === 'todos' ? (
            <Link href="/dashboard/flowbots/templates" className="mt-2">
              <Button variant="accent">Ver plantillas</Button>
            </Link>
          ) : undefined
        }
        loadingMessage="Cargando bots…"
      />

      {enPantalla.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {enPantalla.map((bot) => (
            <TarjetaBot
              key={bot.id}
              bot={bot}
              permisos={permisos}
              onDuplicar={() => void duplicar(bot)}
              onActivar={() =>
                void conAviso(
                  () => flowbots.cambiarEstado(bot.id, 'ACTIVE'),
                  'No se pudo activar el bot.',
                )
              }
              onPausar={() =>
                void conAviso(
                  () => flowbots.cambiarEstado(bot.id, 'PAUSED'),
                  'No se pudo pausar el bot.',
                )
              }
              onArchivar={() => setConfirmando({ bot, accion: 'archivar' })}
              onRestaurar={() => setConfirmando({ bot, accion: 'restaurar' })}
            />
          ))}
        </ul>
      )}

      {paginas > 1 && (
        <nav
          aria-label="Paginación"
          className="flex items-center justify-center gap-2 text-sm"
        >
          <Button
            variant="secondary"
            size="sm"
            disabled={paginaActual === 0}
            onClick={() => setPagina((p) => Math.max(0, p - 1))}
          >
            Anterior
          </Button>
          <span className="text-neutral-500">
            Página {paginaActual + 1} de {paginas}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={paginaActual >= paginas - 1}
            onClick={() => setPagina((p) => Math.min(paginas - 1, p + 1))}
          >
            Siguiente
          </Button>
        </nav>
      )}

      {confirmando && (
        <ConfirmDialog
          title={
            confirmando.accion === 'archivar'
              ? 'Archivar este bot'
              : 'Restaurar este bot'
          }
          message={
            confirmando.accion === 'archivar'
              ? // Se dice qué pasa con lo que ya está corriendo: archivar sin
                // avisar deja a alguien esperando una respuesta que no llega.
                'Dejará de atender conversaciones nuevas. Las que ya empezaron siguen su curso y el historial se conserva. Puedes restaurarlo cuando quieras.'
              : 'Volverá a la lista como borrador. No se activa solo: tendrás que encenderlo cuando esté listo.'
          }
          confirmLabel={
            confirmando.accion === 'archivar' ? 'Archivar' : 'Restaurar'
          }
          onClose={() => setConfirmando(null)}
          onConfirm={async () => {
            const ok = await conAviso(
              () =>
                flowbots.cambiarEstado(
                  confirmando.bot.id,
                  confirmando.accion === 'archivar' ? 'ARCHIVED' : 'DRAFT',
                ),
              'No se pudo cambiar el estado del bot.',
            );
            if (ok) setConfirmando(null);
          }}
        />
      )}
    </div>
  );
}

function TarjetaBot({
  bot,
  permisos,
  onDuplicar,
  onActivar,
  onPausar,
  onArchivar,
  onRestaurar,
}: {
  bot: BotResumen;
  permisos: ReturnType<typeof permisosDe>;
  onDuplicar: () => void;
  onActivar: () => void;
  onPausar: () => void;
  onArchivar: () => void;
  onRestaurar: () => void;
}) {
  const [menuAbierto, setMenuAbierto] = useState(false);
  const estado = estadoVisible(bot);
  const archivado = estado === 'archivado';

  // Un borrador por encima de la versión publicada significa que hay trabajo
  // sin publicar. Es la diferencia entre «lo que ves» y «lo que atiende».
  const borradorPendiente =
    bot.versionPublicada !== null && bot.draftRevision > 0;

  return (
    <li className="relative flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/dashboard/flowbots/${bot.id}`}
            className="block truncate text-sm font-semibold text-neutral-900 outline-none hover:text-brand-primary focus-visible:ring-2 focus-visible:ring-line-focus"
          >
            {bot.nombre}
          </Link>
          {bot.descripcion && (
            <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500">
              {bot.descripcion}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <EstadoBot bot={bot} />
          <div className="relative">
            <button
              type="button"
              aria-label={`Acciones de ${bot.nombre}`}
              aria-expanded={menuAbierto}
              aria-haspopup="menu"
              onClick={() => setMenuAbierto((v) => !v)}
              className="rounded p-1 text-neutral-400 outline-none hover:bg-neutral-100 hover:text-neutral-600 focus-visible:ring-2 focus-visible:ring-line-focus"
            >
              <MoreVertical size={16} />
            </button>
            {menuAbierto && (
              <>
                <button
                  type="button"
                  aria-hidden="true"
                  tabIndex={-1}
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setMenuAbierto(false)}
                />
                <div
                  role="menu"
                  className="absolute right-0 z-20 mt-1 w-52 rounded-md border border-neutral-200 bg-white py-1 shadow-lg"
                >
                  <ItemMenu
                    href={`/dashboard/flowbots/${bot.id}`}
                    icon={Bot}
                    onSelect={() => setMenuAbierto(false)}
                  >
                    Abrir
                  </ItemMenu>
                  {permisos.puedeEditar && !archivado && (
                    <ItemMenu
                      href={`/dashboard/flowbots/${bot.id}/edit`}
                      icon={Pencil}
                      onSelect={() => setMenuAbierto(false)}
                    >
                      Editar el flujo
                    </ItemMenu>
                  )}
                  {permisos.puedeCrear && (
                    <ItemMenu
                      icon={Copy}
                      onSelect={() => {
                        setMenuAbierto(false);
                        onDuplicar();
                      }}
                    >
                      Duplicar
                    </ItemMenu>
                  )}
                  <ItemMenu
                    href={`/dashboard/flowbots/${bot.id}/versions`}
                    icon={History}
                    onSelect={() => setMenuAbierto(false)}
                  >
                    Versiones
                  </ItemMenu>
                  <ItemMenu
                    href={`/dashboard/flowbots/${bot.id}/executions`}
                    icon={ListOrdered}
                    onSelect={() => setMenuAbierto(false)}
                  >
                    Ejecuciones
                  </ItemMenu>
                  {permisos.puedeArchivar && (
                    <ItemMenu
                      icon={archivado ? ArchiveRestore : Archive}
                      onSelect={() => {
                        setMenuAbierto(false);
                        if (archivado) onRestaurar();
                        else onArchivar();
                      }}
                    >
                      {archivado ? 'Restaurar' : 'Archivar'}
                    </ItemMenu>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-center">
        <Dato etiqueta="Ejecuciones" valor={bot.metricas.ejecucionesTotales} />
        <Dato
          etiqueta="Completadas"
          valor={
            bot.metricas.tasaFinalizacion === null
              ? '—'
              : `${Math.round(bot.metricas.tasaFinalizacion * 100)}%`
          }
        />
        <Dato etiqueta="A una persona" valor={bot.metricas.handoffs} />
      </dl>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
        <span>
          {bot.versionPublicada
            ? `Versión ${bot.versionPublicada} publicada`
            : 'Sin publicar'}
        </span>
        {borradorPendiente && (
          <span className="text-status-warning">Borrador sin publicar</span>
        )}
        {bot.metricas.errores > 0 && (
          <span className="inline-flex items-center gap-1 text-status-error">
            <AlertTriangle size={12} />
            {bot.metricas.errores} con error
          </span>
        )}
        <span>Modificado {fechaCorta(bot.actualizadoEn)}</span>
      </div>

      {permisos.puedeActivar && !archivado && (
        <div className="flex gap-2">
          {bot.estado === 'ACTIVE' ? (
            <Button variant="secondary" size="sm" onClick={onPausar}>
              <Pause size={14} />
              Pausar
            </Button>
          ) : (
            <Button
              variant="accent"
              size="sm"
              onClick={onActivar}
              // Activar exige versión publicada: el selector solo mira los que
              // la tienen, así que el botón sin ella prometería algo falso.
              disabled={!bot.versionPublicada}
              title={
                bot.versionPublicada
                  ? undefined
                  : 'Publica una versión antes de activarlo'
              }
            >
              <Play size={14} />
              Activar
            </Button>
          )}
          <Link href={`/dashboard/flowbots/${bot.id}/edit`}>
            <Button variant="secondary" size="sm">
              <Pencil size={14} />
              Editar
            </Button>
          </Link>
        </div>
      )}
    </li>
  );
}

function ItemMenu({
  href,
  icon: Icon,
  children,
  onSelect,
}: {
  href?: string;
  icon: typeof Bot;
  children: React.ReactNode;
  onSelect: () => void;
}) {
  const clases =
    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-700 outline-none hover:bg-neutral-50 focus-visible:bg-neutral-50';

  if (href) {
    return (
      <Link href={href} role="menuitem" className={clases} onClick={onSelect}>
        <Icon size={14} className="text-neutral-400" />
        {children}
      </Link>
    );
  }
  return (
    <button type="button" role="menuitem" className={clases} onClick={onSelect}>
      <Icon size={14} className="text-neutral-400" />
      {children}
    </button>
  );
}

function Dato({
  etiqueta,
  valor,
}: {
  etiqueta: string;
  valor: number | string;
}) {
  return (
    <div className="rounded-md bg-neutral-50 py-1.5">
      <dt className="text-[10px] uppercase tracking-wide text-neutral-400">
        {etiqueta}
      </dt>
      <dd className="text-sm font-semibold text-neutral-800">{valor}</dd>
    </div>
  );
}

function fechaCorta(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '—';
  return fecha.toLocaleDateString('es', { day: 'numeric', month: 'short' });
}
