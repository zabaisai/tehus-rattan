'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  MessageSquare,
  Package,
  Search,
  Target,
  Trash2,
  User,
} from 'lucide-react';
import {
  buscar,
  ETIQUETA_DE_TIPO,
  LONGITUD_MINIMA_CONSULTA,
  resultadosEnOrden,
  rutaDelResultado,
  TIPOS_BUSCABLES,
  TipoBuscable,
  ResultadoDeBusqueda,
} from '@/lib/busqueda';
import { mensajeDeError } from '@/components/ui/ListState';
import { useDialogoModal } from '@/components/ui/useDialogoModal';

const ICONO: Record<TipoBuscable, typeof User> = {
  contactos: User,
  conversaciones: MessageSquare,
  oportunidades: Target,
  productos: Package,
  cotizaciones: FileText,
};

/** Espera antes de consultar: teclear «laura» son cinco peticiones, no una. */
const RETARDO_MS = 250;

export function PaletaDeBusqueda({ onCerrar }: { onCerrar: () => void }) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLInputElement>(null);
  const [texto, setTexto] = useState('');
  const [consulta, setConsulta] = useState('');
  const [tipo, setTipo] = useState<TipoBuscable | 'todo'>('todo');
  const [incluirPapelera, setIncluirPapelera] = useState(false);
  const [activo, setActivo] = useState(0);

  useDialogoModal({ activo: true, onCerrar, refPanel: panelRef });

  // El foco va al campo, no al primer resultado: la paleta se abre para
  // escribir. `useDialogoModal` ya enfoca el primer elemento, y aquí ese
  // elemento ES el campo, pero se deja explícito por si cambia el orden.
  useEffect(() => {
    campoRef.current?.focus();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setConsulta(texto.trim()), RETARDO_MS);
    return () => clearTimeout(t);
  }, [texto]);

  const suficiente = consulta.length >= LONGITUD_MINIMA_CONSULTA;

  const { data, isFetching, isError, error } = useQuery({
    queryKey: ['busqueda', consulta, tipo, incluirPapelera],
    queryFn: ({ signal }) =>
      buscar({
        q: consulta,
        tipos: tipo === 'todo' ? undefined : [tipo],
        incluirPapelera,
        signal,
      }),
    enabled: suficiente,
    // Mantener lo anterior mientras llega lo nuevo evita que la lista
    // parpadee a vacío en cada tecla.
    placeholderData: (previo) => previo,
  });

  const planos = useMemo(() => resultadosEnOrden(data), [data]);

  // Al cambiar la consulta o el filtro, la selección vuelve al principio: si
  // no, Enter abriría un resultado que ya no está donde estaba.
  //
  // Se ajusta en el RENDER y no en un efecto: un efecto dejaría un fotograma
  // con la selección vieja sobre la lista nueva, que es justo el instante en
  // el que alguien pulsa Enter. Es el patrón que React documenta para
  // reaccionar a un cambio de entrada.
  const claveDeVista = `${consulta}|${tipo}|${incluirPapelera}`;
  const [vistaAnterior, setVistaAnterior] = useState(claveDeVista);
  if (claveDeVista !== vistaAnterior) {
    setVistaAnterior(claveDeVista);
    setActivo(0);
  }

  function abrir(r: ResultadoDeBusqueda) {
    router.push(rutaDelResultado(r));
    onCerrar();
  }

  function alPulsar(e: React.KeyboardEvent) {
    if (planos.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActivo((i) => (i + 1) % planos.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActivo((i) => (i - 1 + planos.length) % planos.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const elegido = planos[activo];
      if (elegido) abrir(elegido);
    }
  }

  const idOpcionActiva = planos[activo]
    ? `resultado-${planos[activo].tipo}-${planos[activo].id}`
    : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[10vh]">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Buscar en la empresa"
        tabIndex={-1}
        className="flex max-h-[75vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-surface-default shadow-lg outline-none"
      >
        <div className="flex items-center gap-2 border-b border-line-default px-4">
          <Search size={17} aria-hidden="true" className="shrink-0 text-content-secondary" />
          <input
            ref={campoRef}
            type="text"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={alPulsar}
            placeholder="Buscar contactos, conversaciones, oportunidades, productos o cotizaciones"
            aria-label="Buscar en la empresa"
            // `combobox` + `listbox`: sin esto el lector de pantalla anuncia un
            // cuadro de texto corriente y nunca menciona los resultados.
            role="combobox"
            aria-expanded={planos.length > 0}
            aria-controls="resultados-de-busqueda"
            aria-activedescendant={idOpcionActiva}
            autoComplete="off"
            className="w-full bg-transparent py-3.5 text-sm text-content-primary outline-none placeholder:text-content-disabled"
          />
          {isFetching && (
            <span className="shrink-0 text-xs text-content-secondary">Buscando…</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1 border-b border-line-default px-3 py-2">
          <Filtro activo={tipo === 'todo'} onClick={() => setTipo('todo')}>
            Todo
          </Filtro>
          {TIPOS_BUSCABLES.map((t) => (
            <Filtro key={t} activo={tipo === t} onClick={() => setTipo(t)}>
              {ETIQUETA_DE_TIPO[t]}
            </Filtro>
          ))}
          <button
            type="button"
            onClick={() => setIncluirPapelera((v) => !v)}
            aria-pressed={incluirPapelera}
            className={`ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-line-focus ${
              incluirPapelera
                ? 'bg-neutral-100 text-content-primary'
                : 'text-content-secondary hover:bg-neutral-50'
            }`}
          >
            <Trash2 size={13} aria-hidden="true" />
            Incluir papelera
          </button>
        </div>

        <div id="resultados-de-busqueda" role="listbox" aria-label="Resultados" className="min-h-0 flex-1 overflow-y-auto">
          {!suficiente && (
            <p className="px-4 py-8 text-center text-sm text-content-secondary">
              Escribe al menos {LONGITUD_MINIMA_CONSULTA} caracteres para buscar.
            </p>
          )}

          {suficiente && isError && (
            <p role="alert" className="px-4 py-8 text-center text-sm text-status-error">
              {mensajeDeError(error)}
            </p>
          )}

          {suficiente && !isError && data && data.total === 0 && !isFetching && (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-content-secondary">
                Sin resultados para «{data.consulta}».
              </p>
              {!incluirPapelera && (
                <button
                  type="button"
                  onClick={() => setIncluirPapelera(true)}
                  className="mt-2 rounded text-sm text-content-link underline outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
                >
                  Buscar también en la papelera
                </button>
              )}
            </div>
          )}

          {suficiente &&
            !isError &&
            data?.grupos.map((grupo) => (
              <div key={grupo.tipo} className="py-1">
                <p className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-content-secondary">
                  {ETIQUETA_DE_TIPO[grupo.tipo]}
                </p>
                {grupo.resultados.map((r) => {
                  const indice = planos.findIndex(
                    (x) => x.tipo === r.tipo && x.id === r.id,
                  );
                  const Icono = ICONO[r.tipo];
                  const seleccionado = indice === activo;
                  return (
                    <button
                      key={`${r.tipo}-${r.id}`}
                      id={`resultado-${r.tipo}-${r.id}`}
                      type="button"
                      role="option"
                      aria-selected={seleccionado}
                      onClick={() => abrir(r)}
                      onMouseEnter={() => setActivo(indice)}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none transition-colors ${
                        seleccionado ? 'bg-neutral-100' : 'hover:bg-neutral-50'
                      }`}
                    >
                      <Icono
                        size={16}
                        aria-hidden="true"
                        className="shrink-0 text-content-secondary"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-content-primary">
                          {r.titulo}
                        </span>
                        {r.subtitulo && (
                          <span className="block truncate text-xs text-content-secondary">
                            {r.subtitulo}
                          </span>
                        )}
                      </span>
                      {r.insignia && (
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            r.archivado
                              ? 'bg-status-warning-surface text-status-warning-strong'
                              : 'bg-neutral-100 text-content-secondary'
                          }`}
                        >
                          {r.insignia}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
        </div>

        {/* Las teclas se enuncian: una paleta que solo se deja usar por quien
            ya sabe los atajos no sirve de nada. */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-default px-4 py-2 text-[11px] text-content-secondary">
          <span>↑↓ Navegar</span>
          <span>Enter Abrir</span>
          <span>Esc Cerrar</span>
          <span className="ml-auto">Solo tu empresa y tus permisos</span>
        </div>
      </div>
    </div>
  );
}

function Filtro({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={`rounded-md px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-line-focus ${
        activo
          ? 'bg-brand-primary text-white'
          : 'text-content-secondary hover:bg-neutral-100'
      }`}
    >
      {children}
    </button>
  );
}
