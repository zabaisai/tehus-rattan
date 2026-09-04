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
  filtrarRespuesta,
  LONGITUD_MINIMA_CONSULTA,
  resultadosEnOrden,
  rutaDelResultado,
  TIPOS_BUSCABLES,
  tiposBuscablesPara,
  TipoBuscable,
  ResultadoDeBusqueda,
} from '@/lib/busqueda';
import { mensajeDeError } from '@/components/ui/ListState';
import { useDialogoModal } from '@/components/ui/useDialogoModal';
import { useAuthStore } from '@/store/auth.store';
import { useTenantCapabilities } from '@/lib/tenant-capabilities';
import { registrarReciente } from '@/lib/creacion-rapida';
import { CreacionRapida } from './CreacionRapida';

const ICONO: Record<TipoBuscable, typeof User> = {
  contactos: User,
  conversaciones: MessageSquare,
  oportunidades: Target,
  productos: Package,
  cotizaciones: FileText,
};

/** Espera antes de consultar: teclear «laura» son cinco peticiones, no una. */
const RETARDO_MS = 250;

/** «Buscar contactos, conversaciones u oportunidades», con lo que haya. */
function textoDeAyuda(tipos: readonly TipoBuscable[]): string {
  const nombres = tipos.map((t) => ETIQUETA_DE_TIPO[t].toLowerCase());
  if (nombres.length === 0) return 'Buscar en la empresa';
  if (nombres.length === 1) return `Buscar ${nombres[0]}`;
  const ultimo = nombres[nombres.length - 1];
  const conjuncion = /^[oO]/.test(ultimo) ? 'u' : 'o';
  return `Buscar ${nombres.slice(0, -1).join(', ')} ${conjuncion} ${ultimo}`;
}

export function PaletaDeBusqueda({ onCerrar }: { onCerrar: () => void }) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLInputElement>(null);
  const user = useAuthStore((s) => s.user);
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

  // Tipos que ESTA empresa puede buscar (Fase 4): los centrales siempre;
  // productos y cotizaciones solo con su módulo activo. Se aplica antes de
  // pedir y al pintar, así que un módulo apagado no aparece ni como filtro
  // ni como grupo de resultados aunque el servidor lo devolviera.
  const { can } = useTenantCapabilities();
  const permitidos = useMemo(() => tiposBuscablesPara(can), [can]);
  const todosPermitidos = permitidos.length === TIPOS_BUSCABLES.length;
  // Si el filtro elegido dejó de estar disponible, se vuelve a «Todo».
  const tipoEfectivo: TipoBuscable | 'todo' =
    tipo === 'todo' || permitidos.includes(tipo) ? tipo : 'todo';

  const { data, isFetching, isError, error } = useQuery({
    queryKey: ['busqueda', consulta, tipoEfectivo, incluirPapelera, permitidos.join(',')],
    queryFn: ({ signal }) =>
      buscar({
        q: consulta,
        // Con todos los tipos disponibles no se manda la lista: la URL sigue
        // limpia y el servidor decide. Con alguno apagado, se pide solo lo
        // permitido.
        tipos:
          tipoEfectivo === 'todo'
            ? todosPermitidos
              ? undefined
              : permitidos
            : [tipoEfectivo],
        incluirPapelera,
        signal,
      }),
    enabled: suficiente,
    // Mantener lo anterior mientras llega lo nuevo evita que la lista
    // parpadee a vacío en cada tecla.
    placeholderData: (previo) => previo,
  });

  const respuesta = useMemo(
    () => (data ? filtrarRespuesta(data, permitidos) : undefined),
    [data, permitidos],
  );
  const planos = useMemo(() => resultadosEnOrden(respuesta), [respuesta]);

  // Al cambiar la consulta o el filtro, la selección vuelve al principio: si
  // no, Enter abriría un resultado que ya no está donde estaba.
  //
  // Se ajusta en el RENDER y no en un efecto: un efecto dejaría un fotograma
  // con la selección vieja sobre la lista nueva, que es justo el instante en
  // el que alguien pulsa Enter. Es el patrón que React documenta para
  // reaccionar a un cambio de entrada.
  const claveDeVista = `${consulta}|${tipoEfectivo}|${incluirPapelera}`;
  const [vistaAnterior, setVistaAnterior] = useState(claveDeVista);
  if (claveDeVista !== vistaAnterior) {
    setVistaAnterior(claveDeVista);
    setActivo(0);
  }

  function abrir(r: ResultadoDeBusqueda) {
    registrarReciente(r, { companyId: user?.companyId, userId: user?.id });
    router.push(rutaDelResultado(r));
    onCerrar();
  }

  /**
   * Devuelve el foco al campo.
   *
   * EXISTE POR UN DEFECTO QUE ENCONTRO LA QA. Al pulsar un filtro con el
   * raton, el foco se quedaba en el chip: a partir de ahi las flechas no
   * movian la seleccion y Enter volvia a activar el chip en vez de abrir el
   * resultado. Con solo teclado o solo raton funcionaba; el camino mixto no.
   */
  function devolverFoco() {
    campoRef.current?.focus();
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
      {/* El teclado se escucha en el PANEL, no solo en el campo: si dependiera
          del campo, pulsar un filtro con el raton dejaria el foco en el chip y
          las flechas y Enter dejarian de gobernar la lista. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Buscar en la empresa"
        tabIndex={-1}
        onKeyDown={alPulsar}
        className="flex max-h-[75vh] w-full max-w-3xl overflow-hidden rounded-lg bg-surface-default shadow-lg outline-none"
      >
        <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line-default px-4">
          <Search size={17} aria-hidden="true" className="shrink-0 text-content-secondary" />
          <input
            ref={campoRef}
            type="text"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}

            placeholder={textoDeAyuda(permitidos)}
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
          <Filtro
            activo={tipoEfectivo === 'todo'}
            onClick={() => { setTipo('todo'); devolverFoco(); }}
          >
            Todo
          </Filtro>
          {permitidos.map((t) => (
            <Filtro
              key={t}
              activo={tipoEfectivo === t}
              onClick={() => { setTipo(t); devolverFoco(); }}
            >
              {ETIQUETA_DE_TIPO[t]}
            </Filtro>
          ))}
          <button
            type="button"
            onClick={() => { setIncluirPapelera((v) => !v); devolverFoco(); }}
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

          {suficiente && !isError && respuesta && respuesta.total === 0 && !isFetching && (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-content-secondary">
                Sin resultados para «{respuesta.consulta}».
              </p>
              {!incluirPapelera && (
                <button
                  type="button"
                  onClick={() => { setIncluirPapelera(true); devolverFoco(); }}
                  className="mt-2 rounded text-sm text-content-link underline outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
                >
                  Buscar también en la papelera
                </button>
              )}
            </div>
          )}

          {suficiente &&
            !isError &&
            respuesta?.grupos.map((grupo) => (
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

        <CreacionRapida onCerrar={onCerrar} />
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
