'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  CheckCircle2,
  Info,
  Loader2,
  Search,
  Undo2,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Avatar } from '@/components/ui/Avatar';
import { ForbiddenState } from '@/components/ui/ForbiddenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { getContacts } from '@/lib/contacts';
import {
  CampoComparado,
  CandidatoDeFusion,
  ContactoResumen,
  EleccionesFusion,
  Lado,
  RecuentoRelaciones,
  ResultadoFusion,
  VistaPreviaFusion,
  clavesDeFusion,
  compararContactos,
  descartarDuplicado,
  deshacerFusion,
  ejecutarFusion,
  getCandidatos,
  invalidarTrasFusion,
  leerErrorDeFusion,
  relojDeCuentaAtras,
  segundosParaDeshacer,
} from '@/lib/fusion';

type Paso = 'elegir' | 'comparar' | 'resolver' | 'confirmar' | 'resultado';

const TITULOS: Record<Paso, string> = {
  elegir: 'Fusionar contactos duplicados',
  comparar: 'Fusionar contactos duplicados',
  resolver: 'Fusionar contactos duplicados',
  confirmar: '¿Fusionar estos contactos?',
  resultado: 'Fusión completada',
};

/** Los tres pasos que se enseñan arriba. «Elegir» y «resultado» no cuentan. */
const PASOS_VISIBLES: Array<{ id: Paso; etiqueta: string }> = [
  { id: 'comparar', etiqueta: 'Comparar' },
  { id: 'resolver', etiqueta: 'Resolver diferencias' },
  { id: 'confirmar', etiqueta: 'Confirmar fusión' },
];

function nombreDe(c: Pick<ContactoResumen, 'name' | 'phone'>) {
  return c.name?.trim() || c.phone;
}

function fecha(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Las relaciones que se enseñan, con su etiqueta. Sin consentimientos: el
 * modelo no los tiene, y una fila que promete algo inexistente es peor que
 * una fila de menos. */
const RELACIONES_VISIBLES: Array<{ clave: keyof RecuentoRelaciones; etiqueta: string }> = [
  { clave: 'conversaciones', etiqueta: 'conversaciones' },
  { clave: 'mensajes', etiqueta: 'mensajes' },
  { clave: 'oportunidades', etiqueta: 'oportunidades' },
  { clave: 'tareas', etiqueta: 'tareas' },
  { clave: 'cotizaciones', etiqueta: 'cotizaciones' },
  { clave: 'notas', etiqueta: 'notas' },
  { clave: 'camposPersonalizados', etiqueta: 'campos personalizados' },
  { clave: 'sugerenciasDeTarea', etiqueta: 'sugerencias de tarea' },
  { clave: 'ejecucionesDeBot', etiqueta: 'ejecuciones de bot' },
];

/**
 * SUBCOMPONENTES A NIVEL DE MODULO, NO DENTRO DEL RENDER.
 *
 * Estaban declarados dentro de `FusionDeDuplicados`. Cada render creaba
 * funciones nuevas, React las veia como TIPOS distintos y desmontaba y volvia
 * a montar todo el subarbol: los nodos del DOM se reemplazaban en cada cambio
 * de estado. Ademas de tirar el foco, eso hacia que un clic pudiera aterrizar
 * en un nodo ya desconectado y no llegara nunca a su manejador — que es
 * exactamente lo que le pasaba al boton de cambiar el contacto principal.
 *
 * Fuera del render, el tipo es estable y React actualiza en vez de remontar.
 */
function Pasos({ actual }: { actual: Paso }) {
  const indice = PASOS_VISIBLES.findIndex((p) => p.id === actual);
  return (
    <ol className="mb-5 flex items-center gap-2 text-xs" aria-label="Pasos de la fusión">
      {PASOS_VISIBLES.map((p, i) => {
        const hecho = i < indice;
        const activo = i === indice;
        return (
          <li key={p.id} className="flex items-center gap-2">
            <span
              aria-current={activo ? 'step' : undefined}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
                activo
                  ? 'bg-brand-primary font-medium text-white'
                  : hecho
                    ? 'bg-status-success-surface text-status-success-strong'
                    : 'bg-neutral-100 text-content-secondary'
              }`}
            >
              {hecho ? (
                <Check size={12} aria-hidden="true" />
              ) : (
                <span aria-hidden="true">{i + 1}</span>
              )}
              {p.etiqueta}
              {hecho && <span className="sr-only">(completado)</span>}
            </span>
            {i < PASOS_VISIBLES.length - 1 && (
              <span aria-hidden="true" className="h-px w-4 bg-line-default" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function TarjetaContacto({
  c,
  rol,
  seleccionable,
  onInvertir,
}: {
  c: ContactoResumen;
  rol: 'principal' | 'duplicado';
  seleccionable?: boolean;
  onInvertir?: () => void;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        rol === 'principal'
          ? 'border-brand-primary bg-primary-50'
          : 'border-line-default bg-surface-default'
      }`}
    >
      <p className="mb-2 text-xs font-medium text-content-secondary">
        {rol === 'principal' ? 'Contacto principal' : 'Posible duplicado'}
      </p>
      <div className="flex items-start gap-2">
        <Avatar nombre={c.name} size="md" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-content-primary">
            {nombreDe(c)}
          </p>
          <p className="font-mono text-xs text-content-secondary">{c.phone}</p>
          {c.email && (
            <p className="truncate text-xs text-content-secondary">{c.email}</p>
          )}
          <p className="mt-1 text-xs text-content-secondary">
            Creado el {fecha(c.createdAt)}
          </p>
          {c.archivedAt && (
            <p className="mt-1 inline-flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-content-secondary">
              <Info size={11} aria-hidden="true" /> Archivado
            </p>
          )}
        </div>
      </div>
      {seleccionable && (
        <button
          type="button"
          onClick={onInvertir}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-line-default px-2.5 py-1 text-xs text-content-primary transition-colors duration-rapida ease-standard hover:bg-neutral-50"
        >
          <ArrowLeftRight size={12} aria-hidden="true" />
          Cambiar contacto principal
        </button>
      )}
    </div>
  );
}

function FilaDeCampo({
  campo,
  lado,
  onElegir,
}: {
  campo: CampoComparado;
  /** De que lado sale hoy el valor final. Lo decide quien renderiza. */
  lado: Lado;
  onElegir: (lado: Lado) => void;
}) {
  const valorFinal =
    lado === 'duplicado' ? campo.valorDuplicado : campo.valorPrincipal;
  const nombreGrupo = `campo-${campo.campo}`;

  return (
    <fieldset className="border-t border-line-default py-2.5">
      <legend className="sr-only">{campo.etiqueta}</legend>
      {/* `min-w-0` EN LA RETICULA Y EN CADA CELDA.
          Un elemento de retícula tiene `min-width: auto`, así que una cadena
          sin puntos de corte —un correo, un identificador— empuja su columna
          hasta su ancho intrínseco y arrastra la tabla entera fuera del
          diálogo. Medido antes de arreglarlo: 195 px de exceso y la columna
          del resultado recortada. `min-w-0` es lo que permite encoger; el
          corte de palabra, más abajo, es lo que evita que haga falta.

          La columna de la etiqueta es `minmax`, no fija: cuando el espacio
          aprieta cede primero ella, que es la que menos información lleva. */}
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(6rem,9rem)_1fr_1fr_1fr] sm:items-start">
        <span
          aria-hidden="true"
          className="min-w-0 break-words text-xs font-medium text-content-secondary sm:pt-0.5"
        >
          {campo.etiqueta}
          {campo.requiereDecision && (
            <span className="ml-1 text-status-warning-strong">
              <AlertTriangle
                size={11}
                aria-hidden="true"
                className="inline align-[-1px]"
              />
              <span className="sr-only">Requiere decisión</span>
            </span>
          )}
        </span>

        {(['principal', 'duplicado'] as Lado[]).map((cual) => {
          const valor =
            cual === 'principal' ? campo.valorPrincipal : campo.valorDuplicado;
          return (
            <label
              key={cual}
              className="flex min-w-0 items-start gap-2 text-sm"
            >
              <input
                type="radio"
                name={nombreGrupo}
                className="mt-1 shrink-0"
                checked={lado === cual}
                disabled={campo.iguales || valor == null}
                onChange={() => onElegir(cual)}
                aria-label={`${campo.etiqueta}: usar «${valor ?? 'sin valor'}» del ${
                  cual === 'principal' ? 'contacto principal' : 'posible duplicado'
                }`}
              />
              {/* Se PARTE, no se recorta: recortar aquí escondería justo el
                  final del correo, que suele ser lo que distingue a los dos. */}
              <span className="min-w-0 break-words text-content-primary">
                {valor ?? <span className="text-content-secondary">—</span>}
              </span>
            </label>
          );
        })}

        <span className="min-w-0 text-sm">
          <span className="sr-only">Resultado final: </span>
          <span className="break-words font-medium text-content-primary">
            {valorFinal ?? '—'}
          </span>
          {campo.iguales && (
            <span className="ml-1.5 text-xs text-status-success-strong">
              {campo.nota ?? 'Coincide'}
            </span>
          )}
        </span>
      </div>
    </fieldset>
  );
}

function ResumenRelaciones({ r }: { r: RecuentoRelaciones }) {
  const conValor = RELACIONES_VISIBLES.filter((x) => (r[x.clave] ?? 0) > 0);
  return (
    <section
      aria-labelledby="fusion-relaciones"
      className="rounded-md border border-line-default bg-neutral-50 p-3"
    >
      <h4 id="fusion-relaciones" className="text-xs font-semibold text-content-primary">
        Todo esto se conservará
      </h4>
      {conValor.length === 0 ? (
        <p className="mt-1 text-xs text-content-secondary">
          El posible duplicado no tiene historial relacionado.
        </p>
      ) : (
        <ul className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
          {conValor.map((x) => (
            <li key={x.clave} className="flex justify-between gap-2">
              <span className="text-content-secondary">{x.etiqueta}</span>
              <span className="font-mono tabular-nums text-content-primary">
                {r[x.clave]}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-content-secondary">
        Las conversaciones no se mezclan por texto: se conservan completas y
        separadas, con su canal y su fecha.
      </p>
    </section>
  );
}

export function FusionDeDuplicados({
  contactoId,
  duplicadoInicialId,
  puedeEjecutar,
  onCerrar,
  onFusionado,
  onCambioDeSeleccion,
  pasoInicial,
}: {
  contactoId: string;
  duplicadoInicialId?: string | null;
  /** Paso que venia en la URL, para que una recarga no vuelva al principio. */
  pasoInicial?: Paso | null;
  /** ADMIN y MANAGER. Un AGENT puede mirar, no ejecutar. */
  puedeEjecutar: boolean;
  onCerrar: () => void;
  /** Se llama con el id canónico para navegar al contacto resultante. */
  onFusionado: (canonicoId: string) => void;
  /**
   * LA SELECCION ENTERA, NO SOLO EL DUPLICADO.
   *
   * Antes esto avisaba unicamente del duplicado, y la pantalla —que seguia
   * creyendo que el principal era el de siempre— escribia los dos parametros
   * con el MISMO id al intercambiar. El resultado era comparar un contacto
   * consigo mismo. Un intercambio cambia los dos extremos a la vez, asi que
   * el aviso tiene que llevarlos a la vez.
   */
  onCambioDeSeleccion?: (seleccion: {
    principalId: string;
    duplicadoId: string | null;
    paso?: Paso;
  }) => void;
}) {
  const queryClient = useQueryClient();

  /**
   * EL PAR NO SE GUARDA AQUI: llega por props desde la ruta.
   *
   * Cuando vivia en `useState`, intercambiar el principal actualizaba la
   * pantalla pero la URL se quedaba con la pareja anterior, asi que una
   * recarga deshacia el intercambio en silencio. Con la ruta como unica
   * fuente de verdad no hay dos versiones de la verdad que puedan divergir.
   */
  const principalId = contactoId;
  const duplicadoId = duplicadoInicialId ?? null;
  const [paso, setPaso] = useState<Paso>(
    duplicadoInicialId ? (pasoInicial ?? 'comparar') : 'elegir',
  );
  const [elecciones, setElecciones] = useState<EleccionesFusion>({});
  const [conservarAlternativas, setConservarAlternativas] = useState(true);
  const [confirmado, setConfirmado] = useState(false);
  const [enviando, setEnviando] = useState(false);

  /**
   * CANDADO SINCRONO. `setEnviando(true)` no bloquea nada: dos eventos en el
   * mismo fotograma leen el mismo `enviando` antes de que React vuelva a
   * renderizar, y salen dos peticiones de un solo gesto. Una `ref` cambia en
   * el acto.
   */
  const enviandoRef = useRef(false);

  /**
   * NUMERO DE OPERACION, para descartar respuestas que llegan tarde.
   *
   * Si alguien abandona la operacion —«volver a comparar», cambiar de paso—
   * mientras la peticion sigue en vuelo, su respuesta ya no describe lo que
   * hay en pantalla. Pintarla fue lo que hizo aparecer un «fusion completada»
   * despues de un conflicto, sin que nadie volviera a pulsar el boton.
   */
  const operacionRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [conflicto, setConflicto] = useState(false);
  const [resultado, setResultado] = useState<ResultadoFusion | null>(null);
  const [avisoDeCierre, setAvisoDeCierre] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [deshaciendo, setDeshaciendo] = useState(false);
  /**
   * Solo el DESENLACE EXPLÍCITO se guarda: que alguien la deshizo, o que el
   * servidor se negó. «Vencido» y «disponible» no son estados propios sino
   * una consecuencia del reloj, así que se derivan más abajo. Guardarlos
   * obligaba a un efecto que llamaba a `setState` para pasar de uno a otro,
   * y eso son renders en cascada para representar algo que ya se sabía.
   */
  const [desenlaceDeshacer, setDesenlaceDeshacer] = useState<
    'hecho' | 'bloqueado' | null
  >(null);

  const candidatos = useQuery({
    queryKey: clavesDeFusion.candidatos(contactoId),
    queryFn: () => getCandidatos(contactoId),
    enabled: paso === 'elegir',
  });

  const manuales = useQuery({
    queryKey: ['contacts'],
    queryFn: getContacts,
    enabled: paso === 'elegir',
  });

  const comparacion = useQuery({
    queryKey: clavesDeFusion.comparacion(principalId, duplicadoId ?? ''),
    queryFn: () => compararContactos(principalId, duplicadoId!),
    // `duplicadoId !== principalId`: comparar un contacto consigo mismo no es
    // una comparación, es un espejo. El servidor ya lo rechaza; no pedirlo
    // evita además enseñar dos tarjetas iguales mientras llega el error.
    enabled:
      Boolean(duplicadoId) &&
      duplicadoId !== principalId &&
      paso !== 'elegir' &&
      paso !== 'resultado',
    retry: false,
  });

  const vista = comparacion.data;

  // Cuenta atrás real: se recalcula contra `deshacerHasta`, la marca que puso
  // el servidor. Un `setInterval` que reste diez minutos desde el navegador
  // enseñaría tiempo restante después de que la ventana ya hubiera vencido.
  const [ahora, setAhora] = useState(() => Date.now());
  const segundos = resultado ? segundosParaDeshacer(resultado, ahora) : 0;

  /** Derivado, no guardado: el reloj ya dice si la ventana sigue abierta. */
  const estadoDeshacer: 'disponible' | 'hecho' | 'vencido' | 'bloqueado' =
    desenlaceDeshacer ?? (segundos > 0 ? 'disponible' : 'vencido');

  useEffect(() => {
    if (paso !== 'resultado' || !resultado || desenlaceDeshacer) return;
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [paso, resultado, desenlaceDeshacer]);

  const hayDecisiones =
    Object.keys(elecciones.campos ?? {}).length > 0 ||
    Object.keys(elecciones.camposPersonalizados ?? {}).length > 0;

  function intentarCerrar() {
    if (paso === 'resultado' || !hayDecisiones) return onCerrar();
    setAvisoDeCierre(true);
  }

  /**
   * Cambia de paso y lo deja escrito en la URL.
   *
   * Solo se persisten `comparar` y `resolver`. `confirmar` no: una recarga
   * volveria a la pantalla de confirmar con la casilla desmarcada y una vista
   * previa recien pedida, que es justo el sitio donde no conviene devolver a
   * nadie. `resultado` tampoco: la fusion ya ocurrio y su registro vive en el
   * servidor, no en la barra de direcciones.
   */
  function irAPaso(siguiente: Paso) {
    setPaso(siguiente);
    if (siguiente === 'comparar' || siguiente === 'resolver')
      onCambioDeSeleccion?.({ principalId, duplicadoId, paso: siguiente });
  }

  function elegirDuplicado(id: string) {
    setPaso('comparar');
    setError(null);
    setConflicto(false);
    onCambioDeSeleccion?.({ principalId, duplicadoId: id, paso: 'comparar' });
  }

  function invertirPrincipal() {
    if (!duplicadoId || duplicadoId === principalId) return;
    // Las decisiones se toman «respecto al principal»: si cambia el principal,
    // ya no significan lo mismo y arrastrarlas sería aplicar en silencio algo
    // que nadie eligió. Al cambiar la ruta el componente se remonta y se
    // reinician solas, pero se limpian aquí también para no depender de eso.
    setElecciones({});
    // LOS DOS EXTREMOS, EN EL MISMO AVISO. Mandar solo uno dejaba a la
    // pantalla escribiendo el mismo id en los dos parámetros.
    onCambioDeSeleccion?.({
      principalId: duplicadoId,
      duplicadoId: principalId,
      paso: paso === 'resolver' ? 'resolver' : 'comparar',
    });
  }

  function elegirCampo(campo: string, lado: Lado, personalizado = false) {
    setElecciones((prev) =>
      personalizado
        ? {
            ...prev,
            camposPersonalizados: {
              ...(prev.camposPersonalizados ?? {}),
              [campo]: lado,
            },
          }
        : { ...prev, campos: { ...(prev.campos ?? {}), [campo]: lado } },
    );
  }

  function ladoDe(campo: CampoComparado, personalizado = false): Lado {
    const elegido = personalizado
      ? elecciones.camposPersonalizados?.[campo.campo]
      : elecciones.campos?.[campo.campo as 'name' | 'phone' | 'email'];
    return elegido ?? 'principal';
  }

  async function noSonDuplicados(otroId: string) {
    setError(null);
    try {
      await descartarDuplicado(contactoId, otroId);
      await queryClient.invalidateQueries({
        queryKey: clavesDeFusion.candidatos(contactoId),
      });
      if (duplicadoId === otroId) {
        setPaso('elegir');
        onCambioDeSeleccion?.({ principalId, duplicadoId: null });
      }
    } catch (e) {
      setError(leerErrorDeFusion(e).mensaje);
    }
  }

  /** Descarta lo que este en vuelo: su respuesta ya no se pintara. */
  function abandonarOperacion() {
    operacionRef.current += 1;
    enviandoRef.current = false;
    setEnviando(false);
  }

  async function fusionar() {
    if (!vista || !duplicadoId) return;
    // El candado va ANTES de cualquier `await` y de cualquier `setState`.
    if (enviandoRef.current) return;
    enviandoRef.current = true;

    const operacion = ++operacionRef.current;
    const vigente = () => operacion === operacionRef.current;

    setEnviando(true);
    setError(null);
    setConflicto(false);
    try {
      const r = await ejecutarFusion({
        principalId,
        duplicadoId,
        versiones: vista.versiones,
        elecciones: { ...elecciones, conservarAlternativas },
      });
      // La cache se invalida siempre: la fusion ocurrio de verdad aunque quien
      // la pidio ya no este mirando esta pantalla.
      invalidarTrasFusion(queryClient);
      if (!vigente()) return;
      setResultado(r);
      setDesenlaceDeshacer(null);
      setAhora(Date.now());
      setPaso('resultado');
    } catch (e) {
      if (!vigente()) return;
      const err = leerErrorDeFusion(e);
      setError(err.mensaje);
      setConflicto(err.tipo === 'conflicto');
    } finally {
      enviandoRef.current = false;
      if (vigente()) setEnviando(false);
    }
  }

  async function deshacer() {
    if (!resultado) return;
    setDeshaciendo(true);
    setError(null);
    try {
      await deshacerFusion(resultado.mergeId);
      setDesenlaceDeshacer('hecho');
      invalidarTrasFusion(queryClient);
    } catch (e) {
      const err = leerErrorDeFusion(e);
      const conocido =
        err.codigo === 'VENTANA_VENCIDA' ||
        err.codigo === 'REVERSION_INSEGURA' ||
        err.codigo === 'YA_DESHECHA';
      // Solo se deja la alerta genérica cuando el motivo NO tiene su propio
      // bloque explicándolo: si no, la pantalla dice dos veces lo mismo.
      setError(conocido ? null : err.mensaje);
      // Una ventana vencida NO es un desenlace: el reloj ya lo dice solo.
      if (err.codigo !== 'VENTANA_VENCIDA') setDesenlaceDeshacer('bloqueado');
    } finally {
      setDeshaciendo(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  if (!puedeEjecutar)
    return (
      <Modal title="Fusionar contactos duplicados" onClose={onCerrar} maxWidth="lg">
        <ForbiddenState
          titulo="Fusionar contactos es para administradores"
          detalle="Tu rol no permite unir dos fichas. Si crees que este contacto está duplicado, pídeselo a un administrador."
        />
      </Modal>
    );

  return (
    <Modal
      title={TITULOS[paso]}
      onClose={intentarCerrar}
      maxWidth="4xl"
      footer={pieDeModal()}
    >
      {paso !== 'elegir' && paso !== 'resultado' && <Pasos actual={paso} />}

      {avisoDeCierre && (
        <div
          role="alertdialog"
          aria-label="Confirmar salida"
          className="mb-4 rounded-md border border-status-warning-surface bg-status-warning-surface p-3"
        >
          <p className="flex items-start gap-2 text-sm text-status-warning-strong">
            <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            Si sales ahora se pierden las decisiones que ya tomaste.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setAvisoDeCierre(false)}
              className="rounded-md border border-line-default px-3 py-1.5 text-sm"
            >
              Seguir revisando
            </button>
            <button
              type="button"
              onClick={onCerrar}
              className="rounded-md bg-status-error px-3 py-1.5 text-sm text-white"
            >
              Salir sin fusionar
            </button>
          </div>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-md border border-status-error-surface bg-status-error-surface p-3 text-sm text-status-error"
        >
          <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>
            {error}
            {conflicto && (
              <button
                type="button"
                onClick={() => {
                  // Se ABANDONA lo que este en vuelo antes de nada: si la
                  // peticion anterior responde despues, su resultado ya no
                  // pertenece a esta pantalla.
                  abandonarOperacion();
                  setConflicto(false);
                  setError(null);
                  setConfirmado(false);
                  irAPaso('comparar');
                  // Versiones nuevas: seguir con las de antes es volver a
                  // decidir sobre datos que ya se sabe que cambiaron.
                  comparacion.refetch();
                }}
                className="ml-2 underline"
              >
                Volver a comparar
              </button>
            )}
          </span>
        </p>
      )}

      {paso === 'elegir' && pasoElegir()}
      {(paso === 'comparar' || paso === 'resolver' || paso === 'confirmar') &&
        pasoConVista()}
      {paso === 'resultado' && pasoResultado()}
    </Modal>
  );

  // ── Piezas ────────────────────────────────────────────────────────────



  function pasoElegir() {
    if (candidatos.isLoading)
      return (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      );

    if (candidatos.error)
      return (
        <p role="alert" className="text-sm text-status-error">
          {leerErrorDeFusion(candidatos.error).mensaje}
        </p>
      );

    const lista = (candidatos.data ?? []) as CandidatoDeFusion[];
    const otros = (manuales.data ?? []).filter(
      (c) =>
        c.id !== contactoId &&
        !lista.some((x) => x.contacto.id === c.id) &&
        (busqueda.trim().length < 2 ||
          `${c.name ?? ''} ${c.phone} ${c.email ?? ''}`
            .toLowerCase()
            .includes(busqueda.trim().toLowerCase())),
    );

    return (
      <div className="space-y-5">
        <section aria-labelledby="fusion-candidatos">
          <h4 id="fusion-candidatos" className="mb-2 text-sm font-semibold">
            Posibles duplicados
          </h4>
          {lista.length === 0 ? (
            <p className="rounded-md border border-dashed border-line-default p-4 text-sm text-content-secondary">
              No encontramos duplicados de este contacto. Puedes elegir otro a
              mano más abajo si sabes cuál es.
            </p>
          ) : (
            <ul className="space-y-2">
              {lista.map((cand) => (
                <li
                  key={cand.contacto.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-line-default p-3"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar nombre={cand.contacto.name} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {nombreDe(cand.contacto)}
                      </p>
                      <p className="text-xs text-content-secondary">
                        <span
                          className={`mr-1.5 rounded px-1.5 py-0.5 ${
                            cand.nivel === 'alta'
                              ? 'bg-status-success-surface text-status-success-strong'
                              : 'bg-status-warning-surface text-status-warning-strong'
                          }`}
                        >
                          {cand.nivel === 'alta'
                            ? 'Coincidencia alta'
                            : 'Solo sugerida'}
                        </span>
                        {cand.razones.join(' · ')}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => noSonDuplicados(cand.contacto.id)}
                      className="rounded-md border border-line-default px-2.5 py-1.5 text-xs"
                    >
                      No son duplicados
                    </button>
                    <button
                      type="button"
                      onClick={() => elegirDuplicado(cand.contacto.id)}
                      className="rounded-md bg-brand-primary px-2.5 py-1.5 text-xs text-white"
                    >
                      Comparar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="fusion-manual">
          <h4 id="fusion-manual" className="mb-2 text-sm font-semibold">
            Elegir otro contacto
          </h4>
          <label className="flex items-center gap-2 rounded-md border border-line-default px-3 py-2">
            <Search size={14} aria-hidden="true" className="text-content-secondary" />
            <span className="sr-only">Buscar un contacto para comparar</span>
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre, teléfono o correo…"
              className="w-full text-sm outline-none"
            />
          </label>
          {busqueda.trim().length >= 2 && (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {otros.slice(0, 8).map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => elegirDuplicado(c.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-neutral-50"
                  >
                    <Avatar nombre={c.name} size="sm" />
                    <span className="truncate">{c.name?.trim() || c.phone}</span>
                    <span className="ml-auto font-mono text-xs text-content-secondary">
                      {c.phone}
                    </span>
                  </button>
                </li>
              ))}
              {otros.length === 0 && (
                <li className="px-2 py-1.5 text-sm text-content-secondary">
                  Ningún contacto coincide.
                </li>
              )}
            </ul>
          )}
        </section>
      </div>
    );
  }

  function pasoConVista() {
    if (comparacion.isLoading)
      return (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      );

    if (comparacion.error) {
      const err = leerErrorDeFusion(comparacion.error);
      if (err.tipo === 'sinPermiso')
        return <ForbiddenState titulo="Sin permiso" detalle={err.mensaje} />;
      return (
        <p role="alert" className="text-sm text-status-error">
          {err.mensaje}
        </p>
      );
    }

    if (!vista) return null;

    if (paso === 'comparar') return bloqueComparar(vista);
    if (paso === 'resolver') return bloqueResolver(vista);
    return bloqueConfirmar(vista);
  }

  function bloqueComparar(v: VistaPreviaFusion) {
    return (
      <div className="space-y-4">
        <p
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
            v.coincidencia.nivel === 'alta'
              ? 'bg-status-success-surface text-status-success-strong'
              : 'bg-status-warning-surface text-status-warning-strong'
          }`}
        >
          {v.coincidencia.nivel === 'alta' ? (
            <CheckCircle2 size={12} aria-hidden="true" />
          ) : (
            <Info size={12} aria-hidden="true" />
          )}
          {v.coincidencia.nivel === 'alta'
            ? 'Coincidencia alta'
            : 'Coincidencia solo sugerida'}
          {v.coincidencia.razones.length > 0 &&
            ` · ${v.coincidencia.razones.join(' · ')}`}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <TarjetaContacto
            c={v.principal}
            rol="principal"
            seleccionable
            onInvertir={invertirPrincipal}
          />
          <TarjetaContacto c={v.duplicado} rol="duplicado" />
        </div>

        <ResumenRelaciones r={v.relaciones} />
      </div>
    );
  }


  function bloqueResolver(v: VistaPreviaFusion) {
    return (
      <div className="space-y-5">
        <section aria-labelledby="fusion-campos">
          <h4 id="fusion-campos" className="text-sm font-semibold">
            Elige el valor final
          </h4>
          <div className="mt-1">
            {v.campos.map((c) => (
              <FilaDeCampo
                key={c.campo}
                campo={c}
                lado={ladoDe(c)}
                onElegir={(lado) => elegirCampo(c.campo, lado)}
              />
            ))}
            {v.camposPersonalizados.map((c) => (
              <FilaDeCampo
                key={c.campo}
                campo={c}
                lado={ladoDe(c, true)}
                onElegir={(lado) => elegirCampo(c.campo, lado, true)}
              />
            ))}
          </div>
          {v.camposPersonalizados.length === 0 && (
            <p className="mt-2 text-xs text-content-secondary">
              Ninguno de los dos tiene campos personalizados con valor.
            </p>
          )}
        </section>

        <section aria-labelledby="fusion-etiquetas">
          <h4 id="fusion-etiquetas" className="text-sm font-semibold">
            Etiquetas combinadas
          </h4>
          <p className="mt-1 flex flex-wrap gap-1.5">
            {v.etiquetas.union.length === 0 ? (
              <span className="text-xs text-content-secondary">Sin etiquetas.</span>
            ) : (
              v.etiquetas.union.map((t) => (
                <span
                  key={t}
                  className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-content-primary"
                >
                  {t}
                </span>
              ))
            )}
          </p>
          <p className="mt-1 text-xs text-content-secondary">
            Se unen sin repetir; no se pierde ninguna de las dos fichas.
          </p>
        </section>

        <section aria-labelledby="fusion-alternativas">
          <h4 id="fusion-alternativas" className="text-sm font-semibold">
            Identidades alternativas
          </h4>
          <label className="mt-1 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={conservarAlternativas}
              onChange={(e) => setConservarAlternativas(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Conservar el teléfono y el correo que no queden como principales,
              para que quien los busque siga encontrando a esta persona.
              {(v.identidadesAlternativas.telefonos.length > 0 ||
                v.identidadesAlternativas.correos.length > 0) && (
                <span className="mt-1 block font-mono text-xs text-content-secondary">
                  {[
                    ...v.identidadesAlternativas.telefonos,
                    ...v.identidadesAlternativas.correos,
                  ].join(' · ')}
                </span>
              )}
            </span>
          </label>
        </section>

        <ResumenRelaciones r={v.relaciones} />
      </div>
    );
  }

  function bloqueConfirmar(v: VistaPreviaFusion) {
    const total = RELACIONES_VISIBLES.reduce(
      (s, x) => s + (v.relaciones[x.clave] ?? 0),
      0,
    );
    return (
      <div className="space-y-4">
        <ul className="space-y-1.5 text-sm">
          <li className="flex items-start gap-2">
            <Check size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-status-success-strong" />
            <span>
              <strong>{nombreDe(v.principal)}</strong> será el contacto principal.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Check size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-status-success-strong" />
            <span>
              <strong>{nombreDe(v.duplicado)}</strong> quedará como alias interno:
              dejará de aparecer en contactos y en la papelera, y sus enlaces
              antiguos llevarán al principal.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Check size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-status-success-strong" />
            <span>
              Se conservarán <strong>{total}</strong> registros relacionados. No se
              borra ningún mensaje ni ninguna conversación.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Check size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-status-success-strong" />
            <span>No se enviará ningún mensaje.</span>
          </li>
          <li className="flex items-start gap-2">
            <Check size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-status-success-strong" />
            <span>No se moverá ninguna oportunidad de etapa.</span>
          </li>
        </ul>

        <ResumenRelaciones r={v.relaciones} />

        <label className="flex items-start gap-2 rounded-md border border-line-default p-3 text-sm">
          <input
            type="checkbox"
            checked={confirmado}
            onChange={(e) => setConfirmado(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Entiendo que ambos registros pertenecen a la misma persona.
          </span>
        </label>

        <p className="text-xs text-content-secondary">
          La acción queda registrada en la auditoría y puede deshacerse durante
          10 minutos, siempre que nada cambie después.
        </p>
      </div>
    );
  }


  function pasoResultado() {
    if (!resultado) return null;
    // DOS CIFRAS, DOS PREGUNTAS. `trasladadas` es lo que cambió de dueño;
    // `totalConservado` es lo que el contacto resultante tiene. Las dos las
    // mide el servidor: recalcular la segunda aquí desde la vista previa
    // volvería a permitir que la confirmación y el resultado no coincidan.
    const sumar = (r: RecuentoRelaciones) =>
      RELACIONES_VISIBLES.reduce((s, x) => s + (r[x.clave] ?? 0), 0);
    const trasladados = sumar(resultado.trasladadas);
    const conservados = sumar(resultado.totalConservado);
    return (
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-md border border-status-success-surface bg-status-success-surface p-3 text-sm text-status-success-strong">
          <CheckCircle2 size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          {estadoDeshacer === 'hecho'
            ? 'La fusión se deshizo: los dos contactos vuelven a estar separados.'
            : `Fusión completada. Se trasladaron ${trasladados} registros al contacto principal; en total se conservaron ${conservados} registros relacionados.`}
        </p>

        {estadoDeshacer === 'disponible' && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-line-default p-3">
            <p className="text-sm">
              Puedes deshacerla durante{' '}
              <span className="font-mono tabular-nums">
                {relojDeCuentaAtras(segundos)}
              </span>
              .
            </p>
            <button
              type="button"
              onClick={deshacer}
              disabled={deshaciendo}
              className="inline-flex items-center gap-1.5 rounded-md border border-line-default px-3 py-1.5 text-sm disabled:opacity-60"
            >
              {deshaciendo ? (
                <Loader2 size={14} aria-hidden="true" className="animate-spin" />
              ) : (
                <Undo2 size={14} aria-hidden="true" />
              )}
              Deshacer
            </button>
          </div>
        )}

        {estadoDeshacer === 'vencido' && (
          <p className="rounded-md border border-line-default p-3 text-sm text-content-secondary">
            Ya pasaron los 10 minutos: esta fusión no se puede deshacer.
          </p>
        )}

        {estadoDeshacer === 'bloqueado' && (
          <p
            role="status"
            className="rounded-md border border-status-warning-surface bg-status-warning-surface p-3 text-sm text-status-warning-strong"
          >
            No se puede deshacer: algo cambió después de la fusión y revertirla
            perdería ese cambio.
          </p>
        )}
      </div>
    );
  }

  function pieDeModal() {
    if (paso === 'elegir')
      return (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={intentarCerrar}
            className="rounded-md border border-line-default px-3 py-2 text-sm"
          >
            Cancelar
          </button>
        </div>
      );

    if (paso === 'resultado')
      return (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-md border border-line-default px-3 py-2 text-sm"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={() =>
              onFusionado(
                estadoDeshacer === 'hecho'
                  ? contactoId
                  : (resultado?.principalId ?? contactoId),
              )
            }
            className="rounded-md bg-brand-primary px-3 py-2 text-sm text-white"
          >
            Ver el contacto
          </button>
        </div>
      );

    const pendientes = vista?.decisionesPendientes ?? 0;

    return (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-content-secondary">
          {paso === 'resolver' && pendientes > 0
            ? `${pendientes} ${pendientes === 1 ? 'diferencia requiere' : 'diferencias requieren'} tu decisión`
            : 'Ningún mensaje se envía y ninguna oportunidad cambia de etapa.'}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={
              paso === 'comparar'
                ? intentarCerrar
                : () => {
                    abandonarOperacion();
                    irAPaso(paso === 'resolver' ? 'comparar' : 'resolver');
                  }
            }
            className="rounded-md border border-line-default px-3 py-2 text-sm"
          >
            {paso === 'comparar' ? 'Cancelar' : 'Volver'}
          </button>
          {paso !== 'confirmar' ? (
            <button
              type="button"
              disabled={!vista}
              onClick={() => irAPaso(paso === 'comparar' ? 'resolver' : 'confirmar')}
              className="rounded-md bg-brand-primary px-3 py-2 text-sm text-white disabled:opacity-60"
            >
              {paso === 'comparar' ? 'Resolver diferencias' : 'Continuar a confirmación'}
            </button>
          ) : (
            <button
              type="button"
              disabled={!confirmado || enviando}
              onClick={fusionar}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-secondary px-3 py-2 text-sm font-semibold text-brand-primary disabled:opacity-60"
            >
              {enviando && (
                <Loader2 size={14} aria-hidden="true" className="animate-spin" />
              )}
              {enviando ? 'Fusionando…' : 'Sí, fusionar contactos'}
            </button>
          )}
        </div>
      </div>
    );
  }
}
